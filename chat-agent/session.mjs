// ChatAgentSession: turns a chat-only model into a persistent agent session.
// Each turn: call the model → run the tool calls it wrote (host-provided `invoke`) → send the results back →
// repeat until a reply has no tool calls. Messages that arrive while a turn is running are queued and delivered
// together with the next tool results (or as the next turn). History is saved to a JSON file per session so the
// session can be resumed by id.
//
// The session API (start / send / busy / sessionId / stop / requestModelReload and the on* callbacks) matches
// Agent Router's other main-agent sessions, but nothing here depends on Agent Router.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { protocolPrompt, parseReply, formatResults } from './protocol.mjs';

const TRIM_NOTE = '[Earlier messages in this conversation were removed to fit the context window.]';

export class ChatAgentSession {
  /**
   * @param {object} o
   * @param {object | (() => Promise<object>)} o.provider  provider, or a function returning one (called every turn,
   *        so configuration changes take effect on the next turn)
   * @param {string} o.systemPrompt
   * @param {object[]} o.tools  [{ name, description, inputSchema }]
   * @param {(name: string, args: object) => any} o.invoke  runs a tool; may return a promise; errors become tool errors
   * @param {string} o.stateDir  where session histories are stored
   * @param {string} [o.resumeId]  resume this session if its history exists
   * @param {number} [o.maxSteps]  model calls per turn before the turn is cut off
   * @param {number} [o.maxContextChars]  history budget; oldest messages are dropped beyond it
   * @param {(kind: string, data: object) => void} [o.onEntry]  transcript entries: system/user/assistant/thought/tool_use/tool_result/result
   */
  constructor({ provider, systemPrompt = '', tools = [], invoke, stateDir, resumeId = null, maxSteps = 30, maxContextChars = 400000, retries = 2, retryDelayMs = 3000, onText, onTool, onTurnEnd, onNotice, onEntry }) {
    this.getProvider = typeof provider === 'function' ? provider : async () => provider;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.invoke = invoke;
    this.stateDir = stateDir;
    this.maxSteps = maxSteps;
    this.maxContextChars = maxContextChars;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.onText = onText || (() => {});
    this.onTool = onTool || (() => {});
    this.onTurnEnd = onTurnEnd || (() => {});
    this.onNotice = onNotice || (() => {});
    this.onEntry = onEntry || (() => {});
    this.sessionId = resumeId;
    this.messages = [];
    this.queue = [];
    this.busy = false;
    this.stopped = false;
    this.abort = null;
  }

  get file() { return path.join(this.stateDir, `${this.sessionId}.json`); }

  start() {
    let restored = false;
    if (this.sessionId) {
      try { this.messages = JSON.parse(fs.readFileSync(this.file, 'utf8')).messages || []; restored = this.messages.length > 0; }
      catch { this.onNotice(`会话 ${this.sessionId} 的记录不存在，开启新会话`); }
    }
    if (!restored) this.sessionId = `chat-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    // 系统提示词总用当前版本（花名册、工具可能已变化）
    const system = [this.systemPrompt, protocolPrompt(this.tools)].filter(Boolean).join('\n\n');
    if (restored && this.messages[0]?.role === 'system') this.messages[0].content = system;
    else this.messages.unshift({ role: 'system', content: system });
    if (!restored) this.onEntry('system', { text: system, via: 'system-message' });
    this.save();
  }

  send(text) {
    if (this.stopped || !text) return;
    if (this.busy) { this.queue.push(text); return; }
    this.runTurn(text);
  }

  requestModelReload() {} // the provider is re-resolved every turn

  stop() {
    this.stopped = true;
    this.queue.length = 0;
    this.abort?.abort();
  }

  save() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ sessionId: this.sessionId, updatedAt: new Date().toISOString(), messages: this.messages }));
      fs.renameSync(tmp, this.file);
    } catch {}
  }

  /** Append a user message, merging with a trailing user message (some APIs require alternating roles). */
  pushUser(content) {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'user') last.content += `\n\n${content}`;
    else this.messages.push({ role: 'user', content });
  }

  /** Drop the oldest messages (after the system prompt) until the history fits the budget. */
  trim() {
    const size = () => this.messages.reduce((n, m) => n + m.content.length, 0);
    if (size() <= this.maxContextChars) return;
    while (this.messages.length > 2 && size() > this.maxContextChars) this.messages.splice(1, 1);
    while (this.messages.length > 2 && this.messages[1].role !== 'user') this.messages.splice(1, 1);
    if (this.messages[1] && !this.messages[1].content.startsWith(TRIM_NOTE)) this.messages[1].content = `${TRIM_NOTE}\n\n${this.messages[1].content}`;
  }

  async complete() {
    for (let attempt = 0; ; attempt++) {
      this.abort = new AbortController();
      try {
        const provider = await this.getProvider();
        return await provider.complete(this.messages, { signal: this.abort.signal });
      } catch (e) {
        if (this.stopped || attempt >= this.retries) throw e;
        this.onNotice(`模型调用失败，重试中（${attempt + 1}/${this.retries}）: ${e.message}`);
        await new Promise(r => setTimeout(r, this.retryDelayMs * (attempt + 1)));
      } finally { this.abort = null; }
    }
  }

  async runTurn(text) {
    this.busy = true;
    this.onEntry('user', { text });
    this.pushUser(text);
    let lastText = '';
    try {
      for (let step = 0; ; step++) {
        if (step >= this.maxSteps) {
          this.pushUser(`[Router] This turn used ${this.maxSteps} model calls and was stopped. Summarize where things stand for the user.`);
          this.onNotice(`本回合模型调用达到上限 ${this.maxSteps}，已停止`);
          break;
        }
        this.trim();
        const res = await this.complete();
        if (this.stopped) return;
        if (res.reasoning) this.onEntry('thought', { text: res.reasoning });
        const { text: visible, calls } = parseReply(res.text);
        this.messages.push({ role: 'assistant', content: res.text || '(empty reply)' });
        if (visible) { lastText = visible; this.onEntry('assistant', { text: visible }); this.onText(visible); }
        if (!calls.length) break;
        const results = [];
        for (const [i, call] of calls.entries()) {
          const id = `${this.sessionId}-${Date.now().toString(36)}-${i}`;
          if (call.error) {
            this.onEntry('tool_result', { id, text: `malformed tool call: ${call.error}`, isError: true });
            results.push({ name: 'invalid', error: `Malformed tool call (${call.error}). Write one JSON object: {"name": "...", "arguments": {...}}` });
            continue;
          }
          this.onTool(call.name, call.arguments);
          this.onEntry('tool_use', { id, name: call.name, input: call.arguments });
          let value, error = null;
          try {
            if (!this.tools.some(t => t.name === call.name)) throw new Error(`unknown tool ${call.name}`);
            value = await this.invoke(call.name, call.arguments);
            if (value && typeof value === 'object' && value.error) error = value.error;
          } catch (e) { error = e.message || String(e); }
          if (this.stopped) return;
          this.onEntry('tool_result', { id, text: error ? String(error) : typeof value === 'string' ? value : JSON.stringify(value, null, 1), isError: !!error });
          results.push({ name: call.name, value, error });
        }
        // 回合进行中到达的消息随工具结果一起送达，不必等整个回合结束
        const queued = this.queue.splice(0);
        for (const q of queued) this.onEntry('user', { text: q });
        this.pushUser([formatResults(results), ...queued].join('\n\n'));
        this.save();
      }
      this.onEntry('result', { text: lastText, isError: false });
    } catch (e) {
      if (this.stopped) return;
      this.onNotice(`回合失败: ${e.message}`);
      this.onEntry('result', { text: `模型调用失败: ${e.message}`, isError: true });
    } finally {
      this.save();
      this.busy = false;
    }
    if (this.stopped) return;
    this.onTurnEnd({});
    if (this.queue.length && !this.busy) this.runTurn(this.queue.splice(0).join('\n\n'));
  }
}
