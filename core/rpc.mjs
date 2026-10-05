// Router 的本地 RPC 端点：各 agent 的 board MCP 代理（lib/board-server.mjs）把 tools/list、tools/call
// 原样转发到这里。只监听 127.0.0.1，并用每次运行随机生成的 token 鉴权。
import http from 'node:http';
import crypto from 'node:crypto';
import { toolsFor, callTool } from './tools.mjs';

/**
 * @param {{ board: import('./board.mjs').Board, roster: object[], chat?: boolean,
 *           cancel?: Function, onCall?: (caller: string, name: string, args: object) => void }} ctx
 * @returns {Promise<{ url: string, token: string, close: () => void }>}
 */
export function startRpcServer(ctx) {
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'POST' || req.url !== '/rpc') return reply(404, { error: 'not found' });
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'unauthorized' });
    const caller = String(req.headers['x-agent'] || '');
    if (caller !== 'manager' && !ctx.roster.some(r => r.name === caller)) return reply(403, { error: `unknown agent ${caller}` });
    let body = '';
    for await (const chunk of req) body += chunk;
    let msg;
    try { msg = JSON.parse(body); } catch { return reply(400, { error: 'invalid json' }); }
    reply(200, await handle(ctx, caller, msg));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve({ url: `http://127.0.0.1:${server.address().port}/rpc`, token, close: () => server.close() });
    });
  });
}

/** 处理一条转发来的 JSON-RPC 请求（tools/list / tools/call）；附加工具（如 consult）可能耗时数分钟 */
export async function handle(ctx, caller, msg) {
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'tools/list') return ok({ tools: toolsFor(caller, ctx) });
  if (msg.method === 'tools/call') {
    const name = msg.params?.name, args = msg.params?.arguments ?? {};
    ctx.onCall?.(caller, name, args);
    let value;
    try { value = await callTool(ctx.board, caller, name, args, ctx); }
    catch (e) { value = { error: String(e.message || e) }; }
    return ok({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }], ...(value?.error ? { isError: true } : {}) });
  }
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
}
