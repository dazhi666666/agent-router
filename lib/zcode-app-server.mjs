// ZCode app-server 常驻会话驱动（zcode / zcode-oss 主代理，阶段二）。
// 一个对话一个 `zcode.cjs app-server --stdio` 子进程；协议为裸 NDJSON（无 jsonrpc 封套）：
//   session/create|resume（MCP 在请求边界下发，不再使用工作区配置文件窗口）
//   session/subscribe → `session/event` 通知（事件与 stream-json 同构，复用同一套解析）
//   v4/command sendText：空闲 startNow；回合中 requestedDelivery:'guide' 软插入当前轮
//   （CLI 在模型请求边界注入，模型同回合可见 —— turn.steerQueued → steerDrained）
// 启动/协议失败时回退 OneShotMainSession（-p 队列模式），由 router 注入的 fallback 工厂创建。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { boardMcpEntry, conversationMcpServers } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

const REVERSE_TIMEOUT = { 'session/requestRuntimePreferences': 10000 };
const STALL_MS = 10 * 60 * 1000; // 回合中无任何事件多久提示一次（CLI 自带网络重试，不强杀）

// ModelUsageSummary → 数值字段（与 lib/zcode.mjs 的 normalizeUsage 同口径）
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const pick = n => { const v = Math.round(Number(n)); return Number.isFinite(v) && v > 0 ? v : 0; };
  const out = {
    inputTokens: pick(u.inputTokens), outputTokens: pick(u.outputTokens),
    totalTokens: pick(u.totalTokens), cacheReadTokens: pick(u.cacheReadTokens),
    cacheWriteTokens: pick(u.cacheWriteTokens), reasoningTokens: pick(u.reasoningTokens),
    modelRequestCount: pick(u.modelRequestCount)
  };
  return out.inputTokens || out.outputTokens ? out : null;
}

/** 协议 mcpServers 条目：stdio 的 env 展开为 [{name,value}]，url 型透传 type/url */
function toProtocolMcpServers(withBoard, agentName) {
  const out = [];
  const convert = (name, e) => {
    if (!e || e.enabled === false) return;
    if (e.command) out.push({
      name, command: e.command, args: e.args || [],
      env: Object.entries(e.env || {}).map(([k, v]) => ({ name: k, value: String(v) }))
    });
    else if (e.url) out.push({ name, type: e.type === 'sse' ? 'sse' : 'http', url: e.url, headers: [] });
  };
  for (const [name, e] of Object.entries(conversationMcpServers() || {})) convert(name, e);
  if (withBoard) {
    try { convert('board', boardMcpEntry({ agentName })); } catch { /* endpoint 未就绪时跳过任务板 */ }
  }
  return out;
}

export class ZcodeAppServerSession {
  /**
   * opts: { kind, entry, resumeId, fallback, cwd, agentName, roster, dataFile, logDir,
   *         systemPrompt, timeoutMs, onText, onTool, onTurnEnd, onNotice, threadPath }
   * fallback: () => OneShotMainSession —— app-server 启动/协议失败时的回退工厂
   */
  constructor({ kind, entry, resumeId = null, fallback = null, cwd, agentName = 'manager', threadPath, systemPrompt = '', onText, onTurnEnd, onNotice }) {
    this.kind = kind;
    this.entry = entry;
    this.resumeId = resumeId;
    this.fallback = fallback;
    this.cwd = cwd;
    this.agentName = agentName;
    this.threadPath = threadPath;
    this.systemPrompt = systemPrompt;
    this.onText = onText || (() => {});
    this.onTurnEnd = onTurnEnd || (() => {});
    this.onNotice = onNotice || (() => {});
    this.sessionId = resumeId; // --resume 语义：init 完成前沿用旧 id 供 status 展示
    this.busy = false;
    this.stopped = false;
    this.backend = null;       // 'appserver' | 'oneshot'
    this.child = null;
    this.pending = new Map();
    this.reqId = 1;
    this.buffered = [];        // init 完成前收到的 send
    this.pendingCompact = false;
    this.textBuf = '';
    this.assistantLogged = false;
    this.contextWindow = null;
    this.lastEventAt = 0;
    this.stallTimer = null;
    this.exitHook = () => { try { this.child?.kill(); } catch {} };
  }

  start() {
    if (this.stopped) return;
    this._init().catch(e => this._fallback(`app-server 会话启动失败，回退 -p 队列模式: ${e.message}`));
  }

  /** 回退到 OneShot（-p 队列模式）：换后端、重放 init 期间收到的消息 */
  _fallback(reason) {
    if (this.backend === 'oneshot' || this.stopped) return;
    this.backend = 'oneshot';
    this._killTree();
    process.removeListener('exit', this.exitHook);
    this.onNotice(reason);
    // 会话链以当前 id 为准（init 期间可能已新建/续接），不能回退到构造时的旧 resumeId
    const one = this.fallback?.(this.sessionId);
    if (!one) { this.onNotice('无可用回退，主会话不可用'); return; }
    this._one = one;
    one.start();
    for (const text of this.buffered.splice(0)) one.send(text);
    if (this.pendingCompact) { this.pendingCompact = false; one.compact?.(); }
  }

  async _init() {
    if (!this.entry || !fs.existsSync(this.entry)) throw new Error(`CLI 入口不存在: ${this.entry || '未配置'}`);
    const child = this.child = spawn(process.execPath, [this.entry, 'app-server', '--stdio'], {
      cwd: this.cwd, windowsHide: true,
      env: { ...process.env, ZCODE_MESSAGE_ENABLED: '0' }
    });
    process.once('exit', this.exitHook);
    child.on('error', e => this._fallback(`app-server 进程启动失败: ${e.message}`));
    child.on('close', code => {
      if (this.backend !== 'appserver' || this.stopped) return;
      this._killTree();
      this._fallback(`app-server 进程退出（码 ${code ?? 'null'}），回退 -p 队列模式`);
    });

    let buf = '';
    child.stdout.on('data', d => {
      this.lastEventAt = Date.now();
      buf += String(d);
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) this._onLine(line);
    });
    child.stderr.on('data', () => {}); // 噪声日志走 stderr，协议只在 stdout

    const cfg = loadConfig();
    const workspace = { workspacePath: this.cwd, workspaceKey: this.cwd };
    const mcpServers = toProtocolMcpServers(true, this.agentName);
    if (this.resumeId) {
      const resumed = await this._request('session/resume', { sessionId: this.resumeId, workspace, mcpServers }, 60000);
      if (resumed.error) throw new Error(`session/resume: ${resumed.error.message || JSON.stringify(resumed.error).slice(0, 200)}`);
    } else {
      const created = await this._request('v4/command', {
        commandId: `cmd-create-${Date.now()}`, clientId: 'agent-router', sessionId: null, issuedAt: Date.now(),
        type: 'createSession',
        payload: { workspaceId: this.cwd, config: { mode: 'yolo' }, mcpServers }
      }, 60000);
      const r = created.result?.result;
      if (created.error || r?.type !== 'createSession' || !r.sessionId) {
        throw new Error(`createSession: ${created.error?.message || r?.message || JSON.stringify(created).slice(0, 200)}`);
      }
      this.sessionId = r.sessionId;
    }
    const sub = await this._request('session/subscribe', { sessionId: this.sessionId, deliveryKind: 'desktop-continuous', includeSnapshot: false }, 30000);
    if (sub.error) throw new Error(`session/subscribe: ${sub.error.message || JSON.stringify(sub.error).slice(0, 200)}`);

    this.backend = 'appserver';
    this.onNotice(`app-server 会话已建立（${this.resumeId ? '续接 ' : '新建 '}${this.sessionId}）`);
    for (const text of this.buffered.splice(0)) this.send(text);
    if (this.pendingCompact) { this.pendingCompact = false; this.compact(); }
  }

  _onLine(line) {
    if (!line.trim().startsWith('{')) return;
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && this.pending.has(msg.id)) {
      const { resolve } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      resolve(msg);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      // 服务端反向请求：运行时偏好按本地直连形态应答；未知方法回 method-not-found（CLI 降级忽略）
      const reply = msg.method === 'session/requestRuntimePreferences'
        ? { id: msg.id, result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: true } }
        : { id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
      try { this.child?.stdin.write(JSON.stringify(reply) + '\n'); } catch {}
      return;
    }
    if (msg.method === 'session/event') this._onEvent(msg.params || {});
  }

  _request(method, params, timeoutMs = 30000) {
    const id = this.reqId++;
    return new Promise(resolve => {
      this.pending.set(id, { resolve });
      try { this.child?.stdin.write(JSON.stringify({ id, method, params }) + '\n'); } catch (e) {
        this.pending.delete(id);
        resolve({ error: { message: e.message } });
      }
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve({ error: { message: `${method} 超时(${timeoutMs}ms)` } }); } }, timeoutMs);
    });
  }

  _onEvent(e) {
    const p = e.payload || {};
    if (e.type === 'model.streaming') {
      const kind = p.kind || '';
      const mid = String(p.assistantMessageId || 'msg');
      if (kind === 'text_delta' && p.delta) {
        this.textBuf += p.delta;
        const streamPath = this.threadPath ? this.threadPath.replace(/\.jsonl$/, '') + '.stream.jsonl' : null;
        if (streamPath) { try { fs.appendFileSync(streamPath, JSON.stringify({ id: mid, t: Date.now(), text: p.delta }) + '\n'); } catch {} }
      } else if (/thinking|reasoning/.test(kind) && kind.endsWith('_delta') && p.delta) {
        this.thinkBuf = (this.thinkBuf || '') + p.delta;
      }
      if ((kind === 'text_end' || kind === 'finish') && this.textBuf) {
        const text = this.textBuf; this.textBuf = '';
        const thread = this.threadPath ? createThreadWriter(this.threadPath) : null;
        thread?.add('assistant', { text });
        this.onText(text);
        this.assistantLogged = true;
        const sp = this.threadPath ? this.threadPath.replace(/\.jsonl$/, '') + '.stream.jsonl' : null;
        if (sp) { try { fs.appendFileSync(sp, JSON.stringify({ id: mid, done: 1 }) + '\n'); } catch {} }
      }
      if ((/thinking|reasoning/.test(kind) && kind.endsWith('_end') || kind === 'finish') && this.thinkBuf) {
        if (this.threadPath) createThreadWriter(this.threadPath).add('thought', { text: this.thinkBuf });
        this.thinkBuf = '';
      }
      return;
    }
    if (e.type === 'tool.updated') {
      if (p.input !== undefined && p.toolName) {
        if (this.threadPath) createThreadWriter(this.threadPath).add('tool_use', { id: p.toolCallId, name: p.toolName, input: p.input });
      } else if (p.result !== undefined && p.toolCallId) {
        if (this.threadPath) createThreadWriter(this.threadPath).add('tool_result', { id: p.toolCallId, text: String(p.result?.content ?? ''), isError: p.result?.success === false });
      }
      return;
    }
    if (e.type === 'session.updated') {
      const w = Number(p.contextWindow);
      if (Number.isFinite(w) && w > 0) this.contextWindow = w;
      return;
    }
    if (e.type === 'turn.started') {
      this.busy = true;
      this.lastEventAt = Date.now();
      clearTimeout(this.stallTimer);
      this.stallTimer = setInterval(() => {
        if (!this.busy || Date.now() - this.lastEventAt < STALL_MS) return;
        this.lastEventAt = Date.now();
        this.onNotice(`主会话回合已 ${Math.round(STALL_MS / 60000)} 分钟无事件（CLI 内部重试中，继续等待）`);
      }, 30000);
      return;
    }
    if (e.type === 'turn.completed' || e.type === 'turn.failed') {
      this.busy = false;
      clearInterval(this.stallTimer);
      const text = String(p.response ?? '').trim();
      const isError = e.type === 'turn.failed' || String(p.resultType ?? 'success') !== 'success';
      const usage = normalizeUsage(p.usage);
      const tokenCount = Number.isFinite(Number(p.tokenCount)) ? Math.round(Number(p.tokenCount)) : null;
      if (text && !this.assistantLogged && this.threadPath) createThreadWriter(this.threadPath).add('assistant', { text });
      this.assistantLogged = false;
      if (this.threadPath) createThreadWriter(this.threadPath).add('result', {
        text: text || (isError ? '会话失败' : ''), isError,
        ...(usage ? { usage } : {}),
        ...(tokenCount !== null ? { tokenCount } : {}),
        ...(this.contextWindow ? { contextWindow: this.contextWindow } : {})
      });
      if (text) this.onText(text);
      this.onTurnEnd({});
      if (this.pendingCompact && !this.stopped) { this.pendingCompact = false; this.compact(); }
      return;
    }
    // turn.steerQueued / steerDrained / session.titleUpdated 等不落线程：
    // steer 的用户条目已在 send 时写入，注入行为由 steerDrained 后的模型输出自然体现
  }

  send(text) {
    if (this.stopped || !text) return;
    if (this.backend === 'oneshot') return this._one.send(text);
    if (!this.backend) { this.buffered.push(text); return; }
    this._sendAppServer(text);
  }

  _sendAppServer(text) {
    const thread = this.threadPath ? createThreadWriter(this.threadPath) : null;
    // 系统提示词并入新会话首条消息（resume 的会话已带历史，不重注入）
    let prompt = text;
    if (!this.resumeId && !this._systemFolded && this.systemPrompt) {
      this._systemFolded = true;
      thread?.add('system', { text: this.systemPrompt, via: 'first-message' });
      prompt = `${this.systemPrompt}\n\n---\n\n${text}`;
    }
    thread?.add('user', { text, ...(this.busy ? { queued: true, steer: true } : {}) });
    const cfg = loadConfig();
    const main = cfg.main || {};
    const ckind = cfg[this.kind] || {};
    const model = main.model || ckind.model;
    const effort = main.effort || ckind.effort;
    const modelSelection = (model || effort) ? {
      ...(model ? (() => { const s = model.indexOf('/'); return { providerId: model.slice(0, s), modelId: model.slice(s + 1) }; })() : {}),
      ...(effort ? { options: { reasoningLevel: effort } } : {})
    } : undefined;
    this._request('v4/command', {
      commandId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      clientId: 'agent-router', sessionId: this.sessionId, issuedAt: Date.now(),
      type: 'sendText',
      payload: {
        text: prompt,
        // 回合中 guide = 软插入当前轮（模型请求边界注入，不打断）；空闲 startNow 立即开轮
        requestedDelivery: this.busy ? 'guide' : 'startNow',
        inputOrigin: 'desktop',
        ...(modelSelection ? { modelSelection } : {})
      }
    }, 30000).then(res => {
      if (res.error) this.onNotice(`消息投递失败: ${res.error.message || '未知错误'}`);
      else if (res.result?.status === 'accepted' && !this.busy) this.busy = true; // 乐观置忙，turn.started 复核
    });
  }

  /** 主动上下文压缩：走 session/compact（回合中拒绝 → 挂起到回合结束） */
  compact() {
    if (this.stopped) return;
    if (this.backend === 'oneshot') return this._one.compact?.();
    if (!this.backend) { this.pendingCompact = true; return; }
    if (this.busy) { this.pendingCompact = true; return; }
    if (this.threadPath) createThreadWriter(this.threadPath).add('user', { text: '/compact' });
    this._request('session/compact', { sessionId: this.sessionId }, 60000).then(res => {
      if (res.error) this.onNotice(`压缩请求失败: ${res.error.message || '未知错误'}`);
    });
  }

  // 模型配置每次 send 都重读（runtime-config.json 即时生效），无需重启动作
  requestModelReload() {}

  // Windows 下 app-server 携带 MCP 孙进程，直接 kill 杀不干净（管道不关、父进程退不出）：
  // 用 taskkill /T 连树终结，与其余 CLI 进程的停止方式一致
  _killTree() {
    if (!this.child) return;
    if (process.platform === 'win32' && this.child.pid) {
      try { spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true }); return; } catch {}
    }
    try { this.child.kill(); } catch {}
  }

  stop() {
    this.stopped = true;
    clearInterval(this.stallTimer);
    if (this._one) { this._one.stop(); return; }
    if (this.backend === 'appserver' && this.sessionId) {
      this._request('session/close', { sessionId: this.sessionId }, 5000).finally(() => this._killTree());
    } else {
      this._killTree();
    }
    process.removeListener('exit', this.exitHook);
  }
}
