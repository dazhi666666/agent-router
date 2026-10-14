// Claude Code adapter: headless `claude -p` with stream-json output and the
// board MCP server injected via --mcp-config.
// 本机访问 Anthropic API 需要走 v2rayN 本地代理，见 router.config.json 的 claude.proxy。
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { boardMcpEntry, conversationMcpServers, spawnCollect, writeTempJson } from './spawn-util.mjs';
import { createThreadWriter, claudeEventEntries } from './thread.mjs';

/**
 * Run one Claude Code session.
 * opts: { prompt, cwd, agentName, roster, dataFile, logDir, timeoutMs, onText, resumeSessionId }
 * Returns { sessionId, text, isError }.
 */
export async function runClaude(opts) {
  const {
    prompt, cwd, agentName, roster, dataFile,
    logDir, timeoutMs = 0, onText = () => {}, onChild, threadPath, resumeSessionId
  } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;

  const cfg = loadConfig().claude;
  // 对话级 MCP（runtime-config.json 的 mcpServers 段）：临时文件逐进程注入，天然按对话隔离；
  // claude 不认 cwd 字段，stdio 只收 command/args/env。board 殿后防同名挤掉
  const conversation = Object.fromEntries(Object.entries(conversationMcpServers()).map(([name, e]) => [name,
    e.type === 'stdio' ? { command: e.command, ...(e.args ? { args: e.args } : {}), ...(e.env ? { env: e.env } : {}) }
      : { type: e.type, url: e.url, ...(e.headers ? { headers: e.headers } : {}) }]));
  const mcpFile = writeTempJson(
    logDir || path.join(cwd, '.router-tmp'),
    `mcp-${agentName}.json`,
    { mcpServers: { ...conversation, board: boardMcpEntry({ agentName, dataFile, roster }) } }
  );

  const env = {};
  if (cfg.proxy) {
    env.HTTPS_PROXY = cfg.proxy;
    env.HTTP_PROXY = cfg.proxy;
  }

  const lines = [];
  // prompt 走 stdin：Windows argv 上限 32k，长 prompt（续派注入旧报告等）会 ENAMETOOLONG
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', mcpFile,
    '--permission-mode', 'bypassPermissions'
  ];
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.effort) args.push('--effort', cfg.effort);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  const { code, stdout, stderr } = await spawnCollect(cfg.exe, args, {
    cwd,
    timeoutMs,
    env,
    input: prompt,
    onChild,
      onStdoutLine: line => {
        let ev;
        try { ev = JSON.parse(line); } catch { return; }
        lines.push(ev);
        if (thread) for (const e of claudeEventEntries(ev)) thread.add(e.kind, e.data);
        if (ev.type === 'assistant') {
        for (const block of ev.message?.content || []) {
          if (block.type === 'text' && block.text) onText(block.text);
        }
      }
    }
  });

  if (code !== 0 && lines.length === 0) {
    throw new Error(`claude 退出码 ${code}: ${stderr.slice(0, 400) || stdout.slice(0, 400)}`);
  }
  const init = lines.find(e => e.type === 'system' && e.subtype === 'init');
  const result = lines.find(e => e.type === 'result');
  return {
    sessionId: init?.session_id ?? null,
    text: result?.result ?? '',
    raw: result ?? null,
    isError: result?.subtype ? result.subtype !== 'success' : code !== 0
  };
}
