// OpenCode adapter: headless `opencode run --format json`.
// 任务板 MCP 与权限放行经 OPENCODE_CONFIG_CONTENT 内联注入（运行时覆盖，与用户全局配置
// 合并，不影响其自有 MCP/模型配置）。--format json 输出 NDJSON 事件流，-s <sessionID> 续链。
// 注意：zen 免费档模型多数仅限交互客户端使用（服务端按模型放行），无头可用性以实测为准。
import { loadConfig } from './config.mjs';
import { boardMcpEntry, spawnCollect } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

/**
 * Run one OpenCode session.
 * opts: { prompt, cwd, agentName, roster, dataFile, timeoutMs, onText, resumeSessionId }
 * Returns { sessionId, text, raw, isError }.
 */
export async function runOpencode(opts) {
  const {
    prompt, cwd, agentName, roster, dataFile,
    timeoutMs = 900000, onText = () => {}, onChild, threadPath, resumeSessionId
  } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  const cfg = loadConfig().opencode;
  const args = ['run', '--format', 'json'];
  if (resumeSessionId) args.push('-s', resumeSessionId);
  if (cfg.model) args.push('-m', cfg.model);
  args.push(prompt);

  const board = boardMcpEntry({ agentName, dataFile, roster });
  const env = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' },
      mcp: { board: { type: 'local', command: [board.command, ...board.args], environment: board.env, enabled: true } }
    })
  };

  const events = [];
  const textParts = new Map();  // part.id -> 最新文本快照（流式更新时去重增量）
  const partOrder = [];
  const toolParts = new Map();  // callID -> 最新工具部件
  let sessionId = null, lastError = null;
  const result = await spawnCollect(cfg.exe, args, {
    cwd, timeoutMs, env,
    onChild: child => { try { child.stdin.end(); } catch {} if (onChild) onChild(child); },
    onStdoutLine: line => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      events.push(ev);
      if (ev.sessionID) sessionId = ev.sessionID;
      if (ev.type === 'error') lastError = String(ev.error?.data?.message || ev.error?.name || '未知错误');
      const part = ev.part;
      if (!part) return;
      if (part.type === 'text' && typeof part.text === 'string' && part.text) {
        const prev = textParts.get(part.id);
        if (prev === undefined) {
          partOrder.push(part.id);
          textParts.set(part.id, part.text);
          onText(part.text);
        } else if (part.text.length > prev.length && part.text.startsWith(prev)) {
          textParts.set(part.id, part.text);
          onText(part.text.slice(prev.length));
        } else {
          textParts.set(part.id, part.text);
        }
      } else if (part.type === 'tool' && part.tool && (part.callID || part.id)) {
        toolParts.set(part.callID || part.id, part);
      }
    }
  });

  // 线程条目收尾统一落盘（文本按最终快照，避免流式更新写碎片）
  for (const id of partOrder) {
    const text = textParts.get(id);
    if (text) thread?.add('assistant', { text });
  }
  for (const part of toolParts.values()) {
    const out = part.state?.output != null ? String(part.state.output).slice(0, 2000) : '';
    thread?.add('tool_use', { id: part.callID || part.id, name: part.tool, status: part.state?.status, input: part.state?.input });
    if (out) thread?.add('tool_result', { id: part.callID || part.id, text: out, isError: part.state?.status === 'error' });
  }

  const finalText = partOrder.map(id => textParts.get(id)).filter(Boolean).join('\n\n').trim();
  const failed = !!(lastError && !finalText) || (result.code !== 0 && !events.length);
  if (failed) {
    const msg = `opencode 运行失败（退出码 ${result.code}）: ${lastError || (result.stderr || result.stdout || '(无输出)').slice(0, 300)}`;
    thread?.add('result', { text: msg, isError: true });
    throw new Error(msg);
  }
  thread?.add('result', { text: finalText, isError: false });
  return { sessionId, text: finalText, raw: events.at(-1) || null, isError: false };
}
