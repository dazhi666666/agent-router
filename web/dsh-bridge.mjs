// Agent Router → dsh Web UI 桥接。
// 把 runDir/threads/*.jsonl 里的统一线程条目合成为 dsh 的 SessionEvent v4 事件流,
// 并按 dsh 客户端的首屏 RPC 清单应答 unary 端点、按 journal 帧协议提供流端点。
// 数据形状依据:
//   packages/core/session/src/types.ts        (SessionEventMap / SESSION_FORMAT_VERSION=4)
//   packages/core/session/src/surface.ts      (validateSessionEventData / surfaceOp)
//   packages/api/session-controller/src/types.ts (SessionSummary / SessionPage / SessionFollowFrame / SessionWireHeader)
//   packages/test-support/client-runtime/src/assembly/remote-default-responses.ts (首屏默认应答)
import fs from 'node:fs';
import path from 'node:path';
import { threadSessionId } from './sessions.mjs';

const FORMAT_VERSION = 4;

// ui-settings-general 命名空间:预置 welcomeNoticeVersion,让"预览版说明"弹窗视为已确认。
// WELCOME_NOTICE_VERSION 随 dsh 版本变化,mutate 请求会写入新值,这里同时保留进程内可变值。
const GENERAL_SCHEMA = { uid: 2, refs: { '1': { type: 'string', meta: { volatile: true } }, '2': { type: 'object', meta: { default: {} }, dict: { welcomeNoticeVersion: 1 } } } };
const generalValue = { welcomeNoticeVersion: '2026-09-28.1' };
let generalRevision = 1;
const generalNamespace = () => ({
  autoGenerate: true,
  ns: 'ui-settings-general',
  schema: GENERAL_SCHEMA,
  value: { ...generalValue },
  applies: 'live',
  secrets: [],
  revision: generalRevision,
});
// 应用一次 settings/mutate 的 set/unset 操作,返回写后的命名空间视图
function applyGeneralMutate(rawPayload) {
  const outer = rawPayload?.args ?? rawPayload ?? {};
  const payload = outer.request ?? outer;
  const ops = Array.isArray(payload?.ops) ? payload.ops : Array.isArray(payload?.args?.ops) ? payload.args.ops : [];
  for (const op of ops) {
    if (!Array.isArray(op?.path) || op.path.length !== 1) continue;
    if (op.op === 'set') generalValue[op.path[0]] = op.value;
    else if (op.op === 'unset') delete generalValue[op.path[0]];
  }
  generalRevision += 1;
  return ok(generalNamespace());
}

// 会话的 modelSelection 投影:0.2 的模型选择器等待该投影就绪后才显示当前模型
const MODEL_SELECTION = { lastUsed: null, pending: { provider: 'agent-router', model: 'agent-router' } };
const modelSelectionValues = () => ({ modelSelection: { lastUsed: MODEL_SELECTION.lastUsed, pending: { ...MODEL_SELECTION.pending } } });

// ---------- 线程读取 ----------

// dsh 侧新建的会话 id → 运行主线程的别名（server.mjs 在 session/create 时登记）
export const dshAliases = new Map();

function threadsDir(runDir) {
  return path.join(runDir, 'threads');
}

export function listThreadFiles(runDir) {
  try {
    return fs.readdirSync(threadsDir(runDir))
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.stream.jsonl'))
      .map(f => {
        const st = fs.statSync(path.join(threadsDir(runDir), f));
        return { file: f, name: f.replace(/\.jsonl$/, ''), size: st.size, mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch { return []; }
}

function readThreadEntries(runDir, name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  try {
    return fs.readFileSync(path.join(threadsDir(runDir), `${name}.jsonl`), 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return null; }
}

// ---------- 线程条目 → SessionEvent v4 合成 ----------

function ok(value) { return { ok: true, value }; }
function fail(code, message) { return { ok: false, error: { code, message, details: {} } }; }

function userMessage(id, text, rpcId) {
  return { id, role: 'user', source: { kind: 'user', ...(rpcId ? { rpcId } : {}) }, content: [{ type: 'text', text: String(text ?? '') }] };
}

/** 非用户输入（source.kind 不是 user）在 dsh 里显示为注入上下文，kind 即标签 */
function contextMessage(id, label, text) {
  return { id, role: 'user', source: { kind: label }, content: [{ type: 'text', text: String(text ?? '') }] };
}

function assistantMessage(id, text) {
  return {
    id, role: 'assistant',
    source: { kind: 'model', provider: 'agent-router', model: 'worker' },
    content: [{ type: 'text', text: String(text ?? '') }],
  };
}

function toolResultMessage(id, callId, text, isError) {
  return {
    id, role: 'tool',
    source: { kind: 'tool', callId },
    toolCallId: callId,
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: String(text ?? '') }],
  };
}

/**
 * 整个线程 → 完整 SessionEvent 日志。
 * 每条 assistant 消息独占一个 step（消息后立即 step/end）：assistant 流式协议要求
 * 上一消息的 step/end 到位后才能开始下一条的流式 attempt，否则客户端判定协议违规。
 * seq 从 0 开始：dsh 游标协议是「cursor=最后一条事件的 seq，空日志为 -1」。
 * take(entry) 命中 prompt 回显时给用户消息带 rpcId（见 createBridge.pendingEcho）；
 * state 可选，回填合成结束时的 turn/step/stepOpen，供流式 attempt 定位下一消息的落点。
 */
export function synthesizeSessionEvents(entries, take = null, state = null) {
  if (state) Object.assign(state, { turn: 1, step: 1, open: false });
  if (!entries.length) return [];
  const events = [];
  const assistantTexts = new Set();
  let seq = -1;
  let step = 1, open = true;
  // 思考（thought）与它后面的正文同属一次模型尝试：合并成同一条 assistant/message 的
  // reasoning 块。拆成两条会让客户端在流式期间把思考消息扣在 pending 里无法结算，
  // 下一次 start 帧就会触发 rebaseline（表现即运行中内容顺序错乱/闪烁）
  let pendingThought = null;
  const time0 = Date.parse(entries[0].ts) || Date.now();
  const push = (type, data, extra) => { seq += 1; events.push({ type, seq, time: time0, data, ...extra }); };
  const openStep = () => { if (!open) { push('step/start', { turn: 1, step }); open = true; } };
  const closeStep = () => { if (open) { push('step/end', { turn: 1, step }); open = false; step += 1; } };
  push('turn/start', { turn: 1 });
  push('step/start', { turn: 1, step });
  for (const e of entries) {
    const d = e.data || {};
    const time = Date.parse(e.ts) || time0;
    const emit = (type, data, extra) => { seq += 1; events.push({ type, seq, time, data, ...extra }); };
    if (e.kind === 'thought') {
      const t = String(d.text ?? '');
      pendingThought = pendingThought ? `${pendingThought}\n\n${t}` : t;
      continue;
    }
    if (e.kind === 'assistant') {
      const text = String(d.text ?? '');
      assistantTexts.add(text);
      openStep();
      const content = pendingThought ? [{ type: 'reasoning', text: pendingThought }, { type: 'text', text }] : [{ type: 'text', text }];
      pendingThought = null;
      emit('assistant/message', { turn: 1, step, message: { ...assistantMessage(`m${seq}`, ''), content }, stream: [] }, { surfaceOp: 'append' });
      closeStep();
      continue;
    }
    if (e.kind === 'result') {
      const text = String(d.text || '');
      if (!text || !assistantTexts.has(text)) {
        openStep();
        const content = pendingThought ? [{ type: 'reasoning', text: pendingThought }, { type: 'text', text }] : [{ type: 'text', text }];
        pendingThought = null;
        emit('assistant/message', { turn: 1, step, message: { ...assistantMessage(`m${seq}`, ''), content }, stream: [] }, { surfaceOp: 'append' });
      } else if (pendingThought) {
        // 思考没有等到正文就遇到回合结束：单独下发一条 reasoning 消息，避免丢失
        openStep();
        emit('assistant/message', { turn: 1, step, message: { ...assistantMessage(`m${seq}`, ''), content: [{ type: 'reasoning', text: pendingThought }] }, stream: [] }, { surfaceOp: 'append' });
        pendingThought = null;
      }
      closeStep();
      emit('turn/end', { turn: 1, reason: d.isError ? { kind: 'error', error: { message: text.slice(0, 200) || '会话失败', code: 'UNKNOWN' } } : { kind: 'completed' } });
      continue;
    }
    openStep();
    if (e.kind === 'system') {
      emit('user/message', contextMessage(`m${seq}`, '系统提示词', d.text), { surfaceOp: 'append' });
    } else if (e.kind === 'user') {
      // Router 注入的 [事件] / [信箱] 仍按用户消息下发（dsh 会把回合中的注入上下文整个隐藏），页面上由 board-embed.js 改成提示条样式；
      // take 命中的那条带上 prompt 的 requestId：客户端凭它回收乐观气泡，缺了同一条消息会渲染两遍
      emit('user/message', userMessage(`m${seq}`, d.text, take?.(e)), { surfaceOp: 'append' });
    } else if (e.kind === 'tool_use') {
      emit('tool/call', { turn: 1, step, callId: String(d.id || `call-${seq}`), name: String(d.name || 'tool'), arguments: JSON.stringify(d.input ?? d.raw ?? {}) });
    } else if (e.kind === 'tool_result') {
      emit('tool/result', { turn: 1, step, message: toolResultMessage(`m${seq}`, String(d.id || ''), String(d.text || '').slice(0, 20000), d.isError === true) }, { surfaceOp: 'append' });
    }
  }
  if (state) Object.assign(state, { turn: 1, step, open });
  return events;
}

/** Run-aware bridge. Every open stream resolves its own persistent session binding. */
export function createBridge({ sessions, runs }) {
  // prompt 的 requestId → 目标用户消息应带的 rpcId。dsh 客户端发出消息时先渲染乐观气泡，
  // 凭日志消息上的 source.rpcId 匹配后回收；不回填这个 id，同一条消息就会渲染两遍。
  // plainUsers 是 prompt 时线程里已有的“普通用户消息”（排除 [事件]/[信箱] 注入）条数，
  // 目标 = 之后出现的第一条普通用户消息（目标消息与它的文本一致）。
  const pendingEcho = new Map(); // sessionId -> { requestId, plainUsers }
  const isPlainUser = e => e.kind === 'user' && !/^\s*\[(事件|信箱)\]/.test(String(e.data?.text || ''));
  const echoTagger = id => {
    const pending = pendingEcho.get(id);
    if (!pending) return null;
    let seen = 0;
    return e => {
      if (!isPlainUser(e)) return null;
      return seen++ === pending.plainUsers ? (pendingEcho.delete(id), pending.requestId) : null;
    };
  };
  // 负载形如 { args: { request } } / { args: [...] }（位置参数，如 interruptByParent(child, parent, mode)）/ 直接对象
  const unpack = p => {
    const a = p?.args ?? p ?? {};
    if (Array.isArray(a)) return typeof a[0] === 'object' && a[0] !== null ? a[0].request ?? a[0] : { childSessionId: a[0], parentSessionId: a[1], mode: a[2] };
    return a.request ?? a;
  };
  const addressId = p => p.sessionId || p.address?.sessionId || p.address?.childSessionId || p.childSessionId;
  const get = id => { const s = sessions.resolve(id); if (!s) throw new Error('会话不存在，请新建会话'); return s; };
  const entries = s => s.runId ? readThreadEntries(runs.dir(s.runId), s.thread) || [] : [];
  const all = () => {
    const items = Object.values(sessions.items).filter(s => !s.runId).map(s => ({ sessionId: s.id, updatedAt: s.createdAt, running: false, blank: true, cwd: s.settings.repo, agentAvailable: true }));
    for (const run of runs.list()) {
      const dir = runs.dir(run.id), board = readJson(path.join(dir, 'board.json')), status = readJson(path.join(dir, 'status.json'));
      const threads = listThreadFiles(dir);
      if (!threads.some(t => t.name === 'manager')) threads.unshift({ name: 'manager', mtimeMs: run.mtime });
      for (const t of threads) items.push({
        sessionId: t.name === 'manager' ? sessions.managerId(run.id) : threadSessionId(run.id, t.name),
        title: threadTitle(t.name, run, board),
        updatedAt: Math.round(t.mtimeMs),
        running: runs.running(run.id) && threadRunning(t.name, board, status),
        blank: false, cwd: run.settings?.repo || dir, agentAvailable: true
      });
    }
    return items;
  };
  // 主代理会话的子代理目录：每个子代理线程（T1-claude 等）一条，dsh 据此在会话头部提供子代理切换与回溯
  const catalogOf = runId => {
    const dir = runs.dir(runId), board = readJson(path.join(dir, 'board.json'));
    return listThreadFiles(dir).filter(t => t.name !== 'manager').map(t => {
      const task = board?.tasks?.find(x => t.name.startsWith(`${x.id}-`));
      return { id: threadSessionId(runId, t.name), createdAt: Date.parse(task?.created_at) || Math.round(t.mtimeMs), mode: 'continuable', label: subagentLabel(t.name, task) };
    }).sort((a, b) => a.createdAt - b.createdAt);
  };
  const projectionValues = id => {
    const s = id ? sessions.resolve(id) : null;
    if (s?.runId && s.thread === 'manager') return { ...modelSelectionValues(), subagentCatalog: catalogOf(s.runId) };
    return modelSelectionValues();
  };
  const context = id => {
    const s = get(id), run = s.runId ? runs.detail(s.runId) : null;
    const running = !!run && runs.running(run.id);
    const agent = s.thread === 'manager' ? 'manager' : run?.board?.tasks?.find(t => s.thread.startsWith(t.id + '-'))?.assignee;
    return { sessionId: id, runId: s.runId, thread: s.thread, agent: agent || null, settings: run?.settings || s.settings, run, managerSessionId: s.runId ? sessions.managerId(s.runId) : id, capabilities: { configure: !s.runId, send: !s.runId || running && !!agent, stop: running && s.thread === 'manager', models: running && s.thread === 'manager' } };
  };
  const unary = (endpoint, raw) => {
    const p = unpack(raw), id = addressId(p), s = id ? sessions.resolve(id) : null;
    if (endpoint === 'health') return ok({ ready: true });
    if (endpoint === 'session/create') return ok({ sessionId: sessions.create(id).id });
    if (endpoint === 'session/list') return ok({ items: all() });
    if (endpoint === 'session/page') {
      const events = synthesizeSessionEvents(entries(get(id)), echoTagger(id)).filter(e => e.seq <= (p.throughSeq ?? Infinity) && e.seq < (p.beforeSeq ?? Infinity));
      return ok({ records: events.map(event => ({ type: 'event', event })), hasMore: false });
    }
    if (endpoint === 'session/search') {
      const query = String(p.query || '').trim().toLowerCase();
      if (!query) return ok({ items: [], hasMore: false });
      return ok({ items: all().flatMap(item => {
        const s = get(item.sessionId);
        const match = entries(s).map(e => String(e.data?.text || '')).find(t => t.toLowerCase().includes(query));
        return match || `${s.thread} ${s.runId}`.toLowerCase().includes(query) ? [{ sessionId: item.sessionId, snippet: (match || `${s.thread} ${s.runId}`).slice(0, 160) }] : [];
      }).slice(0, 50), hasMore: false });
    }
    if (endpoint === 'session/prompt') {
      const s = get(id), text = (p.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (!text) throw new Error('消息不能为空');
      const plainUsers = entries(s).filter(isPlainUser).length;
      if (!s.runId) {
        const run = runs.start({ ...s.settings, goal: text }); sessions.bind(s.id, run.id);
        if (p.requestId) pendingEcho.set(id, { requestId: p.requestId, plainUsers });
        return ok({ accepted: true });
      }
      const ctx = context(id);
      if (!ctx.capabilities.send) throw new Error('该会话已结束，请新建运行');
      const task = ctx.agent === 'manager' ? null : ctx.thread.split('-')[0];
      const result = runs.message(s.runId, { text, to: ctx.agent, task_id: task });
      if (p.requestId) pendingEcho.set(id, { requestId: p.requestId, plainUsers });
      return ok({ accepted: true, ...result });
    }
    if (endpoint === 'session/projections') return ok({ asOfSeq: -1, values: projectionValues(id) });
    if (endpoint === 'subagents/prompt') {
      const ctx = context(id), text = (p.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (!text) throw new Error('消息不能为空');
      if (!ctx.capabilities.send || ctx.agent === 'manager') throw new Error('该子代理所在的运行已结束');
      const plainUsers = entries(sessions.resolve(id)).filter(isPlainUser).length;
      runs.message(ctx.runId, { text, to: ctx.agent, task_id: ctx.thread.split('-')[0] });
      if (p.requestId) pendingEcho.set(id, { requestId: p.requestId, plainUsers });
      return ok({ accepted: true });
    }
    if (endpoint === 'subagents/interruptByParent') {
      const ctx = context(p.childSessionId);
      if (!ctx.runId || !runs.running(ctx.runId)) throw new Error('该子代理所在的运行已结束');
      runs.command(ctx.runId, { type: 'cancel', task_id: ctx.thread.split('-')[0] });
      return ok({ accepted: true });
    }
    if (endpoint === 'session/cancel') {
      const ctx = context(id);
      if (!ctx.capabilities.stop) throw new Error('只有本次运行的主代理会话可停止运行');
      runs.stop(ctx.runId); return ok({ accepted: true });
    }
    return dshUnary(s?.runId ? runs.dir(s.runId) : runs.dataDir, endpoint, raw);
  };
  const stream = (endpoint, raw, send) => {
    const p = unpack(raw); let timer, streamTimer;
    const cleanup = () => { clearInterval(timer); clearInterval(streamTimer); };
    if (endpoint === 'workspace/follow') {
      // 单一「Agent Router」工作区：首帧 baseline，之后会话增减用 upsert（dsh 只在重连时接受 baseline）
      let previous = '';
      const push = () => {
        const ids = all().map(s => s.sessionId), signature = JSON.stringify(ids);
        if (signature === previous) return;
        const workspace = { workspaceId: 'agent-router', path: runs.root, title: 'Agent Router', sessionIds: ids, createdAt: '2026-01-01T00:00:00Z', updatedAt: new Date().toISOString() };
        send(previous ? { type: 'upsert', workspace } : { type: 'baseline', value: { items: [workspace], archivedSessionIds: [], pinnedSessionIds: [] } });
        previous = signature;
      };
      push(); timer = setInterval(push, 1500); return cleanup;
    }
    if (endpoint === 'session/control') {
      const projections = {}, last = new Map();
      for (const item of all()) {
        const values = projectionValues(item.sessionId);
        projections[item.sessionId] = { asOfSeq: -1, values };
        if (values.subagentCatalog) last.set(item.sessionId, JSON.stringify(values.subagentCatalog));
      }
      send({ type: 'baseline', value: { projections } });
      let seq = 0;
      timer = setInterval(() => {
        try {
          for (const item of all()) {
            const catalog = projectionValues(item.sessionId).subagentCatalog;
            if (!catalog) continue;
            const signature = JSON.stringify(catalog);
            if (last.get(item.sessionId) === signature) continue;
            last.set(item.sessionId, signature);
            send({ type: 'projection', sessionId: item.sessionId, key: 'subagentCatalog', value: catalog, seq: ++seq });
          }
        } catch {}
      }, 1500);
      return cleanup;
    }
    if (endpoint === 'session/follow') {
      const id = addressId(p);
      const s = get(id); let count = 0;
      const state = {};
      const take = echoTagger(id);
      const initial = synthesizeSessionEvents(entries(s), take, state); count = initial.length;
      // dsh 协议：cursor 是最后一条事件的 seq（空日志为 -1），不是事件条数
      const head = initial.length ? initial[initial.length - 1].seq : -1;
      send({ type: 'snapshot', header: sessionHeader(id, s.createdAt || initial[0]?.time || Date.now()), cursor: head, records: initial.map(event => ({ type: 'event', event })), hasMore: false, projections: { asOfSeq: head, values: projectionValues(id) }, assistantStream: { revision: 0 } });
      // —— 逐字流式：跟随运行器写的 <thread>.stream.jsonl（text_delta 增量），
      //    以 assistant-stream 帧下发。协议约束（客户端强校验，违者断流）：
      //    revision 与 chunk.index 逐帧严格 +1；日志 assistant/message 事件先到，
      //    end 帧用其 seq 结算，且必须赶在该消息的 step/end 之前（否则保留态卡死）
      let rev = 0, streamLines = null, attempt = null;
      // 扣住的 step/end：协议要求 end 帧先于它（客户端靠 step/end 退休流式残留），
      // end 帧发不出的批次里先扣住，结算后补发
      let deferredStepEnd = null;
      const asFrame = f => { rev += 1; send({ type: 'assistant-stream', frame: { revision: rev, ...f } }); };
      // 运行绑定可能晚于 follow 打开（新会话先开面板再发首条消息），所以每次泵都重新解析流文件路径
      const streamPathFor = () => {
        const cur = sessions.resolve(id);
        return cur?.runId ? path.join(runs.dir(cur.runId), 'threads', `${cur.thread}.stream.jsonl`) : null;
      };
      const pumpStream = () => {
        const streamPath = streamPathFor();
        if (!streamPath) return;
        let lines;
        try { lines = fs.readFileSync(streamPath, 'utf8').split('\n'); } catch { return; }
        const total = lines.length - 1;
        if (streamLines === null) {
          // 首次跟随：跳过已完成（有 done 行）的 attempt，只跟随尾部仍在进行的
          let skip = 0;
          for (let i = 0; i < total; i++) if (/"done"\s*:/.test(lines[i])) skip = i + 1;
          streamLines = skip;
        } else if (total < streamLines) {
          streamLines = 0; // 运行器每回合截断重写
        }
        for (let i = streamLines; i < total; i++) {
          streamLines = i + 1;
          let rec; try { rec = JSON.parse(lines[i]); } catch { continue; }
          if (!rec.id) continue;
          if (!attempt || attempt.id !== rec.id) {
            attempt = { id: rec.id, startedAfterSeq: count - 1, turn: state.turn, step: state.step, nextIndex: 0, pendingEnd: false };
            asFrame({ type: 'start', attemptId: attempt.id, startedAfterSeq: attempt.startedAfterSeq, turn: attempt.turn, step: attempt.step });
          }
          if (rec.done) { attempt.pendingEnd = true; continue; }
          if (typeof rec.text === 'string' && rec.text) {
            asFrame({ type: 'chunk', attemptId: attempt.id, index: attempt.nextIndex++, time: Number(rec.t) || Date.now(), chunk: { type: 'text-delta', index: 0, text: rec.text } });
          }
        }
      };
      const journalPoll = () => {
        try {
          const events = synthesizeSessionEvents(entries(get(id)), echoTagger(id), state);
          const fresh = events.slice(count);
          count = events.length;
          let settleSeq = -1, settled = false, endSent = false;
          if (attempt?.pendingEnd) {
            // 结算目标是含正文块的 assistant/message（思考已并入同一条消息的 reasoning 块）
            const m = events.find(e => e.type === 'assistant/message' && e.seq > attempt.startedAfterSeq && e.data.turn === attempt.turn && e.data.step === attempt.step && e.data.message?.content?.some?.(b => b?.type === 'text'));
            if (m) { settleSeq = m.seq; settled = true; }
          }
          const sendEnd = () => {
            asFrame({ type: 'end', attemptId: attempt.id, index: attempt.nextIndex, outcome: { kind: 'completed', seq: settleSeq, eventType: 'assistant/message' } });
            attempt = null; endSent = true;
            if (deferredStepEnd) { send({ type: 'event', event: deferredStepEnd }); deferredStepEnd = null; }
          };
          for (const event of fresh) {
            // 该消息的 step/end 必须排在 end 帧之后；end 帧发不出的批次里先扣住
            if (event.type === 'step/end' && attempt && !endSent && event.data.turn === attempt.turn && event.data.step === attempt.step) {
              deferredStepEnd = event;
              continue;
            }
            send({ type: 'event', event });
            if (settled && !endSent && event.seq === settleSeq) sendEnd();
          }
          if (settled && !endSent) {
            // 结算事件在更早批次已发：end 帧此刻补发
            sendEnd();
          }
        } catch (e) { send({ type: 'error', error: { code: 'router/read-failed', message: e.message } }); }
      };
      timer = setInterval(journalPoll, 1000);
      streamTimer = setInterval(() => { try { pumpStream(); } catch {} }, 250);
      return cleanup;
    }
    return dshStream(runs.dataDir, endpoint, raw, send);
  };
  return { unary, stream, context, all };
}

const AGENT_LABELS = { claude: 'Claude Code', zcode: 'ZCode', devin: 'Devin', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity' };
const short = (text, n = 60) => { const v = String(text ?? '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n)}…` : v; };
/** 子代理目录里的标签：T1 · ZCode · 任务标题 */
function subagentLabel(name, task) {
  const [taskId, agent] = [name.slice(0, name.lastIndexOf('-')), name.slice(name.lastIndexOf('-') + 1)];
  return [taskId, AGENT_LABELS[agent] || agent, task?.title && short(task.title, 40)].filter(Boolean).join(' · ');
}
/** 侧栏标题：主代理会话用对话的第一条消息，子代理会话标明任务与执行者 */
function threadTitle(name, run, board) {
  if (name === 'manager') return short(run.goal || run.id);
  return `↳ ${subagentLabel(name, board?.tasks?.find(t => name.startsWith(`${t.id}-`)))}`;
}

function threadRunning(name, board, status) {
  if (board?.finished) return false;
  if (name === 'manager' || dshAliases.has(name)) return status?.busy === true;
  const taskId = name.split('-')[0];
  return board?.tasks?.some(t => t.id === taskId && t.status === 'in_progress');
}

function sessionHeader(sessionId, createdAt) {
  return { version: FORMAT_VERSION, id: sessionId, createdAt, isSeeded: false };
}

// ---------- unary 端点 ----------

export function dshUnary(runDir, endpoint, rawPayload) {
  const outer = rawPayload?.args ?? rawPayload ?? {};
  const payload = outer.request ?? outer;
  const board = readJson(path.join(runDir, 'board.json'));
  const status = readJson(path.join(runDir, 'status.json'));
  const threads = listThreadFiles(runDir);

  switch (endpoint) {
    case 'session/list': {
      const items = threads.map(t => ({
        agentAvailable: false,
        sessionId: t.name,
        updatedAt: Math.round(t.mtimeMs),
        running: threadRunning(t.name, board, status),
        blank: false,
        cwd: runDir,
      }));
      return ok({ items });
    }
    case 'session/page': {
      const sessionId = payload?.address?.sessionId;
      let entries = readThreadEntries(runDir, sessionId);
      if (!entries && dshAliases.has(String(sessionId))) entries = readThreadEntries(runDir, 'manager');
      if (!entries) return fail('session/not-found', `线程 ${sessionId} 不存在`);
      const throughSeq = Number(payload?.throughSeq ?? Number.MAX_SAFE_INTEGER);
      const beforeSeq = Number(payload?.beforeSeq ?? Number.MAX_SAFE_INTEGER);
      const events = synthesizeSessionEvents(entries).filter(e => e.seq <= throughSeq && e.seq < beforeSeq);
      return ok({ records: events.map(event => ({ type: 'event', event })), hasMore: false });
    }
    case 'session/projections': {
      return ok({ asOfSeq: -1, values: {} });
    }
    // ---- 客户端首屏可降级端点的默认应答(抄 remote-default-responses) ----
    case 'workspace/initializeDefault': return ok(undefined);
    case 'settings/describe': return ok({ writable: true, hasDocument: false, namespaces: [generalNamespace()] });
    case 'settings/mutate': return applyGeneralMutate(rawPayload);
    case 'session/search': {
      // 在线程名与会话内容里找匹配，供侧栏"搜索会话"使用
      const q = String(payload?.query ?? '').trim().toLowerCase();
      if (!q) return ok({ items: [], hasMore: false });
      const items = [];
      for (const t of threads) {
        let snippet = '';
        if (t.name.toLowerCase().includes(q)) {
          snippet = t.name;
        } else {
          for (const e of readThreadEntries(runDir, t.name) || []) {
            const text = String(e.data?.text || e.data?.name || '');
            if (text && text.toLowerCase().includes(q)) { snippet = text.slice(0, 120); break; }
          }
        }
        if (snippet) items.push({ sessionId: t.name, snippet });
      }
      return ok({ items: items.slice(0, 20), hasMore: false });
    }
    case 'session/modelCatalog': return ok({
      default: { provider: 'agent-router', model: 'agent-router' },
      routableProviders: ['agent-router'],
      groups: [{
        id: 'agent-router',
        name: 'Agent Router',
        models: [{
          id: 'agent-router',
          name: 'Agent Router',
          description: '模型由各 agent 自己的配置决定；主代理与各成员的模型可在运行设置里分别指定',
        }],
      }],
      failures: [],
    });
    case 'agentPresets/list': return ok({ presets: [] });
    case 'session/selectModel': return ok(undefined);
    case 'dynamicCordisRunner/syncInspectManifest': return ok(null);
    case 'dynamicCordisRunner/inventory': return ok([]);
    case 'credentials/describe': return ok({});
    case 'permissionPresets/catalog': return ok({ options: [] });
    case 'account/getProfile': return ok(null);
    case 'account/getBalance': return ok(null);
    case 'account/getUnnotifiedBonuses': return ok(null);
    case 'account/ackBonusNotified': return ok(true);
    case 'job/list': return ok({ items: [] });
    default:
      return fail('gateway/not-implemented', `Agent Router 桥未实现端点 ${endpoint}`);
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ---------- 流端点(NDJSON:每行一个帧) ----------

/**
 * 启动一条流;返回 cleanup。send(frame) 把帧写给客户端,payload 为方法参数对象。
 */
export function dshStream(runDir, endpoint, rawPayload, send) {
  const timers = [];
  const stop = () => { for (const t of timers) clearInterval(t); };
  // dsh typert 线上包装:{args:{request:{...}}} —— 解包到真实请求对象
  const outer = rawPayload?.args ?? rawPayload ?? {};
  const payload = outer.request ?? outer;

  if (endpoint === '$events') {
    // ready 帧建立 connection generation;键必须恰为 type/clientId/host
    send({ type: 'ready', clientId: 'agent-router-client', host: { home: runDir } });
    return stop;
  }
  if (endpoint === 'session/control') {
    // 控制流 baseline:为每个已知会话播种 modelSelection 投影
    const projections = {};
    try { for (const item of all()) projections[item.sessionId] = { asOfSeq: -1, values: modelSelectionValues() }; } catch {}
    send({ type: 'baseline', value: { projections } });
    return stop;
  }
  if (endpoint === 'settings/mutate') {
    send(applyGeneralMutate(raw));
    return stop;
  }
  if (endpoint === 'workspace/follow') {
    // 单一"Agent Router"工作区,装载当前运行的全部会话(manager 在前)
    const threads = listThreadFiles(runDir);
    const ordered = [...threads.filter(t => t.name === 'manager'), ...threads.filter(t => t.name !== 'manager')];
    send({
      type: 'baseline',
      value: {
        items: [{
          workspaceId: 'agent-router',
          path: runDir,
          title: 'Agent Router',
          sessionIds: ordered.map(t => t.name),
          createdAt: new Date(ordered.at(-1)?.mtimeMs ?? Date.now()).toISOString(),
          updatedAt: new Date(ordered[0]?.mtimeMs ?? Date.now()).toISOString(),
        }],
        archivedSessionIds: [],
        pinnedSessionIds: [],
      },
    });
    return stop;
  }
  if (endpoint === 'account/watch') {
    send({ status: 'signed-out', attempt: null, links: { usageUrl: '', topUpUrl: '' } });
    return stop;
  }
  if (endpoint === 'session/follow') {
    const sessionId = String(payload?.address?.sessionId || '');
    let threadName = sessionId;
    let entries = readThreadEntries(runDir, threadName);
    if (!entries && dshAliases.has(sessionId)) {
      threadName = 'manager';
      entries = readThreadEntries(runDir, threadName);
    }
    if (!entries && dshAliases.has(sessionId)) {
      // 别名会话：对应运行还没产生主线程。先回空快照让客户端进入会话，
      // 之后每秒重合成 manager 线程，按 seq 续发新事件
      send({
        type: 'snapshot',
        header: sessionHeader(sessionId, Date.now()),
        cursor: -1,
        records: [],
        hasMore: false,
        projections: { asOfSeq: -1, values: {} },
        assistantStream: { revision: 0 },
      });
      let lastSeq = -1;
      timers.push(setInterval(() => {
        try {
          const events = synthesizeSessionEvents(readThreadEntries(runDir, 'manager') || []);
          for (const event of events.slice(lastSeq + 1)) send({ type: 'event', event });
          lastSeq = events.length - 1;
        } catch {}
      }, 1000));
      return stop;
    }
    if (!entries) {
      send({ type: 'error', error: { code: 'session/not-found', message: `线程 ${sessionId} 不存在`, details: {} } });
      return stop;
    }
    const events = synthesizeSessionEvents(entries);
    const createdAt = entries[0] ? Date.parse(entries[0].ts) || Date.now() : Date.now();
    const head = events.length ? events[events.length - 1].seq : -1;
    send({
      type: 'snapshot',
      header: sessionHeader(sessionId, createdAt),
      cursor: head,
      records: events.map(event => ({ type: 'event', event })),
      hasMore: false,
      projections: { asOfSeq: head, values: {} },
      assistantStream: { revision: 0 },
    });
    // 增量:轮询线程文件整段重合成，按 seq 续发新事件（前缀合成稳定，seq 即游标）
    let lastSeq = head;
    timers.push(setInterval(() => {
      try {
        const fresh = synthesizeSessionEvents(readThreadEntries(runDir, threadName) || []);
        for (const event of fresh.slice(lastSeq + 1)) send({ type: 'event', event });
        lastSeq = fresh.length - 1;
      } catch {}
    }, 1000));
    return stop;
  }
  // 未知流:保持打开但不发数据,客户端按业务超时自行降级
  return stop;
}
