// 「主代理」会话（回合串联模式）——适用于没有常驻双向流的 CLI：zcode / codex / opencode。
// 每个回合 = 一次 headless 运行（zcode -p / codex exec / opencode run），用上一回合返回的
// sessionId 续链上下文（--resume / -s）；主代理 cwd 固定不变，因此 resume 是安全的
// （不存在跨目录 shell 快照问题）。注入语义与 claude 版 MainSession 一致：忙碌期间到来的
// 事件排队，回合结束后合并成一条消息进入下一回合。
// 差异：回合内没有实时输出流（zcode --json / opencode run --format json 均在回合结束才产出
// 全文；codex exec --json 有回合内流式），工具事件不实时上屏。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { runZcode } from './zcode.mjs';
import { runCodex } from './codex.mjs';
import { runOpencode } from './opencode.mjs';
import { createThreadWriter } from './thread.mjs';

const RUNNERS = { zcode: runZcode, codex: runCodex, opencode: runOpencode };

export class OneShotMainSession {
  /**
   * opts: { kind: 'zcode'|'codex'|'opencode', cwd, agentName, roster, dataFile, logDir,
   *         systemPrompt, timeoutMs, onText, onTool, onTurnEnd, onNotice, threadPath }
   */
  constructor({ kind, runnerOptions = {}, resumeId = null, cwd, agentName = 'manager', roster, dataFile, logDir, systemPrompt = '', timeoutMs = 0, onText, onTool, onTurnEnd, onNotice, threadPath }) {
    this.kind = kind;
    this.runnerOptions = runnerOptions; // 额外的 runner 参数（如对话模型经 gateway 跑 codex）
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
    this.threadPath = threadPath;
    this.queue = [];
    this.busy = false;
    this.sessionId = resumeId; // --resume 续接上次会话   // 上一回合的会话 id，用于续链
    this.turn = 0;
    this.stopped = false;
  }

  start() {
    // 每回合独立起进程，没有常驻子进程；这里只做可用性预检
    const cfg = loadConfig()[this.kind] || {};
    const exe = cfg.entry || cfg.exe || '';
    if (!exe || (path.isAbsolute(exe) && !fs.existsSync(exe))) {
      this.onNotice(`主代理 ${this.kind} 的 CLI 未找到（${exe || '未配置'}），请先安装或检查 router.config.json`);
    }
  }

  send(text) {
    if (this.stopped || !text) return;
    if (this.busy) { this.queue.push(text); return; }
    this._runTurn(text);
  }

  async _runTurn(text) {
    this.busy = true;
    this.turn++;
    // 每回合新建 writer（适配器内部也会按 threadPath 续 seq 建自己的 writer，
    // 复用旧实例会导致 seq 回卷），先写 user 条目再交给适配器续写
    const thread = this.threadPath ? createThreadWriter(this.threadPath) : null;
    // 这类 CLI 没有系统提示词入口：并入新会话的第一条消息（回合失败重开会话时重新注入）
    const foldSystem = !this.sessionId && !!this.systemPrompt;
    if (foldSystem) thread?.add('system', { text: this.systemPrompt, via: 'first-message' });
    thread?.add('user', { text });
    const prompt = foldSystem ? `${this.systemPrompt}\n\n---\n\n${text}` : text;
    try {
      const runner = RUNNERS[this.kind];
      let streamed = false; // codex 回合内会流式回调 onText；zcode --json 只在结束时给全文
      const res = await runner({
        ...this.runnerOptions,
        prompt,
        cwd: this.cwd,
        agentName: this.agentName,
        roster: this.roster,
        dataFile: this.dataFile,
        logDir: this.logDir,
        timeoutMs: this.timeoutMs,
        resumeSessionId: this.sessionId,
        threadPath: this.threadPath,
        onText: t => { streamed = true; this.onText(t); }
      });
      if (!streamed && res.text) this.onText(res.text);
      if (res.sessionId) this.sessionId = res.sessionId;
      this.onTurnEnd(res.raw ?? {});
    } catch (e) {
      this.sessionId = null; // 会话链不可靠，下一回合从新会话开始（系统提示词会重新注入）
      this.onNotice(`主会话回合失败（下回合重开会话）: ${e.message}`);
      this.onTurnEnd({});
    }
    this.busy = false;
    if (this.stopped) return;
    if (this.queue.length) this._runTurn(this.queue.splice(0).join('\n\n'));
  }

  // 模型配置每回合启动时重新读取（runtime-config.json 生效于下一回合），无需重启动作
  requestModelReload() {}

  stop() {
    this.stopped = true;
    this.queue.length = 0;
  }
}
