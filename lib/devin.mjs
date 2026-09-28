// Devin adapter: drives the local Devin CLI in ACP mode (`devin acp`).
// Requires a one-time `devin auth login` (browser authorization) by the user.
import { spawnSync } from 'node:child_process';
import { runAcp } from './acp.mjs';
import { loadConfig } from './config.mjs';
import { createThreadWriter, acpUpdateEntries } from './thread.mjs';
import { toAcpMcpServer } from './spawn-util.mjs';

function devinExe() {
  return process.env.AGENT_ROUTER_DEVIN_EXE || loadConfig().devin.exe;
}

function authed() {
  const r = spawnSync(devinExe(), ['auth', 'status'], { encoding: 'utf8', timeout: 30000 });
  return /logged in/i.test(`${r.stdout}${r.stderr}`) && r.status === 0;
}

/**
 * Run one Devin session via ACP.
 * opts: { prompt, cwd, agentName, roster, dataFile, boardMcp, timeoutMs, onText, resumeSessionId }
 * boardMcp: { command, args, env } — passed as session MCP server.
 */
export async function runDevin(opts) {
  const { prompt, cwd, boardMcp, timeoutMs = 900000, onText = () => {}, onChild, threadPath, resumeSessionId } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  if (!authed()) {
    const msg = 'Devin 未登录：请先运行 `devin auth login` 完成浏览器授权（只需一次）';
    thread?.add('result', { text: msg, isError: true });
    throw new Error(msg);
  }
  // ACP 文本块是碎片化的（常按字符推送）：缓冲合并，避免线程文件被单字符 assistant 条目刷屏
  let textBuf = null;
  const flushText = () => {
    if (!textBuf) return;
    thread?.add('assistant', { text: textBuf });
    textBuf = null;
  };
  const out = await runAcp({
    cmd: devinExe(),
    args: ['acp'],
    cwd,
    prompt,
    resumeSessionId,
    env: loadConfig().devin.model ? { DEVIN_MODEL: loadConfig().devin.model } : {},
    onChild,
    onUpdate: u => {
      const uu = u?.update ?? u;
      if (uu?.sessionUpdate === 'agent_message_chunk' && uu.content?.type === 'text') {
        textBuf = (textBuf ?? '') + uu.content.text;
        return;
      }
      flushText();
      if (thread) for (const e of acpUpdateEntries(u)) thread.add(e.kind, e.data);
    },
    mcpServers: boardMcp ? [toAcpMcpServer('board', boardMcp)] : [],
    timeoutMs,
    onText
  });
  flushText();
  thread?.add('result', { text: out.text, isError: false });
  return { sessionId: out.sessionId ?? null, text: out.text, isError: false, stopReason: out.stopReason ?? null, updates: out.updates ?? [] };
}
