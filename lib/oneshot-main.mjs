// 「主代理」会话（回合串联模式）——适用于没有常驻双向流的 CLI：zcode / zcode-oss / codex / opencode。
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

const RUNNERS = {
  zcode: runZcode,
  'zcode-oss': opts => runZcode({ configKind: 'zcode-oss', ...opts }), // 类型默认（模型/思考强度）读 zcode-oss 段
  codex: runCodex, opencode: runOpencode
};

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
    this.pendingCompact = false; // 压缩请求挂起：当前回合结束后单独执行
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
    if (this.busy) { this._enqueue(text); return; }
    this._runTurn(text);
  }

  // 中途到来的消息：立即写入线程（位置与时间戳=发送时刻，刷新/重连不丢，乐观气泡立刻回执），
  // 当前回合结束后合并成一条 prompt 进入下一回合
  _enqueue(text) {
    const thread = this.threadPath ? createThreadWriter(this.threadPath) : null;
    thread?.add('user', { text, queued: true });
    this.queue.push(text);
  }

  // 主动上下文压缩（zcode 系 CLI 内建 /compact）：独占下一回合，不与文本队列混合
  // （拼在合并文本中间会破坏斜杠行语义）；连续多次请求合并为一次
  compact() {
    if (this.stopped) return;
    this.pendingCompact = true;
    if (!this.busy) this._drain();
  }

  async _runTurn(text, viaQueue = false) {
    this.busy = true;
    this.turn++;
    // 每回合新建 writer（适配器内部也会按 threadPath 续 seq 建自己的 writer，
    // 复用旧实例会导致 seq 回卷），先写 user 条目再交给适配器续写
    const thread = this.threadPath ? createThreadWriter(this.threadPath) : null;
    // 这类 CLI 没有系统提示词入口：并入新会话的第一条消息（回合失败重开会话时重新注入）
    const foldSystem = !this.sessionId && !!this.systemPrompt;
    if (foldSystem) thread?.add('system', { text: this.systemPrompt, via: 'first-message' });
    if (!viaQueue) thread?.add('user', { text }); // 队列 flush 的消息已在入队时上屏
    const prompt = foldSystem ? `${this.systemPrompt}\n\n---\n\n${text}` : text;
    try {
      const runner = RUNNERS[this.kind];
      let streamed = false; // codex 回合内会流式回调 onText；zcode --json 只在结束时给全文
      // 主代理单独选的模型（runtime-config.json 的 main 段）每回合重读：保存后下一回合即生效
      const main = loadConfig().main || {};
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
        ...(main.model ? { model: main.model } : {}),
        ...(main.variant ? { variant: main.variant } : {}),
        ...(main.effort ? { effort: main.effort } : {}),
        onText: t => { streamed = true; this.onText(t); }
      });
      if (!streamed && res.text) this.onText(res.text);
      if (res.sessionId) this.sessionId = res.sessionId;
      this.onTurnEnd(res.raw ?? {});
    } catch (e) {
      // 会话链不作废：回合失败多是瞬时故障（断网/API 抖动/进程被杀），本轮消息与会话都
      // 还在 CLI 侧存着，下回合 --resume 原会话续跑；只有拿不到任何会话 id 才重开新会话
      // （此时系统提示词会在下回合重新注入首条消息）
      if (e.sessionId) this.sessionId = e.sessionId;
      this.onNotice(`主会话回合失败（下回合${e.sessionId ? `续接会话 ${e.sessionId}` : '重开会话'}）: ${e.message}`);
      this.onTurnEnd({});
    }
    this.busy = false;
    if (this.stopped) return;
    this._drain();
  }

  // 回合收尾后的队列排水：压缩请求优先于文本队列（压缩后上下文更省，排队消息一并受益）
  _drain() {
    if (this.busy || this.stopped) return;
    if (this.pendingCompact) {
      this.pendingCompact = false;
      this._runTurn('/compact');
      return;
    }
    if (this.queue.length) this._runTurn(this.queue.splice(0).join('\n\n'), true);
  }

  // 模型配置每回合启动时重新读取（runtime-config.json 生效于下一回合），无需重启动作
  requestModelReload() {}

  stop() {
    this.stopped = true;
    this.queue.length = 0;
  }
}
