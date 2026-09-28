// ZCode adapter: headless `zcode -p`. Workspace-scope MCP config is written to
// <cwd>/.zcode/config.json so the board server auto-connects for this run.
// --json 输出带 sessionId，供主代理 followup_task 续派时 --resume 恢复会话。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { boardMcpEntry, spawnCollect } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

/**
 * Run one ZCode session.
 * opts: { prompt, cwd, agentName, roster, dataFile, timeoutMs, onText, resumeSessionId }
 * Returns { sessionId, text, isError }.
 */
export async function runZcode(opts) {
  const {
    prompt, cwd, agentName, roster, dataFile,
    timeoutMs = 900000, onText = () => {}, onChild, threadPath, resumeSessionId
  } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;

  const zcfgDir = path.join(cwd, '.zcode');
  fs.mkdirSync(zcfgDir, { recursive: true });
  const zcfgFile = path.join(zcfgDir, 'config.json');
  const originalConfig = fs.existsSync(zcfgFile) ? fs.readFileSync(zcfgFile) : null;
  const zcfg = fs.existsSync(zcfgFile)
    ? JSON.parse(fs.readFileSync(zcfgFile, 'utf8'))
    : {};
  zcfg.mcp = { ...(zcfg.mcp || {}), servers: {
    ...(zcfg.mcp?.servers || {}),
    board: boardMcpEntry({ agentName, dataFile, roster })
  } };
  fs.writeFileSync(zcfgFile, JSON.stringify(zcfg, null, 1));

  let stdout = '';
  const args = ['-p', prompt, '--mode', 'yolo', '--cwd', cwd, '--json'];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  let code, stderr;
  let providerOverride;
  try {
  const cfg = loadConfig().zcode;
  const env = {};
  if (cfg.model) {
    const source = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE || path.join(process.env.USERPROFILE || process.env.HOME || '', '.zcode', 'v2', 'provider_config.json');
    const provider = JSON.parse(fs.readFileSync(source, 'utf8'));
    const slash = cfg.model.indexOf('/');
    provider.config.defaultModelSelection = { providerId: cfg.model.slice(0, slash), modelId: cfg.model.slice(slash + 1) };
    providerOverride = path.join(path.dirname(dataFile), `provider-${agentName}.json`);
    fs.writeFileSync(providerOverride, JSON.stringify(provider));
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = providerOverride;
  }
  ({ code, stderr } = await spawnCollect(
    process.execPath,
    [loadConfig().zcode.entry, ...args],
    {
      timeoutMs,
      env,
      onChild,
      onStdoutLine: line => { stdout += line + '\n'; }
    }
  ));
  } finally {
    if (originalConfig) fs.writeFileSync(zcfgFile, originalConfig);
    else { try { fs.unlinkSync(zcfgFile); } catch {} try { fs.rmdirSync(zcfgDir); } catch {} }
    if (providerOverride) { try { fs.unlinkSync(providerOverride); } catch {} }
  }

  // stdout 末尾是完整的机器可读 JSON；向前找最后一个可解析的对象（防前导杂行）
  let parsed = null;
  for (let idx = stdout.lastIndexOf('{'); idx >= 0; idx = stdout.lastIndexOf('{', idx - 1)) {
    try { parsed = JSON.parse(stdout.slice(idx)); break; } catch { /* 继续向前找 */ }
  }
  if (!parsed) {
    const msg = `zcode 输出无法解析为 JSON（退出码 ${code}）: ${(stderr || stdout).slice(0, 400)}`;
    thread?.add('result', { text: msg, isError: true });
    throw new Error(msg);
  }
  const text = String(parsed.response ?? '').trim();
  if (text) thread?.add('assistant', { text });
  if (code !== 0) {
    const msg = `zcode 退出码 ${code}: ${String(parsed.error?.message ?? stderr).slice(0, 400)}`;
    thread?.add('result', { text: msg, isError: true });
    throw new Error(msg);
  }
  thread?.add('result', { text, isError: false });
  return { sessionId: parsed.sessionId ?? null, text, isError: false };
}
