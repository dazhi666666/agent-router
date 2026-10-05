// Agent Router 任务板 MCP 服务（stdio）。
// 这是一个轻量代理：每个 agent CLI 以 stdio 方式拉起它，它把 tools/list、tools/call 转发给
// Router 进程的本地 RPC 端点（core/rpc.mjs），任务板状态只存在于 Router 内存中。
// 环境变量：ROUTER_URL、ROUTER_TOKEN、AGENT_NAME（由 lib/spawn-util.mjs 的 boardMcpEntry 注入）。
// stdout 只走协议，日志写 stderr。
import readline from 'node:readline';
import http from 'node:http';

const { ROUTER_URL, ROUTER_TOKEN, AGENT_NAME = 'unknown' } = process.env;
if (!ROUTER_URL || !ROUTER_TOKEN) {
  console.error('[board] ROUTER_URL and ROUTER_TOKEN are required');
  process.exit(2);
}
const SERVER_INFO = { name: 'agent-router-board', version: '0.2.0' };

function post(body) {
  return new Promise((resolve, reject) => {
    const req = http.request(ROUTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${ROUTER_TOKEN}`, 'X-Agent': AGENT_NAME }
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function forward(msg) {
  try {
    const r = await post(JSON.stringify(msg));
    const value = JSON.parse(r.text);
    if (r.status >= 400) throw new Error(value.error || `HTTP ${r.status}`);
    return value;
  } catch (e) {
    const text = JSON.stringify({ error: `task board unavailable: ${e.message}` });
    return msg.method === 'tools/call'
      ? { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], isError: true } }
      : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: text } };
  }
}

async function handleMessage(msg) {
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return null;
  if (msg.method === 'initialize') {
    return { jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO
    } };
  }
  if (msg.method === 'ping') return { jsonrpc: '2.0', id: msg.id, result: {} };
  if (msg.method === 'tools/list' || msg.method === 'tools/call') return forward(msg);
  if (msg.id === undefined) return null; // notifications/initialized 等
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handleMessage(msg).then(out => { if (out) process.stdout.write(JSON.stringify(out) + '\n'); });
});
rl.on('close', () => process.exit(0));
