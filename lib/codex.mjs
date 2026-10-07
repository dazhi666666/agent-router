// Codex CLI adapter: non-interactive JSON events with the shared task-board MCP server.
// opts.gateway runs Codex on a chat-only model through the chat-agent Responses gateway:
//   { args: [...provider overrides], env: { CODEX_HOME, <token var> } } replaces the configured model and proxy.
import { loadConfig } from './config.mjs';
import { boardMcpEntry, spawnCollect } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';
import { fileURLToPath } from 'node:url';

const BOARD_SERVER = fileURLToPath(new URL('./board-server.mjs', import.meta.url));

export async function runCodex(opts) {
  const { prompt, cwd, agentName, roster, dataFile, timeoutMs = 900000, onText = () => {}, onChild, threadPath, resumeSessionId, gateway = null } = opts;
  const cfg = loadConfig().codex;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  // Current desktop Codex exposes the explicit bypass flag; newer docs may
  // also show --full-auto, so keep the adapter aligned with the installed CLI.
  // resume 没有 --cd 旗标：续链时沿用进程 cwd（spawnCollect 已带）。
  const bypass = '--dangerously-bypass-approvals-and-sandbox';
  const args = resumeSessionId
    ? ['exec', 'resume', resumeSessionId, '--json', '--skip-git-repo-check', bypass]
    : ['exec', '--json', '--cd', cwd, '--skip-git-repo-check', bypass];
  if (gateway) args.push(...gateway.args);
  else if (cfg.model) args.push('--model', cfg.model);
  const board = boardMcpEntry({ agentName, dataFile, roster });
  // Codex reads MCP servers from config overrides. The board process inherits these
  // values, so every child remains scoped to this run and agent.
  args.push('-c', `mcp_servers.board.command=${JSON.stringify(process.execPath)}`);
  args.push('-c', `mcp_servers.board.args=${JSON.stringify([BOARD_SERVER])}`);
  for (const [k, v] of Object.entries(board.env)) args.push('-c', `mcp_servers.board.env.${k}=${JSON.stringify(v)}`);
  args.push(prompt);
  const env = gateway ? { ...gateway.env } : {};
  if (cfg.proxy && !gateway) { env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; }
  const lines = [];
  const result = await spawnCollect(cfg.exe, args, {
    cwd, timeoutMs, env,
    // stdin 保持开启会让 codex 一直等 <stdin> 块的 EOF：spawn 后立即关闭
    onChild: child => { try { child.stdin.end(); } catch {} if (onChild) onChild(child); },
    onStdoutLine: line => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      lines.push(ev);
      const text = messageText(ev);
      if (text) { onText(text); if (thread) thread.add('assistant', { text }); }
      if (thread && ev.type === 'function_call') thread.add('tool_use', { name: ev.name, input: ev.arguments });
      if (thread && ev.type === 'item.completed') for (const entry of itemEntries(ev.item)) thread.add(entry.kind, entry.data);
    }
  });
  if (result.code !== 0 && !lines.length) throw new Error(`codex 退出码 ${result.code}: ${(result.stderr || result.stdout).slice(0, 400)}`);
  const finalText = lines.map(messageText).filter(Boolean).pop() || '';
  if (thread) thread.add('result', { text: finalText, isError: result.code !== 0 });
  const threadId = lines.find(e => e.thread_id)?.thread_id || null;
  // resume 时线程 id 会变化（fork 出新 id），始终返回本次的 id 供下轮续链
  return { sessionId: threadId || resumeSessionId, text: finalText, raw: lines.at(-1) || null, isError: result.code !== 0 };
}


/** Codex exec items that are tool activity (commands, patches, MCP calls, plans) as thread entries */
function itemEntries(item) {
  if (!item?.id) return [];
  if (item.type === 'command_execution') return [
    { kind: 'tool_use', data: { id: item.id, name: 'shell', input: { command: item.command } } },
    { kind: 'tool_result', data: { id: item.id, text: String(item.aggregated_output ?? ''), isError: item.status === 'failed' || (item.exit_code ?? 0) !== 0 } }
  ];
  if (item.type === 'file_change') return [
    { kind: 'tool_use', data: { id: item.id, name: 'apply_patch', input: { changes: item.changes } } },
    { kind: 'tool_result', data: { id: item.id, text: (item.changes || []).map(c => `${c.kind} ${c.path}`).join('\n'), isError: item.status === 'failed' } }
  ];
  if (item.type === 'mcp_tool_call') return [
    { kind: 'tool_use', data: { id: item.id, name: `${item.server}.${item.tool}`, input: item.arguments } },
    { kind: 'tool_result', data: { id: item.id, text: item.error?.message || JSON.stringify(item.result?.content ?? item.result ?? ''), isError: !!item.error || item.status === 'failed' } }
  ];
  if (item.type === 'todo_list') return [{ kind: 'tool_use', data: { id: item.id, name: 'update_plan', input: { plan: item.items } } }];
  if (item.type === 'reasoning' && item.text) return [{ kind: 'thought', data: { text: item.text } }];
  return [];
}

/** Assistant text of an event (item events count only for agent messages, not reasoning or errors) */
function messageText(ev) {
  if (ev.item) return ev.type === 'item.completed' && ev.item.type === 'agent_message' ? ev.item.text || '' : '';
  return ev.text || ev.message?.content?.[0]?.text || ev.result?.text || '';
}
