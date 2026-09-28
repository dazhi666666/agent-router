// Antigravity CLI (agy) adapter: headless `agy -p --output-format json`.
// Google 生成接口有地区限制，默认走本地代理（config.antigravity.proxy）。
// 任务板 MCP 经工作区级 .agents/mcp_config.json 注入（写-还原，与 zcode 的
// .zcode/config.json 方案相同）；--conversation <id> 续链会话。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { boardMcpEntry, spawnCollect } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

/**
 * Run one Antigravity session.
 * opts: { prompt, cwd, agentName, roster, dataFile, timeoutMs, onText, resumeSessionId }
 * Returns { sessionId, text, raw, isError }.
 */
export async function runAntigravity(opts) {
  const {
    prompt, cwd, agentName, roster, dataFile,
    timeoutMs = 900000, onText = () => {}, onChild, threadPath, resumeSessionId
  } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  const cfg = loadConfig().antigravity;

  const agyDir = path.join(cwd, '.agents');
  fs.mkdirSync(agyDir, { recursive: true });
  const mcpFile = path.join(agyDir, 'mcp_config.json');
  const originalConfig = fs.existsSync(mcpFile) ? fs.readFileSync(mcpFile) : null;
  let mcfg = {};
  try { mcfg = originalConfig ? JSON.parse(originalConfig.toString('utf8')) : {}; } catch {}
  const board = boardMcpEntry({ agentName, dataFile, roster });
  mcfg.mcpServers = {
    ...(mcfg.mcpServers || {}),
    board: { ...(mcfg.mcpServers?.board || {}), command: board.command, args: board.args, env: board.env, disabled: false }
  };
  fs.writeFileSync(mcpFile, JSON.stringify(mcfg, null, 1));

  const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
  if (resumeSessionId) args.push('--conversation', resumeSessionId);
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.effort) args.push('--effort', cfg.effort);
  const env = {};
  if (cfg.proxy) { env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; }

  let stdout = '';
  try {
    const result = await spawnCollect(cfg.exe, args, {
      cwd, timeoutMs, env,
      onChild: child => { try { child.stdin.end(); } catch {} if (onChild) onChild(child); },
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
    if (originalConfig) fs.writeFileSync(mcpFile, originalConfig);
    else { try { fs.unlinkSync(mcpFile); } catch {} try { fs.rmdirSync(agyDir); } catch {} }
  }
}
