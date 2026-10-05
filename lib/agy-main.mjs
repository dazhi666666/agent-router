// 常驻「主代理」Antigravity 会话 —— agy 的 stream-json 双向流模式。
// `agy --input-format stream-json --output-format stream-json`：stdin 每行一条
// {"event":"user","message":{"content":...}}，每个回合一个 result 事件，结构与
// claude 的 MainSession 同构。agy 没有系统提示词入口：并入新会话的第一条消息。
// 任务板 MCP 经工作区级 .agents/mcp_config.json 注入（start 写入 / stop 还原）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { boardMcpEntry } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

const IDLE_WATCHDOG_MS = 10 * 60 * 1000; // 持续无输出超过此时长则强制重启续命
const MAX_RESTARTS = 8;

export class AgyMainSession {
  /**
   * opts: {
   *   cwd, agentName, roster, dataFile, logDir, systemPrompt,
   *   onText(text), onTool(name, input), onTurnEnd(resultEvent), onNotice(message)
   * }
   */
  constructor({ resumeId = null, cwd, agentName = 'manager', roster, dataFile, logDir, systemPrompt = '', onText, onTool, onTurnEnd, onNotice, threadPath }) {
    this.cwd = cwd;
    this.agentName = agentName;
    this.roster = roster;
    this.dataFile = dataFile;
    this.logDir = logDir;
    this.systemPrompt = systemPrompt;
    this.thread = threadPath ? createThreadWriter(threadPath) : null;
    this.onText = onText || (() => {});
    this.onTool = onTool || (() => {});
    this.onTurnEnd = onTurnEnd || (() => {});
    this.onNotice = onNotice || (() => {});
    this.queue = [];
    this.busy = false;
    this.sessionId = resumeId; // --resume 续接上次会话
    this.stopped = false;
    this.restarts = 0;
    this.child = null;
    this.watchdog = null;
    this.startedAt = 0;
    this.errTail = '';
    this.textBuf = '';      // agent_response 步骤的文本聚合（一个步骤一条线程条目）
    this.systemSent = false;
  }

  start() {
    const cfg = loadConfig().antigravity;
    this.#writeMcpConfig();
    this._spawn(cfg, this.sessionId);
  }

  /** 工作区级 MCP 配置：写入 board（stop 时还原；router 已把该文件加入 .git/info/exclude） */
  #writeMcpConfig() {
    const agyDir = path.join(this.cwd, '.agents');
    fs.mkdirSync(agyDir, { recursive: true });
    this.mcpFile = path.join(agyDir, 'mcp_config.json');
    this.mcpBackup = fs.existsSync(this.mcpFile) ? fs.readFileSync(this.mcpFile) : null;
    let mcfg = {};
    try { mcfg = this.mcpBackup ? JSON.parse(this.mcpBackup.toString('utf8')) : {}; } catch {}
    const board = boardMcpEntry({ agentName: this.agentName, dataFile: this.dataFile, roster: this.roster });
    mcfg.mcpServers = { ...(mcfg.mcpServers || {}), board: { command: board.command, args: board.args, env: board.env } };
    fs.writeFileSync(this.mcpFile, JSON.stringify(mcfg, null, 1));
  }

  #restoreMcpConfig() {
    if (!this.mcpFile) return;
    try {
      if (this.mcpBackup) fs.writeFileSync(this.mcpFile, this.mcpBackup);
      else { try { fs.unlinkSync(this.mcpFile); } catch {} try { fs.rmdirSync(path.dirname(this.mcpFile)); } catch {} }
    } catch {}
  }

  _spawn(cfg, resumeId) {
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--dangerously-skip-permissions'];
    if (resumeId) args.push('--conversation', resumeId);
    if (cfg.model) args.push('--model', cfg.model);
    if (cfg.effort) args.push('--effort', cfg.effort);
    const env = {};
    if (cfg.proxy) { env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; }
    let child;
    try {
      child = spawn(cfg.exe, args, { cwd: this.cwd, env: { ...process.env, ...env }, windowsHide: true });
    } catch (e) {
      this.onNotice(`主会话启动失败: ${e.message}`);
      return;
    }
    this.child = child;
    this.startedAt = Date.now();
    this.errTail = '';
    if (resumeId) this.systemSent = true; // 续命重启：系统提示词已在会话上下文里
    this.streamLog = fs.createWriteStream(path.join(this.logDir, 'manager-stream.log'), { flags: 'a' });
    this.streamLog.write(`\n===== ${new Date().toISOString()} spawn${resumeId ? ' (resume)' : ''} =====\n`);

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
      this._feedWatchdog();
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) this._handleLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { this.errTail = (this.errTail + d).slice(-4000); });
    child.on('error', e => { this.errTail += `\nspawn error: ${e.message}`; });
    child.on('close', code => this._onClose(code));
    this._feedWatchdog();
  }

  _handleLine(line) {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    try { this.streamLog.write(line + '\n'); } catch {}
    if (ev.event === 'init') {
      if (ev.conversation_id) this.sessionId = ev.conversation_id;
      this.busy = false;
      this._flush();
    } else if (ev.event === 'step_update') {
      const s = ev.step_update || {};
      if (s.step_type === 'agent_response') {
        if (s.text_delta) { this.textBuf += s.text_delta; this.onText(s.text_delta); }
        if (s.state === 'DONE') {
          if (this.textBuf) this.thread?.add('assistant', { text: this.textBuf });
          this.textBuf = '';
        }
      } else if (s.step_type === 'tool') {
        if (s.state === 'ACTIVE') this.onTool(s.tool_name || 'tool', s.tool_info || {});
        if (s.state === 'DONE') this.thread?.add('tool_use', { id: s.step_index, name: s.tool_name || 'tool', status: 'done', info: s.tool_info ?? null });
      }
    } else if (ev.event === 'result') {
      const r = ev.result || {};
      this.busy = false;
      if (this.textBuf) { this.thread?.add('assistant', { text: this.textBuf }); this.textBuf = ''; }
      const isError = r.status ? r.status !== 'SUCCESS' : false;
      this.thread?.add('result', { text: String(r.response || ''), isError });
      if (isError) this.onNotice(`主会话回合出错: ${String(r.error || r.status).slice(0, 200)}`);
      this.onTurnEnd(r);
      if (this.modelReload) { this.modelReload = false; this.child?.kill(); }
      else this._flush();
    }
  }

  /** 注入一条 user 消息;忙碌时排队,空闲时立即写入 */
  send(text) {
    if (this.stopped || !text) return;
    if (this.busy || !this.child?.stdin?.writable) { this.queue.push(text); return; }
    this._write(text);
  }

  _write(text) {
    this.busy = true;
    // agy 无系统提示词入口：新会话的第一条消息里并入（续命重启不重复注入）
    let content = text;
    if (!this.systemSent && this.systemPrompt) {
      content = `${this.systemPrompt}\n\n---\n\n${text}`;
      this.thread?.add('system', { text: this.systemPrompt, via: 'first-message' });
    }
    this.systemSent = true;
    this.thread?.add('user', { text });
    this._feedWatchdog();
    const msg = JSON.stringify({ event: 'user', message: { content } }) + '\n';
    try { this.child.stdin.write(msg); } catch {
      this.busy = false;
      this.queue.push(text);
    }
  }

  _flush() {
    if (this.busy || this.stopped || !this.queue.length) return;
    if (!this.child?.stdin?.writable) return;
    const text = this.queue.splice(0).join('\n\n');
    this._write(text);
  }

  _feedWatchdog() {
    clearTimeout(this.watchdog);
    if (this.stopped) return;
    this.watchdog = setTimeout(() => {
      this.onNotice(`主会话超过 ${Math.round(IDLE_WATCHDOG_MS / 60000)} 分钟无输出，强制重启续命…`);
      try { this.child.kill('SIGKILL'); } catch {}
    }, IDLE_WATCHDOG_MS);
  }

  _onClose(code) {
    clearTimeout(this.watchdog);
    try { this.streamLog?.end(`===== close code=${code} =====\n`); } catch {}
    this.child = null;
    if (this.stopped) return;
    this.busy = false;
    if (Date.now() - this.startedAt > 5 * 60 * 1000) this.restarts = 0; // 稳定跑够 5 分钟则重置计数
    this.restarts++;
    if (this.restarts > MAX_RESTARTS) {
      this.onNotice(`主会话连续退出 ${this.restarts} 次，放弃重启。stderr 尾部: ${this.errTail.slice(-300)}`);
      return;
    }
    const delay = Math.min(2000 * this.restarts, 15000);
    this.onNotice(`主会话进程退出(code=${code})，${Math.round(delay / 1000)}s 后 --conversation 续命重启…`);
    setTimeout(() => { if (!this.stopped) this._spawn(loadConfig().antigravity, this.sessionId); }, delay);
  }

  requestModelReload() {
    if (this.stopped) return;
    if (this.busy) this.modelReload = true;
    else this.child?.kill();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.watchdog);
    try { this.child?.kill(); } catch {}
    this.#restoreMcpConfig();
  }
}
