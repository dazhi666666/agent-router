// DSH (science-harness) adapter: one-shot `dsh --profile headless --json`.
// DeepSeek Harness 作为团队一员：子代理一次 headless 任务；主代理走 OneShotMainSession 回合串联。
// 任务经 stdin 传入（headless 无位置参数时读 stdin；绕开 Windows argv 32k 上限）。
// 看板 MCP 经每次任务生成的临时 patch 文件注入（harness 自带 dsh-mcp-client，一个 server 一个
// 插件实例）；对话级 MCP（runtime-config.json 的 mcpServers 段）同样逐条挂实例，任务结束删除。
// --json 是 NDJSON 事件流：session → 会话 id；text/thinking/tool_call/tool_result 随到随写线程；
// final 是回合全文。--session-id 续接会话（followup/resume）；退出码 0 成功、1 失败。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { boardMcpEntry, conversationMcpServers, spawnCollect } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

const BOARD_SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'board-server.mjs');

/** 一次会话的临时 patch 文件内容（JSON 是合法 YAML）：看板 MCP + 对话级 MCP。 */
export function headlessPatch({ agentName, mcpServers = {} }) {
  const board = boardMcpEntry({ agentName });
  const insert = [{
    id: 'router-board-mcp',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: 'board',
      transport: 'stdio',
      command: board.command,
      args: board.args,
      env: board.env
    }
  }];
  let seq = 0;
  for (const [name, e] of Object.entries(mcpServers)) {
    if (!e || e.enabled === false) continue;
    insert.push({
      id: `router-conversation-mcp-${++seq}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: e.type === 'stdio'
        ? { serverName: name, transport: 'stdio', command: e.command, ...(e.args ? { args: e.args } : {}), ...(e.env ? { env: e.env } : {}), ...(e.cwd ? { cwd: e.cwd } : {}) }
        : { serverName: name, transport: 'streamable-http', url: e.url, ...(e.headers ? { headers: e.headers } : {}) }
    });
  }
  return JSON.stringify({ insert }, null, 1);
}

/** 一次会话的 --json 事件解析状态 */
export function createDshState() {
  return { sessionId: null, finalText: null, errorMessage: null };
}

/** 消费一行 --json 事件：更新状态、写线程条目；返回本行产生的效果（无事件行返回 null）。 */
export function applyDshEvent(state, line, thread) {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  let ev; try { ev = JSON.parse(t); } catch { return null; }
  const out = {};
  if (ev.type === 'session' && ev.sessionId) {
    state.sessionId = ev.sessionId;
    out.sessionId = ev.sessionId;
  } else if (ev.type === 'text' && ev.text) {
    thread?.add('assistant', { text: ev.text });
    out.assistant = ev.text;
  } else if (ev.type === 'thinking' && ev.text) {
    thread?.add('thought', { text: ev.text });
    out.thought = ev.text;
  } else if (ev.type === 'tool_call') {
    thread?.add('tool_use', { id: ev.callId, name: ev.tool, input: ev.input });
    out.toolUse = ev.callId;
  } else if (ev.type === 'tool_result') {
    thread?.add('tool_result', { id: ev.callId, text: String(ev.result ?? ''), isError: ev.status === 'error' });
    out.toolResult = ev.callId;
  } else if (ev.type === 'final') {
    state.finalText = String(ev.text ?? '').trim();
    out.final = state.finalText;
  } else if (ev.type === 'error') {
    state.errorMessage = String(ev.message || '未知错误');
    out.error = state.errorMessage;
  }
  return out;
}

/**
 * Run one dsh headless session.
 * opts: { prompt, cwd, agentName, roster, dataFile, timeoutMs, onText, resumeSessionId }
 * Returns { sessionId, text, isError }. 模型/思考强度由 harness profile 自身配置决定，不接受覆盖。
 */
export async function runDsh(opts) {
  const {
    prompt, cwd, agentName, dataFile,
    timeoutMs = 0, onText = () => {}, onChild, threadPath, resumeSessionId
  } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  const cfg = loadConfig().dsh;
  const state = createDshState();
  const fail = msg => {
    thread?.add('result', { text: msg, isError: true });
    // 会话 id 挂到错误上：回合失败多为瞬时故障，上层 --resume 续接而不是整链作废
    const e = new Error(msg);
    if (state.sessionId) e.sessionId = state.sessionId;
    throw e;
  };
  if (!cfg.entry || (path.isAbsolute(cfg.entry) && !fs.existsSync(cfg.entry))) {
    return fail(`dsh 入口不存在（${cfg.entry || '未找到 apps/cli/lib/bin.js'}）：先在 science-harness 仓库 pnpm install && pnpm run build，或用 AGENT_ROUTER_DSH_ENTRY 指向构建产物`);
  }
  const patchFile = path.join(path.dirname(dataFile), `dsh-patch-${agentName}-${process.pid}-${Date.now()}.yml`);
  fs.writeFileSync(patchFile, headlessPatch({ agentName, mcpServers: conversationMcpServers() }));
  const args = ['--profile', 'headless', '--json', '--patch', patchFile];
  if (resumeSessionId) args.push('--session-id', resumeSessionId);
  let textOut = '', result;
  try {
    result = await spawnCollect(process.execPath, [cfg.entry, ...args], {
      cwd, timeoutMs, input: prompt,
      onChild,
      onStdoutLine: line => {
        const applied = applyDshEvent(state, line, thread);
        if (applied?.assistant) { textOut += (textOut ? '\n\n' : '') + applied.assistant; onText(applied.assistant); }
      }
    });
  } catch (e) {
    if (state.sessionId && e && typeof e === 'object') e.sessionId = state.sessionId;
    throw e;
  } finally {
    try { fs.unlinkSync(patchFile); } catch {}
  }
  const text = state.finalText || textOut;
  if (state.errorMessage || result.code !== 0) {
    const tail = state.errorMessage || String(result.stderr || textOut || '(无输出)').trim().slice(0, 300);
    return fail(`dsh 会话失败（退出码 ${result.code}）: ${tail}`);
  }
  if (!text) return fail('dsh 会话没有输出（--json 流缺失 final 事件）');
  thread?.add('result', { text, isError: false });
  return { sessionId: state.sessionId, text, isError: false };
}
