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
      .filter(f => f.endsWith('.jsonl'))
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

function userMessage(id, text) {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: String(text ?? '') }] };
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
 * 单条线程条目 → 若干 SessionEvent(不带 turn 包装)。
 * seq 从 seqStart 连续编号;返回 { events, nextSeq }。
 */
function synthesizeEntry(e, seqStart, assistantTexts) {
  const events = [];
  let seq = seqStart;
  const push = (type, data, extra) => {
    seq += 1;
    events.push({ type, seq, time: Date.parse(e.ts) || Date.now(), data, ...extra });
  };
  const d = e.data || {};
  if (e.kind === 'system') {
    push('user/message', userMessage(`m${seq}`, `【系统提示词】\n${String(d.text ?? '')}`), { surfaceOp: 'append' });
  } else if (e.kind === 'user') {
    push('user/message', userMessage(`m${seq}`, d.text), { surfaceOp: 'append' });
  } else if (e.kind === 'assistant') {
    const text = String(d.text ?? '');
    assistantTexts.add(text);
    push('assistant/message', { turn: 1, step: 1, message: assistantMessage(`m${seq}`, text), stream: [] }, { surfaceOp: 'append' });
  } else if (e.kind === 'thought') {
    push('assistant/message', { turn: 1, step: 1, message: { ...assistantMessage(`m${seq}`, ''), content: [{ type: 'reasoning', text: String(d.text ?? '') }] }, stream: [] }, { surfaceOp: 'append' });
  } else if (e.kind === 'tool_use') {
    push('tool/call', { turn: 1, step: 1, callId: String(d.id || `call-${seq}`), name: String(d.name || 'tool'), arguments: JSON.stringify(d.input ?? d.raw ?? {}) });
  } else if (e.kind === 'tool_result') {
    push('tool/result', {
      turn: 1, step: 1,
      message: toolResultMessage(`m${seq}`, String(d.id || ''), String(d.text || '').slice(0, 20000), d.isError === true),
    }, { surfaceOp: 'append' });
  } else if (e.kind === 'result') {
    const text = String(d.text || '');
    if (!text || !assistantTexts.has(text)) {
      push('assistant/message', { turn: 1, step: 1, message: assistantMessage(`m${seq}`, text), stream: [] }, { surfaceOp: 'append' });
    }
    push('step/end', { turn: 1, step: 1 });
    push('turn/end', { turn: 1, reason: d.isError ? { kind: 'error', error: { message: text.slice(0, 200) || '会话失败', code: 'UNKNOWN' } } : { kind: 'completed' } });
  }
  return { events, nextSeq: seq };
}

/** 整个线程 → 完整 SessionEvent 日志(turn 包装 + 全部条目) */
export function synthesizeSessionEvents(entries) {
  if (!entries.length) return [];
  const events = [];
  const assistantTexts = new Set();
  let seq = 0;
  const wrap = (type, data) => {
    seq += 1;
    events.push({ type, seq, time: entries[0] ? Date.parse(entries[0].ts) || Date.now() : Date.now(), data });
  };
  wrap('turn/start', { turn: 1 });
  wrap('step/start', { turn: 1, step: 1 });
  for (const e of entries) {
    const r = synthesizeEntry(e, seq, assistantTexts);
    events.push(...r.events);
    seq = r.nextSeq;
  }
  return events;
}

/** Run-aware bridge. Every open stream resolves its own persistent session binding. */
export function createBridge({ sessions, runs }) {
  const unpack = p => { const a = p?.args ?? p ?? {}; return a.request ?? a; };
  const get = id => { const s = sessions.resolve(id); if (!s) throw new Error('会话不存在，请新建会话'); return s; };
  const entries = s => s.runId ? readThreadEntries(runs.dir(s.runId), s.thread) || [] : [];
  const all = () => {
    const items = Object.values(sessions.items).filter(s => !s.runId).map(s => ({ sessionId: s.id, updatedAt: s.createdAt, running: false, blank: true, cwd: s.settings.repo, agentAvailable: true }));
    for (const run of runs.list()) {
      const threads = listThreadFiles(runs.dir(run.id));
      if (!threads.some(t => t.name === 'manager')) threads.unshift({ name: 'manager', mtimeMs: run.mtime });
      for (const t of threads) items.push({ sessionId: t.name === 'manager' ? sessions.managerId(run.id) : threadSessionId(run.id, t.name), updatedAt: Math.round(t.mtimeMs), running: runs.running(run.id) && threadRunning(t.name, readJson(path.join(runs.dir(run.id), 'board.json')), readJson(path.join(runs.dir(run.id), 'status.json'))), blank: false, cwd: run.settings?.repo || runs.dir(run.id), agentAvailable: true });
    }
    return items;
  };
  const context = id => {
    const s = get(id), run = s.runId ? runs.detail(s.runId) : null;
    const running = !!run && runs.running(run.id);
    const agent = s.thread === 'manager' ? 'manager' : run?.board?.tasks?.find(t => s.thread.startsWith(t.id + '-'))?.assignee;
    return { sessionId: id, runId: s.runId, thread: s.thread, agent: agent || null, settings: run?.settings || s.settings, run, managerSessionId: s.runId ? sessions.managerId(s.runId) : id, capabilities: { configure: !s.runId, send: !s.runId || running && !!agent, stop: running && s.thread === 'manager', models: running && s.thread === 'manager' } };
  };
  const unary = (endpoint, raw) => {
    const p = unpack(raw), id = p.sessionId || p.address?.sessionId, s = id ? sessions.resolve(id) : null;
    if (endpoint === 'health') return ok({ ready: true });
    if (endpoint === 'session/create') return ok({ sessionId: sessions.create(id).id });
    if (endpoint === 'session/list') return ok({ items: all() });
    if (endpoint === 'session/page') {
      const events = synthesizeSessionEvents(entries(get(id))).filter(e => e.seq <= (p.throughSeq ?? Infinity) && e.seq < (p.beforeSeq ?? Infinity));
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
      if (!s.runId) {
        const run = runs.start({ ...s.settings, goal: text }); sessions.bind(s.id, run.id);
        return ok({ accepted: true });
      }
      const ctx = context(id);
      if (!ctx.capabilities.send) throw new Error('该会话已结束，请新建运行');
      const task = ctx.agent === 'manager' ? null : ctx.thread.split('-')[0];
      const result = runs.message(s.runId, { text, to: ctx.agent, task_id: task });
      return ok({ accepted: true, ...result });
    }
    if (endpoint === 'session/cancel') {
      const ctx = context(id);
      if (!ctx.capabilities.stop) throw new Error('只有本次运行的主代理会话可停止运行');
      runs.stop(ctx.runId); return ok({ accepted: true });
    }
    return dshUnary(s?.runId ? runs.dir(s.runId) : runs.dataDir, endpoint, raw);
  };
  const stream = (endpoint, raw, send) => {
    const p = unpack(raw); let timer;
    const cleanup = () => clearInterval(timer);
    if (endpoint === 'workspace/follow') {
      let previous = '';
      const push = () => {
        const ids = all().map(s => s.sessionId), signature = JSON.stringify(ids);
        if (signature === previous) return; previous = signature;
        send({ type: 'baseline', value: { items: [{ workspaceId: 'agent-router', path: runs.root, title: 'Agent Router', sessionIds: ids, createdAt: '2026-01-01T00:00:00Z', updatedAt: new Date().toISOString() }], archivedSessionIds: [], pinnedSessionIds: [] } });
      };
      push(); timer = setInterval(push, 1500); return cleanup;
    }
    if (endpoint === 'session/follow') {
      const id = p.address?.sessionId || p.sessionId;
      const s = get(id); let count = 0;
      const initial = synthesizeSessionEvents(entries(s)); count = initial.length;
      send({ type: 'snapshot', header: sessionHeader(id, s.createdAt || initial[0]?.time || Date.now()), cursor: count, records: initial.map(event => ({ type: 'event', event })), hasMore: false, projections: { asOfSeq: count, values: modelSelectionValues() }, assistantStream: { revision: 0 } });
      timer = setInterval(() => {
        try {
          const events = synthesizeSessionEvents(entries(get(id)));
          for (const event of events.slice(count)) send({ type: 'event', event });
          count = events.length;
        } catch (e) { send({ type: 'error', error: { code: 'router/read-failed', message: e.message } }); }
      }, 1000);
      return cleanup;
    }
    return dshStream(runs.dataDir, endpoint, raw, send);
  };
  return { unary, stream, context, all };
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
      return ok({ asOfSeq: 0, values: {} });
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
    try { for (const item of all()) projections[item.sessionId] = { asOfSeq: 0, values: modelSelectionValues() }; } catch {}
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
      // 之后每秒检查 manager 线程文件，把新条目逐条合成 append 帧
      send({
        type: 'snapshot',
        header: sessionHeader(sessionId, Date.now()),
        cursor: 0,
        records: [],
        hasMore: false,
        projections: { asOfSeq: 0, values: {} },
        assistantStream: { revision: 0 },
      });
      let lastCount = 0;
      let lastSeq = 0;
      timers.push(setInterval(() => {
        try {
          const all = readThreadEntries(runDir, 'manager') || [];
          if (all.length === lastCount) return;
          const fresh = all.slice(lastCount);
          lastCount = all.length;
          const assistantTexts = entriesTexts(all.slice(0, all.length - fresh.length));
          for (const e of fresh) {
            const r = synthesizeEntry(e, lastSeq, assistantTexts);
            lastSeq = r.nextSeq;
            for (const event of r.events) send({ type: 'event', event });
          }
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
    send({
      type: 'snapshot',
      header: sessionHeader(sessionId, createdAt),
      cursor: events.length,
      records: events.map(event => ({ type: 'event', event })),
      hasMore: false,
      projections: { asOfSeq: events.length, values: {} },
      assistantStream: { revision: 0 },
    });
    // 增量:轮询线程文件,把新条目逐条合成 append 帧(seq 必须严格 +1 递增)
    let lastSeq = events.length;
    let lastEntryCount = entries.length;
    timers.push(setInterval(() => {
      try {
        const all = readThreadEntries(runDir, threadName) || [];
        if (all.length === lastEntryCount) return;
        const fresh = all.slice(lastEntryCount);
        lastEntryCount = all.length;
        const assistantTexts = new Set(entriesTexts(all.slice(0, all.length - fresh.length)));
        for (const e of fresh) {
          const r = synthesizeEntry(e, lastSeq, assistantTexts);
          lastSeq = r.nextSeq;
          for (const event of r.events) send({ type: 'event', event });
        }
      } catch {}
    }, 1000));
    return stop;
  }
  // 未知流:保持打开但不发数据,客户端按业务超时自行降级
  return stop;
}

function entriesTexts(entries) {
  const set = new Set();
  for (const e of entries) if (e.kind === 'assistant') set.add(String(e.data?.text ?? ''));
  return set;
}
