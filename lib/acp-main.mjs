// ACP 常驻「主代理」会话——适用于 devin（`devin acp`）。
// 与回合串联不同：devin acp 是长期存活的子进程，同一个 session 可连续多次 session/prompt，
// 文字与工具事件经 session/update 实时流出（和 claude stream-json 的注入体验一致）。
// 进程意外退出时重建子进程与新 session（Devin 无跨进程 resume，上下文会丢失，重开后注入现场提示）。
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { AcpClient } from './acp.mjs';
import { boardMcpEntry, toAcpMcpServer } from './spawn-util.mjs';
import { createThreadWriter, acpUpdateEntries } from './thread.mjs';

const MAX_RESTARTS = 8;

export class AcpMainSession {
  /**
   * opts: { cwd, agentName, roster, dataFile, logDir, systemPrompt, timeoutMs,
   *         onText, onTool, onTurnEnd, onNotice, threadPath }
   */
  constructor({ resumeId = null, cwd, agentName = 'manager', roster, dataFile, logDir, systemPrompt = '', timeoutMs = 0, onText, onTool, onTurnEnd, onNotice, threadPath }) {
    this.cwd = cwd;
    this.agentName = agentName;
    this.roster = roster;
    this.dataFile = dataFile;
    this.logDir = logDir;
    this.systemPrompt = systemPrompt;
    this.timeoutMs = timeoutMs;
    this.onText = onText || (() => {});
    this.onTool = onTool || (() => {});
    this.onTurnEnd = onTurnEnd || (() => {});
    this.onNotice = onNotice || (() => {});
    this.thread = threadPath ? createThreadWriter(threadPath) : null;
    this.queue = [];
    this.busy = false;
    this.ready = false;
    this.stopped = false;
    this.sessionId = resumeId; // --resume 续接上次会话
    this.client = null;
    this.restarts = 0;
    this.startedAt = 0;
    this.reloadPending = false;
    this.systemSessionId = resumeId || undefined; // 已注入系统提示词的会话 id（undefined = 尚未注入过）
  }

  start() { this.#boot('启动'); }

  async #boot(why) {
    const cfg = loadConfig().devin;
    const r = spawnSync(cfg.exe, ['auth', 'status'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    if (!/logged in/i.test(`${r.stdout}${r.stderr}`) || r.status !== 0) {
      this.onNotice('Devin 未登录：请先运行 `devin auth login` 完成浏览器授权（只需一次）');
      return;
    }
    const client = new AcpClient({
      cmd: cfg.exe,
      args: ['acp'],
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
      env: cfg.model ? { DEVIN_MODEL: cfg.model } : {}
    });
    this.client = client;
    // ACP 的 agent_message_chunk 是碎片化的（常按字符推送）：缓冲合并成一条 assistant 线程条目
    this._textBuf = null;
    client.onUpdate = u => {
      const uu = u?.update ?? u;
      if (uu?.sessionUpdate === 'agent_message_chunk' && uu.content?.type === 'text') {
        this._textBuf = (this._textBuf ?? '') + uu.content.text;
        this.onText(uu.content.text);
        return;
      }
      this.#flushText();
      if (this.thread) for (const e of acpUpdateEntries(u)) this.thread.add(e.kind, e.data);
      if (uu?.sessionUpdate === 'tool_call') this.onTool(uu.title || 'tool', uu.raw ?? {});
    };
    client.start();
    const boardServer = { name: 'board', ...boardMcpEntry({ agentName: this.agentName, dataFile: this.dataFile, roster: this.roster }) };
    try {
      await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
      // 重建时优先 session/load 恢复原会话上下文（devin 支持 loadSession）；失败降级新会话
      let sessionId = null;
      if (this.sessionId) {
        try {
          const loaded = await client.request('session/load', { sessionId: this.sessionId, cwd: this.cwd, mcpServers: [toAcpMcpServer(boardServer.name, boardServer)] });
          sessionId = loaded?.sessionId ?? this.sessionId;
          this.onNotice('Devin 主会话已重建并恢复原会话上下文');
        } catch { sessionId = null; }
      }
      if (!sessionId) {
        const session = await client.request('session/new', { cwd: this.cwd, mcpServers: [toAcpMcpServer(boardServer.name, boardServer)] });
        sessionId = session.sessionId;
      }
      this.sessionId = sessionId;
    } catch (e) {
      try { client.kill(); } catch {}
      this.onNotice(`Devin 主会话${why}失败: ${e.message}`);
      this.#scheduleRestart();
      return;
    }
    this.startedAt = Date.now();
    this.ready = true;
    this.busy = false;
    this.onNotice(`Devin 主会话已${why}${this.reloadPending ? '（模型已切换，上下文重建为空）' : ''}`);
    this.reloadPending = false;
    this._flush();
  }

  #scheduleRestart() {
    if (this.stopped) return;
    if (Date.now() - this.startedAt > 5 * 60 * 1000) this.restarts = 0; // 稳定跑够 5 分钟则重置计数
    this.restarts++;
    if (this.restarts > MAX_RESTARTS) {
      this.onNotice(`Devin 主会话连续失败 ${this.restarts} 次，放弃重启`);
      return;
    }
    const delay = Math.min(2000 * this.restarts, 15000);
    this.onNotice(`${Math.round(delay / 1000)}s 后重建 Devin 主会话（第 ${this.restarts} 次）…`);
    setTimeout(() => { if (!this.stopped) this.#boot('重建'); }, delay);
  }

  /** ACP 没有系统提示词入口：并入每个新会话的第一条消息；load 恢复的会话历史里已含，不重复 */
  #withSystem(text) {
    if (!this.systemPrompt || this.systemSessionId === this.sessionId) return text;
    this.systemSessionId = this.sessionId;
    return `${this.systemPrompt}\n\n---\n\n${text}`;
  }

  #flushText() {
    if (!this._textBuf) return;
    const text = this._textBuf;
    this._textBuf = null;
    this.thread?.add('assistant', { text });
  }

  send(text) {
    if (this.stopped || !text) return;
    if (this.busy || !this.ready) { this.queue.push(text); return; }
    this._turn(text);
  }

  async _turn(text) {
    this.busy = true;
    const sent = this.#withSystem(text);
    if (sent !== text) this.thread?.add('system', { text: this.systemPrompt, via: 'first-message' });
    this.thread?.add('user', { text });
    try {
      await this.client.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: sent }]
      });
      this.onTurnEnd({});
    } catch (e) {
      this.ready = false;
      this.onNotice(`Devin 主会话回合失败: ${e.message}`);
      this.onTurnEnd({});
      try { this.client?.kill(); } catch {}
      this.#scheduleRestart();
    }
    this.#flushText();
    this.busy = false;
    if (this.stopped) return;
    if (this.reloadPending) {
      this.ready = false;
      try { this.client?.kill(); } catch {}
      this.#boot('重启');
      return;
    }
    if (this.ready && this.queue.length) this._turn(this.queue.splice(0).join('\n\n'));
  }

  // DEVIN_MODEL 在子进程启动时读取：切模型需要重建子进程，回合结束后执行
  requestModelReload() {
    if (this.stopped) return;
    this.reloadPending = true;
    if (!this.busy && this.ready) {
      this.ready = false;
      try { this.client?.kill(); } catch {}
      this.#boot('重启');
    }
  }

  _flush() {
    if (this.busy || this.stopped || !this.ready || !this.queue.length) return;
    this._turn(this.queue.splice(0).join('\n\n'));
  }

  stop() {
    this.stopped = true;
    this.queue.length = 0;
    try { this.client?.kill(); } catch {}
  }
}
