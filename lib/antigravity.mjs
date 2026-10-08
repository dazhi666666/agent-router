// Antigravity CLI (agy) adapter: headless `agy -p --output-format json`.
// Google 生成接口有地区限制，默认走本地代理（config.antigravity.proxy）。
// 任务板 MCP 经工作区级 .agents/mcp_config.json 注入（写-还原，经 spawn-util 的
// 引用计数共管，同目录并行任务收尾互不干扰）；--conversation <id> 续链会话。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { beginConfigEra, boardMcpEntry, endConfigEra, spawnCollect, writeConfigEra } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

/**
 * Run one Antigravity session.
 * opts: { prompt, cwd, agentName, roster, dataFile, timeoutMs, onText, resumeSessionId }
 * Returns { sessionId, text, raw, isError }.
 */
export async function runAntigravity(opts) {
  const {
    prompt, cwd, agentName, roster, dataFile,
    timeoutMs = 0, onText = () => {}, onChild, threadPath, resumeSessionId
  } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  const cfg = loadConfig().antigravity;

  const mcpFile = path.join(cwd, '.agents', 'mcp_config.json');
  const era = beginConfigEra(mcpFile);
  const base = era.written ?? era.original?.toString('utf8');
  let mcfg = {};
  try { mcfg = base ? JSON.parse(base) : {}; } catch {}
  const board = boardMcpEntry({ agentName });
  mcfg.mcpServers = {
    ...(mcfg.mcpServers || {}),
    board: { ...(mcfg.mcpServers?.board || {}), command: board.command, args: board.args, env: board.env, disabled: false }
  };
  writeConfigEra(era, mcpFile, JSON.stringify(mcfg, null, 1));

  // prompt 走 stdin（--input-format text：print 模式从 stdin 读 prompt，已实测）：
  // Windows argv 上限 32k，长 prompt（续派注入旧报告等）会 ENAMETOOLONG；
  // 且 -p 是必带值旗标，不能空挂（会吞掉后面的旗标当 prompt）
  const args = ['--input-format', 'text', '--output-format', 'json', '--dangerously-skip-permissions'];
  if (resumeSessionId) args.push('--conversation', resumeSessionId);
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.effort) args.push('--effort', cfg.effort);
  const env = {};
  if (cfg.proxy) { env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; }

  let stdout = '';
  try {
    const result = await spawnCollect(cfg.exe, args, {
      cwd, timeoutMs, env, input: prompt,
      onChild: child => { if (onChild) onChild(child); },
      onStdoutLine: line => { stdout += line + '\n'; }
    });
    // stdout 末尾是 JSON envelope（诊断信息走 stderr；出错时前部可能夹杂错误行，向前找最后一个可解析对象）
    let parsed = null;
    for (let idx = stdout.lastIndexOf('{'); idx >= 0; idx = stdout.lastIndexOf('{', idx - 1)) {
      try { parsed = JSON.parse(stdout.slice(idx)); break; } catch { /* 继续向前找 */ }
    }
    if (!parsed) {
      const msg = `agy 输出无法解析为 JSON（退出码 ${result.code}）: ${(result.stderr || stdout).slice(0, 300)}`;
      thread?.add('result', { text: msg, isError: true });
      throw new Error(msg);
    }
    if (parsed.status !== 'SUCCESS') {
      const msg = `agy 会话失败（${parsed.status || 'UNKNOWN'}）: ${String(parsed.error || '(未说明原因)').slice(0, 300)}`;
      thread?.add('result', { text: msg, isError: true });
      throw new Error(msg);
    }
    const text = String(parsed.response ?? '').trim();
    if (text) thread?.add('assistant', { text });
    thread?.add('result', { text, isError: false });
    return { sessionId: parsed.conversation_id || resumeSessionId || null, text, raw: parsed, isError: false };
  } finally {
    endConfigEra(mcpFile);
  }
}
