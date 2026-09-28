// Minimal ACP (Agent Client Protocol) client over stdio — enough to drive
// `devin acp` or any ACP-speaking agent: initialize → session/new → session/prompt.
// The board MCP server is attached per-session via session/new mcpServers.
import readline from 'node:readline';
import { spawn } from 'node:child_process';

export class AcpClient {
  constructor({ cmd, args, cwd, timeoutMs = 900000, env, onChild }) {
    this.cmd = cmd;
    this.args = args;
    this.cwd = cwd;
    this.env = env || {};
    this.onChild = onChild;
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = new Map(); // id -> {resolve, reject}
    this.updates = [];        // session/update notifications
  }

  start() {
    this.child = spawn(this.cmd, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      windowsHide: true
    });
    if (this.onChild) try { this.onChild(this.child); } catch {}
    this.child.on('error', e => this.#failAll(e));
    this.child.on('close', code => this.#failAll(new Error(`ACP 进程退出 (${code})`)));
    const rl = readline.createInterface({ input: this.child.stdout, terminal: false });
    rl.on('line', line => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`ACP error ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method === 'session/request_permission') {
        // 完全访问模式：自动选择"允许"选项回复，子代理使用任何工具都不需要用户确认
        const options = Array.isArray(msg.params?.options) ? msg.params.options : [];
        const pick = options.find(o => o.kind === 'allow_always')
          || options.find(o => o.kind === 'allow_once')
          || options.find(o => !String(o.kind || '').startsWith('reject'))
          || options[0];
        const result = pick
          ? { outcome: { outcome: 'selected', optionId: pick.optionId } }
          : { outcome: { outcome: 'cancelled' } };
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
      } else if (msg.method === 'session/update') {
        this.updates.push(msg.params);
        this.onUpdate?.(msg.params);
      }
    });
  }

  #failAll(e) {
    for (const [, p] of this.pending) p.reject(e);
    this.pending.clear();
  }

  request(method, params) {
    const id = ++this.nextId;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP 请求超时: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      });
      this.child.stdin.write(msg);
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  updateText(update) {
    // session/update 的 params 形如 {sessionId, update:{sessionUpdate,...}}（也兼容直接传 update 对象）
    const u = update?.update ?? update;
    // sessionUpdate "agent_message_chunk" carries {content:{type:"text",text}}
    if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
      return u.content.text;
    }
    return null;
  }

  kill() {
    try { this.child.kill(); } catch {}
  }
}

/**
 * Run one ACP agent turn. opts: { cmd, args, cwd, prompt, mcpServers, timeoutMs, onText, resumeSessionId }
 * resumeSessionId 传入时优先 session/load 恢复会话，失败自动降级为新会话。
 * Returns { sessionId, text, updates }.
 */
export async function runAcp(opts) {
  const { cmd, args = [], cwd, prompt, mcpServers = [], timeoutMs = 900000, onText = () => {}, env, onChild, onUpdate, resumeSessionId } = opts;
  const client = new AcpClient({ cmd, args, cwd, timeoutMs, env, onChild });
  client.start();
  client.onUpdate = u => {
    onUpdate?.(u);
    const t = client.updateText(u);
    if (t) onText(t);
  };
  try {
    await client.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {}
    });
  } catch (e) {
    client.kill();
    throw e;
  }
  try {
    let sessionId = null;
    if (resumeSessionId) {
      try {
        const loaded = await client.request('session/load', { sessionId: resumeSessionId, cwd, mcpServers });
        sessionId = loaded?.sessionId ?? resumeSessionId;
      } catch {
        sessionId = null; // agent 不支持 session/load 或会话已失效 → 降级新会话
      }
    }
    if (!sessionId) {
      const session = await client.request('session/new', { cwd, mcpServers });
      sessionId = session.sessionId;
    }
    const result = await client.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: prompt }]
    });
    const text = client.updates
      .map(u => client.updateText(u))
      .filter(Boolean)
      .join('');
    return { sessionId, text, stopReason: result?.stopReason ?? null, updates: client.updates };
  } finally {
    client.kill();
  }
}
