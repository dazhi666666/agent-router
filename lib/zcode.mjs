// ZCode adapter: headless `zcode -p`. Workspace-scope MCP config is written to
// <cwd>/.zcode/config.json so the board server auto-connects for this run.
// --json 输出带 sessionId，供主代理 followup_task 续派时 --resume 恢复会话。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { beginConfigEra, boardMcpEntry, endConfigEra, spawnCollect, writeConfigEra } from './spawn-util.mjs';
import { createThreadWriter } from './thread.mjs';

let providerSeq = 0; // provider 覆盖文件的唯一序号（并行任务各用各的，互不覆盖/误删）

/**
 * Run one ZCode session.
 * opts: { prompt, cwd, agentName, roster, dataFile, timeoutMs, onText, resumeSessionId }
 * Returns { sessionId, text, isError }.
 */
export async function runZcode(opts) {
  const {
    prompt, cwd, agentName, roster, dataFile,
    timeoutMs = 0, onText = () => {}, onChild, threadPath, resumeSessionId
  } = opts;
  const thread = threadPath ? createThreadWriter(threadPath) : null;
  // 逐字流式：text_delta 增量写入 <thread>.stream.jsonl，桥接以 assistant-stream 帧转发给 UI；
  // 每回合截断重写（上一回合的增量已结算为正式 assistant 条目，不再需要）
  const streamPath = threadPath ? threadPath.replace(/\.jsonl$/, '') + '.stream.jsonl' : null;
  if (streamPath) { try { fs.writeFileSync(streamPath, ''); } catch {} }
  const streamAppend = rec => { if (streamPath) try { fs.appendFileSync(streamPath, JSON.stringify(rec) + '\n'); } catch {} };

  const zcfgFile = path.join(cwd, '.zcode', 'config.json');
  const era = beginConfigEra(zcfgFile);
  const base = era.written ?? era.original?.toString('utf8');
  const zcfg = base ? JSON.parse(base) : {};
  zcfg.mcp = { ...(zcfg.mcp || {}), servers: {
    ...(zcfg.mcp?.servers || {}),
    board: boardMcpEntry({ agentName })
  } };
  writeConfigEra(era, zcfgFile, JSON.stringify(zcfg, null, 1));

  let stdout = '';
  // stream-json：事件逐行到达，边跑边写线程条目（任务板/会话页随之渐进渲染），不再整轮结束才出全文。
  // 旧版 CLI 不支持该格式时回退到整体解析（streamSeen=false 走老逻辑）。
  // zcode 的 -p 只收 argv（没有 stdin/`-` 用法），而 Windows 整条命令行上限 32767 字符，
  // 长 prompt（续派注入旧报告等）会 spawn ENAMETOOLONG。超过安全余量时把 prompt 落到临时
  // 文件经 --attach 注入（附件内容完整进入模型上下文），-p 只带一句指引。
  const argvPrompt = prompt.length <= 8000;
  const promptFile = argvPrompt ? null : path.join(path.dirname(dataFile), `prompt-${agentName}-${process.pid}-${Date.now()}.txt`);
  if (promptFile) fs.writeFileSync(promptFile, prompt);
  const args = [
    '-p', argvPrompt ? prompt : `The complete task instructions are in the attached file ${path.basename(promptFile)}. Read it fully and follow it exactly.`,
    '--mode', 'yolo', '--cwd', cwd, '--output-format', 'stream-json', '--verbose',
    ...(promptFile ? ['--attach', promptFile] : [])
  ];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  let code, stderr;
  let providerOverride;
  let sessionId = resumeSessionId ?? null, streamText = null, streamIsError = false, streamSeen = false, assistantLogged = false;
  let textBuf = '', thinkBuf = '';
  try {
  const cfg = loadConfig().zcode;
  const env = {};
  if (cfg.model) {
    const source = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE || path.join(process.env.USERPROFILE || process.env.HOME || '', '.zcode', 'v2', 'provider_config.json');
    const provider = JSON.parse(fs.readFileSync(source, 'utf8'));
    const slash = cfg.model.indexOf('/');
    provider.config.defaultModelSelection = { providerId: cfg.model.slice(0, slash), modelId: cfg.model.slice(slash + 1) };
    // 文件名带序号：并行任务各用各的覆盖文件，收尾删除不会影响别人
    providerOverride = path.join(path.dirname(dataFile), `provider-${agentName}-${process.pid}-${++providerSeq}.json`);
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
      // zcode stream-json 事件流（自有格式：type 带命名空间，内容在 payload）：
      //   model.streaming { kind: start|text_start|text_delta|text_end|finish, delta }
      //   tool.updated    { toolCallId, toolName, input } / { toolCallId, result: { success, content } }
      //   turn.completed  { response, resultType } —— 最终全文与成败
      // 条目随到达顺序写入线程，界面渐进渲染；thinking 增量的 kind 名未知，防御性映射
      onStdoutLine: line => {
        stdout += line + '\n';
        const t = line.trim();
        if (!t.startsWith('{')) return;
        let ev; try { ev = JSON.parse(t); } catch { return; }
        streamSeen = true;
        if (ev.sessionId) sessionId = ev.sessionId;
        const p = ev.payload || {};
        if (ev.type === 'model.streaming') {
          const kind = p.kind || '';
          const mid = String(p.assistantMessageId || 'msg');
          if (kind === 'text_delta' && p.delta) {
            textBuf += p.delta;
            streamAppend({ id: mid, t: Date.now(), text: p.delta });
          } else if (/thinking|reasoning/.test(kind) && kind.endsWith('_delta') && p.delta) thinkBuf += p.delta;
          if ((kind === 'text_end' || kind === 'finish') && textBuf) {
            thread?.add('assistant', { text: textBuf });
            onText(textBuf);
            assistantLogged = true;
            textBuf = '';
            streamAppend({ id: mid, done: 1 });
          }
          if ((/thinking|reasoning/.test(kind) && kind.endsWith('_end') || kind === 'finish') && thinkBuf) {
            thread?.add('thought', { text: thinkBuf });
            thinkBuf = '';
          }
        } else if (ev.type === 'tool.updated') {
          if (p.input !== undefined && p.toolName) thread?.add('tool_use', { id: p.toolCallId, name: p.toolName, input: p.input });
          else if (p.result !== undefined && p.toolCallId) thread?.add('tool_result', { id: p.toolCallId, text: String(p.result?.content ?? ''), isError: p.result?.success === false });
        } else if (ev.type === 'turn.completed') {
          streamText = String(p.response ?? '').trim();
          streamIsError = String(p.resultType ?? 'success') !== 'success';
          if (streamText && !assistantLogged) { thread?.add('assistant', { text: streamText }); assistantLogged = true; }
          thread?.add('result', { text: streamText, isError: streamIsError });
        }
      }
    }
  ));
  } finally {
    endConfigEra(zcfgFile);
    if (providerOverride) { try { fs.unlinkSync(providerOverride); } catch {} }
    if (promptFile) { try { fs.unlinkSync(promptFile); } catch {} }
  }

  if (streamSeen && streamText !== null) {
    // 事件流完整：条目（assistant/thought/tool/result）已随到达顺序写入线程
    if (streamIsError || code !== 0) throw new Error(`zcode 会话失败: ${streamText || String(stderr || '').slice(0, 300)}`);
    return { sessionId, text: streamText, isError: false };
  }
  // 没等到 result 事件（旧版 CLI 只输出一个最终 JSON、或流被截断）：回退整体解析
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
  if (parsed.sessionId) sessionId = parsed.sessionId;
  if (text && !assistantLogged) thread?.add('assistant', { text });
  if (code !== 0) {
    const msg = `zcode 退出码 ${code}: ${String(parsed.error?.message ?? stderr).slice(0, 400)}`;
    thread?.add('result', { text: msg, isError: true });
    throw new Error(msg);
  }
  thread?.add('result', { text, isError: false });
  return { sessionId, text, isError: false };
}
