// 会话线程采集：每个 agent 会话一个 JSONL 文件（runDir/threads/<name>.jsonl），
// 只存统一事件（参照 deepseek-harness 的"事件日志为源、界面为投影"）：
//   system     { text, via? }               系统提示词留档：实际发送给 AI 的完整指令
//                                           （via: append-system-prompt=随每次请求生效 / first-message=已并入会话首条消息）
//   user       { text }                     任务提示词 / 注入（目标、事件、信箱、用户插话）
//   assistant  { text }                     AI 文字回复
//   thought    { text }                     思考内容（默认折叠展示）
//   tool_use   { id?, name, input?, ... }   工具调用开始
//   tool_result{ id?, text, isError? }      工具结果（与最近的 tool_use 配对）
//   result     { text, isError, cost? }     会话最终结果
// 条目形如 { seq, ts, kind, data }；界面怎么画由前端决定。
import fs from 'node:fs';
import path from 'node:path';

export function createThreadWriter(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let seq = 0;
  if (fs.existsSync(file)) {
    // 追加模式：续接已有 seq（同一会话文件被重复写入时保持单调）
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      if (lines.length) seq = (JSON.parse(lines[lines.length - 1]).seq) || 0;
    } catch {}
  }
  return {
    path: file,
    add(kind, data) {
      const entry = { seq: ++seq, ts: new Date().toISOString(), kind, data };
      try { fs.appendFileSync(file, JSON.stringify(entry) + '\n'); } catch {}
      return entry;
    }
  };
}

/** 把 claude stream-json 事件转成线程条目（主代理与 claude 工人共用） */
export function claudeEventEntries(ev) {
  const out = [];
  if (ev.type === 'assistant') {
    for (const b of ev.message?.content || []) {
      if (b.type === 'text' && b.text) out.push({ kind: 'assistant', data: { text: b.text } });
      else if (b.type === 'thinking' && b.thinking) out.push({ kind: 'thought', data: { text: b.thinking } });
      else if (b.type === 'tool_use') out.push({ kind: 'tool_use', data: { id: b.id, name: b.name, input: b.input } });
    }
  } else if (ev.type === 'user') {
    const content = ev.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_result') {
          const text = Array.isArray(b.content)
            ? b.content.filter(c => c?.type === 'text').map(c => c.text).join('\n')
            : (typeof b.content === 'string' ? b.content : '');
          out.push({ kind: 'tool_result', data: { id: b.tool_use_id, text: String(text || ''), isError: !!b.is_error } });
        }
      }
    }
  } else if (ev.type === 'result') {
    out.push({ kind: 'result', data: { text: ev.result ?? '', isError: ev.subtype ? ev.subtype !== 'success' : false, cost: ev.total_cost_usd ?? null } });
  }
  return out;
}

/** 把 ACP session/update（devin）转成线程条目 */
export function acpUpdateEntries(update) {
  const u = update?.update ?? update;
  const kind = u?.sessionUpdate;
  if (kind === 'agent_message_chunk' && u.content?.type === 'text') {
    return [{ kind: 'assistant', data: { text: u.content.text } }];
  }
  if (kind === 'agent_thought_chunk' && u.content?.type === 'text') {
    return [{ kind: 'thought', data: { text: u.content.text } }];
  }
  if (kind === 'tool_call') {
    return [{ kind: 'tool_use', data: { id: u.toolCallId, name: u.title || 'tool', status: u.status || 'pending', raw: { kind: u.kind, locations: u.locations } } }];
  }
  if (kind === 'tool_call_update') {
    const isError = u.status === 'failed';
    return [{ kind: 'tool_result', data: { id: u.toolCallId, text: String(u.title || ''), isError } }];
  }
  return [];
}
