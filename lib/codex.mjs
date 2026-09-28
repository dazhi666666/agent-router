// Codex CLI adapter: non-interactive JSON events with the shared task-board MCP server.
import { loadConfig } from './config.mjs';
import { boardMcpEntry, spawnCollect } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';
import { fileURLToPath } from 'node:url';

const BOARD_SERVER = fileURLToPath(new URL('./board-server.mjs', import.meta.url));

export async function runCodex(opts) {
  const { prompt, cwd, agentName, roster, dataFile, timeoutMs = 900000, onText = () => {}, onChild, threadPath, resumeSessionId } = opts;
  const cfg = loadConfig().codex;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  // Current desktop Codex exposes the explicit bypass flag; newer docs may
  // also show --full-auto, so keep the adapter aligned with the installed CLI.
  // resume 没有 --cd 旗标：续链时沿用进程 cwd（spawnCollect 已带）。
  const bypass = '--dangerously-bypass-approvals-and-sandbox';
  const args = resumeSessionId
    ? ['exec', 'resume', resumeSessionId, '--json', '--skip-git-repo-check', bypass]
    : ['exec', '--json', '--cd', cwd, '--skip-git-repo-check', bypass];
  if (cfg.model) args.push('--model', cfg.model);
  const board = boardMcpEntry({ agentName, dataFile, roster });
  // Codex reads MCP servers from config overrides. The board process inherits these
  // values, so every child remains scoped to this run and agent.
  args.push('-c', `mcp_servers.board.command=${JSON.stringify(process.execPath)}`);
  args.push('-c', `mcp_servers.board.args=${JSON.stringify([BOARD_SERVER])}`);
  args.push('-c', `mcp_servers.board.env.AGENT_NAME=${JSON.stringify(board.env.AGENT_NAME)}`);
  args.push('-c', `mcp_servers.board.env.ROUTER_DATA=${JSON.stringify(board.env.ROUTER_DATA)}`);
  args.push('-c', `mcp_servers.board.env.ROSTER=${JSON.stringify(board.env.ROSTER)}`);
  args.push(prompt);
  const env = {};
  if (cfg.proxy) { env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; }
  const lines = [];
  const result = await spawnCollect(cfg.exe, args, {
    cwd, timeoutMs, env,
    // stdin 保持开启会让 codex 一直等 <stdin> 块的 EOF：spawn 后立即关闭
    onChild: child => { try { child.stdin.end(); } catch {} if (onChild) onChild(child); },
    onStdoutLine: line => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      lines.push(ev);
      const text = ev.item?.text || ev.text || ev.message?.content?.[0]?.text || ev.result?.text || '';
      if (text) { onText(text); if (thread) thread.add('assistant', { text }); }
      if (thread && ev.type === 'function_call') thread.add('tool_use', { name: ev.name, input: ev.arguments });
    }
  });
  if (result.code !== 0 && !lines.length) throw new Error(`codex 退出码 ${result.code}: ${(result.stderr || result.stdout).slice(0, 400)}`);
  const finalText = lines.map(e => e.item?.text || e.result?.text || e.text || '').filter(Boolean).pop() || '';
  if (thread) thread.add('result', { text: finalText, isError: result.code !== 0 });
  const threadId = lines.find(e => e.thread_id)?.thread_id || null;
  // resume 时线程 id 会变化（fork 出新 id），始终返回本次的 id 供下轮续链
  return { sessionId: threadId || resumeSessionId, text: finalText, raw: lines.at(-1) || null, isError: result.code !== 0 };
}

