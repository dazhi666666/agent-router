'use strict';
// 协作拓扑：成员 → 主代理 → 结果三栏节点图 + 时间泳道。数据来自 /api/runs/:id 与运行中的 SSE 快照；
// 没有任何运行（或 ?demo=1）时播放一段本地模拟运行，不调用接口
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssId = s => String(s).replace(/[^\w-]/g, '_');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const AGENTS = {
  manager: { name: '主代理', color: '#6d5efc' },
  claude: { name: 'Claude Code', color: '#d97757', glyph: 'C' },
  zcode: { name: 'ZCode', color: '#3b82f6', glyph: 'Z' },
  'zcode-oss': { name: 'ZCode OSS', color: '#0ea5e9', glyph: 'Z' },
  devin: { name: 'Devin', color: '#10b981', glyph: 'D' },
  codex: { name: 'Codex', color: '#64748b', glyph: 'X' },
  opencode: { name: 'OpenCode', color: '#f59e0b', glyph: 'O' },
  antigravity: { name: 'Antigravity', color: '#8b5cf6', glyph: 'A' },
  dsh: { name: 'DSH', color: '#4d6bfe', glyph: 'D' }
};
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const colorOf = a => AGENTS[a]?.color || `hsl(${hue(a)} 62% 52%)`;
const nameOf = a => AGENTS[a]?.name || a;
const glyphOf = a => AGENTS[a]?.glyph || String(nameOf(a))[0].toUpperCase();
const avatar = (a, cls = '') => `<span class="av ${cls}" style="--c:${colorOf(a)}">${esc(glyphOf(a))}</span>`;
const LABEL = { pending: '待执行', in_progress: '运行中', done: '已完成', failed: '失败' };
const RUN_LABEL = { running: '运行中', finished: '已结束', failed: '异常退出', interrupted: '已中断' };
const SESSION_LABEL = { starting: '启动中', online: '在线', restarting: '重启中', dead: '已停止' };
const ts = v => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));
const clock = t => new Date(t).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ICON = {
  folder: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6a1.5 1.5 0 0 1 1.5-1.5H8l2 2h5.5A1.5 1.5 0 0 1 17 8v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14V6Z"/></svg>',
  report: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="3" width="12" height="14" rx="2"/><path d="M7 7h6M7 10h6M7 13h4"/></svg>',
  flag: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5"/></svg>'
};

const state = { wires: {}, runs: [], runId: new URLSearchParams(location.search).get('runId'), data: null, demo: new URLSearchParams(location.search).get('demo') === '1', stageSig: '', wireSig: '', prevStatus: new Map() };
let es = null, demoTimer = null, abort = null;

async function get(url, signal) { const r = await fetch(url, { signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || '请求失败'); return d; }
function setConn(text, kind = '') { const el = $('#conn'); el.textContent = text; el.className = 'fx-conn ' + kind; }

/* ---------- 数据加载 ---------- */
async function loadRuns() {
  try { state.runs = await get('/api/runs'); } catch { state.runs = []; }
  renderSide();
  if (state.demo) return;
  if (state.runId && state.runs.some(r => r.id === state.runId)) return load();
  if (state.runs[0]) return select(state.runs[0].id);
  startDemo();
}
async function select(id) {
  stopDemo(); es?.close(); es = null;
  state.runId = id; state.data = null; state.stageSig = ''; state.wireSig = ''; state.prevStatus.clear();
  history.replaceState(null, '', `?runId=${encodeURIComponent(id)}`);
  enter(); renderSide(); await load();
}
async function load() {
  if (state.demo || !state.runId) return;
  const id = state.runId; abort?.abort(); abort = new AbortController();
  try {
    const d = await get(`/api/runs/${encodeURIComponent(id)}`, abort.signal);
    if (id !== state.runId || state.demo) return;
    state.data = d; render();
    setConn(d.status === 'running' ? '实时同步' : RUN_LABEL[d.status] || '历史记录', d.status === 'running' ? 'ok' : '');
    if (d.status === 'running' && !es) connect();
  } catch (e) { if (e.name !== 'AbortError') setConn('连接中断 · 正在重试', 'bad'); }
}
function connect() {
  const id = state.runId;
  es = new EventSource(`/api/events?runId=${encodeURIComponent(id)}`);
  es.onmessage = e => {
    const m = JSON.parse(e.data); if (m.runId !== state.runId || state.demo) return;
    if (m.type === 'snapshot') { state.data = m.run; render(); setConn('实时同步', 'ok'); }
    else if (m.type === 'status' && state.data) { state.data.agentStatus = m.status; render(); }
    else if (m.type === 'exit' || (m.type === 'hello' && !m.running)) { es?.close(); es = null; load(); }
  };
  es.onerror = () => setConn('连接恢复中…', 'bad');
}

/* ---------- 渲染 ---------- */
function members(d) {
  const tasks = d?.board?.tasks || [];
  return [...new Set([...(d?.settings?.agents || []), ...tasks.map(t => t.assignee)])].filter(Boolean);
}
function agentState(tasks) {
  if (tasks.some(t => t.status === 'in_progress')) return ['s-run', '运行中'];
  if (tasks.some(t => t.status === 'failed')) return ['s-bad', '有失败'];
  if (tasks.length && tasks.every(t => t.status === 'done')) return ['s-done', '已完成'];
  return ['', tasks.length ? '排队中' : '待命'];
}
function render() {
  const d = state.data, tasks = d?.board?.tasks || [], live = d?.status === 'running';
  const running = tasks.filter(t => t.status === 'in_progress').length;
  $('#goal').textContent = d?.goal || (state.runId ? '目标未记录' : '请选择一次运行');
  $('#goal-badge').textContent = state.demo ? '演示' : d?.mode === 'chat' ? '会话' : '运行';
  $('#stats').innerHTML = d ? `<span><b>${members(d).length}</b>执行成员</span><span><b>${tasks.length}</b>任务</span><span><b>${tasks.filter(t => t.status === 'done').length}</b>已完成</span>${running ? `<span class="live"><b>${running}</b>个任务执行中</span>` : ''}` : '';
  renderMembers(d);
  renderStage(d, live);
  renderLanes(d, live);
  document.title = `${d?.goal ? d.goal.slice(0, 24) + ' · ' : ''}协作拓扑 · Agent Router`;
}
function renderSide() {
  const items = state.runs;
  $('#runs').innerHTML = (state.demo ? `<button class="fx-run on" data-demo><strong><span class="dot live"></span>演示 · 模拟运行</strong><small>本地动画，不调用 Agent</small></button>` : '')
    + (items.map(r => `<button class="fx-run ${!state.demo && r.id === state.runId ? 'on' : ''}" data-run="${esc(r.id)}"><strong><span class="dot ${r.live ? 'live' : ''}"></span>${esc(r.goal || r.id)}</strong><small>${esc(nameOf(r.settings?.main || 'claude'))} · ${r.summary.done}/${r.summary.total} 完成${r.summary.failed ? ` · ${r.summary.failed} 失败` : ''}</small></button>`).join('')
    || (state.demo ? '' : '<p class="fx-dim">暂无运行</p>'));
}
function renderMembers(d) {
  const tasks = d?.board?.tasks || [];
  const main = d?.settings?.main || 'claude';
  $('#members').innerHTML = [`<div class="fx-member ${d?.status === 'running' ? 's-run' : ''}" style="--c:${colorOf(main)}" title="主代理 · ${esc(nameOf(main))}">${avatar(main)}<span>主代理</span></div>`]
    .concat(members(d).map(a => `<div class="fx-member ${agentState(tasks.filter(t => t.assignee === a))[0]}" style="--c:${colorOf(a)}" title="${esc(nameOf(a))}">${avatar(a)}<span>${esc(nameOf(a))}</span></div>`)).join('');
}
function renderStage(d, live) {
  const tasks = d?.board?.tasks || [], s = d?.agentStatus || {}, main = d?.settings?.main || 'claude';
  const artifacts = tasks.flatMap(t => (t.artifacts || []).map(a => ({ t, name: typeof a === 'string' ? a : a.path || a.name || JSON.stringify(a) })));
  const reports = tasks.filter(t => t.status === 'done' || t.status === 'failed').sort((a, b) => (ts(b.finished_at) || 0) - (ts(a.finished_at) || 0));
  const finished = d?.board?.finished;
  const sig = JSON.stringify([state.runId, state.demo, tasks.map(t => [t.id, t.status, t.title, t.assignee, (t.artifacts || []).length, t.result?.length]), members(d), live, s.session, s.turns, s.currentTool, d?.goal, !!finished]);
  if (sig === state.stageSig) return;
  state.stageSig = sig;
  let i = 0;
  const row = (t, side) => `<li class="row s-${esc(t.status)}" data-task="${esc(t.id)}" style="--c:${colorOf(t.assignee)}">${side === 'in' ? '<span class="port in"></span>' : ''}<span class="tid">${esc(t.id)}</span><span class="tt">${side === 'in' ? esc(nameOf(t.assignee)) + ' · ' : ''}${esc(t.title)}</span><span class="st">${LABEL[t.status] || esc(t.status)}</span>${side === 'out' ? '<span class="port out"></span>' : ''}</li>`;
  $('#n-agents').textContent = members(d).length || '';
  $('#col-agents').innerHTML = members(d).map(a => {
    const own = tasks.filter(t => t.assignee === a), [cls, label] = agentState(own);
    return `<article class="node agent ${cls}" data-agent="${esc(a)}" style="--c:${colorOf(a)};--i:${i++}"><header>${avatar(a)}<div><b>${esc(nameOf(a))}</b><small>${esc(d?.settings?.models?.[a] || '客户端默认模型')}</small></div><span class="state"><i></i>${label}</span></header>${own.length ? `<ul class="rows">${own.map(t => row(t, 'out')).join('')}</ul>` : ''}</article>`;
  }).join('') || '<p class="fx-dim" style="text-align:center">尚无执行成员</p>';
  const sessionLabel = live ? `${SESSION_LABEL[s.session] || '在线'}${s.turns ? ` · 回合 ${s.turns}` : ''}${s.currentTool ? ` · ⚙ ${s.currentTool}` : ''}` : RUN_LABEL[d?.status] || '空闲';
  $('#col-hub').innerHTML = `<article class="node hub ${live ? 'live s-run' : ''}" style="--c:${colorOf(main)};--i:${i++}">
    <div class="hub-head">${avatar(main)}<b>${esc(nameOf(main))}</b><small>主代理 · 拆解 · 派发 · 汇总</small><span class="state"><i></i>${esc(sessionLabel)}</span></div>
    <div class="hub-goal"><small>当前目标</small><p>${esc(d?.goal || '—')}</p></div>
    ${tasks.length ? `<ul class="rows">${tasks.map(t => row(t, 'in')).join('')}</ul>` : '<div class="hub-empty">主代理还没有派发任务</div>'}
    <ul class="rows outs"><li class="row" data-out="artifacts"><span class="tt">产物汇总</span><span class="st">${artifacts.length}</span><span class="port out" style="--c:#0ea5e9"></span></li><li class="row" data-out="reports"><span class="tt">任务报告</span><span class="st">${reports.length}</span><span class="port out" style="--c:var(--ok)"></span></li></ul>
  </article><p class="hub-foot">— 子代理结果汇入，主代理整合分发</p>`;
  const MAX = 6;
  const sinks = [
    `<article class="node sink" data-sink="artifacts" style="--i:${i++}"><span class="port in"></span><header><span class="ico">${ICON.folder}</span><div><b>产物</b><small>${esc(d?.settings?.repo || '工作目录')}</small></div><span class="count">${artifacts.length}</span></header>${artifacts.length ? `<ul class="rows">${artifacts.slice(0, MAX).map(a => `<li class="row s-${esc(a.t.status)}" data-task="${esc(a.t.id)}" style="--c:${colorOf(a.t.assignee)}"><span class="tid">${esc(a.t.id)}</span><span class="tt">${esc(a.name)}</span></li>`).join('')}</ul>${artifacts.length > MAX ? `<div class="more">还有 ${artifacts.length - MAX} 个产物</div>` : ''}` : '<p class="idle-note" style="padding-left:12px">等待子代理提交产物</p>'}</article>`,
    `<article class="node sink reports" data-sink="reports" style="--i:${i++}"><span class="port in"></span><header><span class="ico">${ICON.report}</span><div><b>任务报告</b><small>完成即回传主代理</small></div><span class="count">${reports.length}</span></header>${reports.length ? `<ul class="rows">${reports.slice(0, MAX).map(t => `<li class="row s-${esc(t.status)}" data-task="${esc(t.id)}" style="--c:${colorOf(t.assignee)}"><span class="tid">${esc(t.id)}</span><span class="tt">${esc((t.result || t.title).split('\n')[0])}</span><span class="st">${LABEL[t.status]}</span></li>`).join('')}</ul>${reports.length > MAX ? `<div class="more">还有 ${reports.length - MAX} 份报告</div>` : ''}` : '<p class="idle-note" style="padding-left:12px">任务完成后报告会汇集到这里</p>'}</article>`
  ];
  if (finished) sinks.push(`<article class="node sink summary" data-sink="summary" style="--i:${i++}"><span class="port in"></span><header><span class="ico">${ICON.flag}</span><div><b>运行总结</b><small>主代理交付</small></div></header><p class="summary-text">${esc(finished.summary || '')}</p></article>`);
  $('#n-outs').textContent = sinks.length;
  $('#col-outs').innerHTML = sinks.join('');
  // 状态变化交给飞线演出（首次加载不演）
  const changes = [];
  for (const t of tasks) {
    const before = state.prevStatus.get(t.id);
    if (before && before !== t.status) changes.push({ t, to: t.status });
    state.prevStatus.set(t.id, t.status);
  }
  requestAnimationFrame(() => { drawWires(); renderLanes(state.data, live); play(changes); });
}

/* ---------- 连线：静态点线，动效全部交给下面的"飞线" ---------- */
function center(el, box) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }; }
function curve(a, b) { const dx = Math.max(36, (b.x - a.x) * 0.5); return `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${(a.x + dx).toFixed(1)},${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`; }
function drawWires() {
  const stage = $('#stage'), svg = $('#wires');
  if (getComputedStyle(svg).display === 'none') return;
  const box = stage.getBoundingClientRect(), tasks = state.data?.board?.tasks || [];
  const paths = [];
  state.wires = {};
  for (const t of tasks) {
    const a = stage.querySelector(`.agent .row[data-task="${CSS.escape(t.id)}"] .port`), b = stage.querySelector(`.hub .row[data-task="${CSS.escape(t.id)}"] .port`);
    if (!a || !b) continue;
    const w = state.wires[t.id] = { a: center(a, box), b: center(b, box), color: colorOf(t.assignee) };
    paths.push({ task: t.id, cls: 's-' + t.status, color: w.color, d: curve(w.a, w.b) });
  }
  for (const [key, color] of [['artifacts', '#0ea5e9'], ['reports', '#16a34a'], ['summary', '#6d5efc']]) {
    const from = stage.querySelector(`.hub [data-out="${key === 'summary' ? 'reports' : key}"] .port`), to = stage.querySelector(`[data-sink="${key}"] > .port`);
    if (!from || !to) continue;
    const w = state.wires['out:' + key] = { a: center(from, box), b: center(to, box), color };
    paths.push({ cls: 'out', color, d: curve(w.a, w.b) });
  }
  const sig = JSON.stringify([box.width | 0, box.height | 0, paths]);
  if (sig === state.wireSig) return;
  state.wireSig = sig;
  for (const el of [svg, $('#comets')]) el.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = paths.map(p => `<path class="wire ${p.cls}" style="--c:${p.color}" ${p.task ? `data-task="${esc(p.task)}"` : ''} d="${p.d}"/>`).join('');
}

/* ---------- 飞线：离散的彗星光点（亮头 + 渐隐尾巴），到达时目标处泛起涟漪 ---------- */
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); parent?.append(el); return el; }
const easeInOut = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const easeOut = t => 1 - (1 - t) ** 3;
function ripple(svg, p, color) {
  const c = svgEl('circle', { cx: p.x, cy: p.y, r: 3, fill: 'none', stroke: color, 'stroke-width': 2.6 }, svg), t0 = performance.now();
  (function frame(now) { const k = Math.min(1, (now - t0) / 650); c.setAttribute('r', 3 + easeOut(k) * 13); c.setAttribute('opacity', 1 - k); k < 1 ? requestAnimationFrame(frame) : c.remove(); })(t0);
}
// 尾巴用三层不同长度/透明度的描边叠出渐隐，dasharray "0 起点 长度 余量" 只露出头部后面的一段
function comet(svg, d, color, { tail = 54, onArrive } = {}) {
  if (reduceMotion || document.hidden) { onArrive?.(); return; }
  const g = svgEl('g', { class: 'comet', style: `--c:${color}` }, svg);
  const layers = [[1, 2.4, .18], [.5, 3.4, .42], [.18, 4.6, .92]].map(([f, w, o]) => ({ f, p: svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', opacity: o }, g) }));
  const len = layers[0].p.getTotalLength(), dur = Math.min(1800, Math.max(750, len * 2.6)), t0 = performance.now();
  const head = svgEl('circle', { r: 4.4, class: 'comet-head', style: `--c:${color}` }, g);
  let arrived = false;
  (function frame(now) {
    const k = Math.min(1, (now - t0) / dur), pos = easeInOut(k) * (len + tail), hp = Math.min(pos, len);
    for (const { f, p } of layers) { const start = Math.max(0, pos - tail * f); p.setAttribute('stroke-dasharray', `0 ${start} ${Math.max(0, hp - start)} ${len + tail}`); }
    const pt = layers[0].p.getPointAtLength(hp); head.setAttribute('cx', pt.x); head.setAttribute('cy', pt.y); head.setAttribute('opacity', pos > len ? 0 : 1);
    if (!arrived && pos >= len) { arrived = true; ripple(svg, pt, color); onArrive?.(); }
    k < 1 ? requestAnimationFrame(frame) : g.remove();
  })(t0);
}
// 跨面板飞线（泳道 ↔ 卡片）：曲线从起点"长"出去，到达后从尾部收回
function flyLine(fromEl, toEl, color, onArrive) {
  if (!fromEl || !toEl || reduceMotion || document.hidden) return;
  const svg = $('#overlay'), r1 = fromEl.getBoundingClientRect(), r2 = toEl.getBoundingClientRect();
  const a = { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 }, b = { x: r2.left + 8, y: r2.top + r2.height / 2 };
  const sag = Math.max(a.y, b.y) + Math.min(160, Math.abs(b.x - a.x) * .25 + 40);
  const d = `M${a.x},${a.y} C${a.x + (b.x - a.x) * .15},${sag} ${b.x - (b.x - a.x) * .35},${sag} ${b.x},${b.y}`;
  const g = svgEl('g', { class: 'flyline', style: `--c:${color}` }, svg);
  const glow = svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 9, opacity: .2, 'stroke-linecap': 'round' }, g);
  const line = svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.8, 'stroke-linecap': 'round' }, g);
  const head = svgEl('circle', { r: 4.6, class: 'comet-head', style: `--c:${color}` }, g);
  const len = line.getTotalLength(), GROW = 700, HOLD = 380, SHRINK = 520, t0 = performance.now();
  let arrived = false;
  (function frame(now) {
    const t = now - t0;
    let s = 0, e = len;
    if (t < GROW) e = easeOut(t / GROW) * len;
    else if (t > GROW + HOLD) s = easeInOut(Math.min(1, (t - GROW - HOLD) / SHRINK)) * len;
    const dash = `0 ${s} ${Math.max(0, e - s)} ${len}`;
    line.setAttribute('stroke-dasharray', dash); glow.setAttribute('stroke-dasharray', dash);
    const pt = line.getPointAtLength(e); head.setAttribute('cx', pt.x); head.setAttribute('cy', pt.y);
    head.setAttribute('opacity', t < GROW ? 1 : Math.max(0, 1 - (t - GROW) / HOLD));
    if (!arrived && t >= GROW) { arrived = true; ripple(svg, pt, color); onArrive?.(); }
    t < GROW + HOLD + SHRINK ? requestAnimationFrame(frame) : g.remove();
  })(t0);
}
function flash(selector) { document.querySelectorAll(selector).forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }); }
function wireComet(key, color, reverse, onArrive) {
  const w = state.wires?.[key]; if (!w) return onArrive?.();
  comet($('#comets'), reverse ? curve(w.b, w.a) : curve(w.a, w.b), color || w.color, { onArrive });
}
// 状态变化 → 一串有因果的飞线：派发（主代理 → 成员）、完成（成员 → 主代理 → 报告，同时泳道飞向报告卡）
function play(changes) {
  changes.forEach(({ t, to }, i) => setTimeout(() => {
    const id = CSS.escape(t.id), bad = to === 'failed' ? '#e5484d' : null;
    if (to === 'in_progress') wireComet(t.id, null, true, () => flash(`.agent .row[data-task="${id}"]`));
    if (to === 'done' || to === 'failed') {
      wireComet(t.id, bad, false, () => {
        flash(`.hub .row[data-task="${id}"]`);
        wireComet('out:reports', bad, false, () => flash(`[data-sink="reports"] .row[data-task="${id}"]`));
        if (t.artifacts?.length) setTimeout(() => wireComet('out:artifacts', null, false, () => flash(`[data-sink="artifacts"] .row[data-task="${id}"]`)), 260);
      });
      setTimeout(() => flyLine(document.querySelector(`.lane-item[data-task="${id}"] .lane-end`), document.querySelector(`[data-sink="reports"] .row[data-task="${id}"]`), bad || colorOf(t.assignee)), 900);
    }
  }, i * 420));
}
// 平时的"心跳"：执行中的任务隔几秒向主代理送出一颗光点，同时最多两颗在飞
const cooldown = new Map();
setInterval(() => {
  const d = state.data; if (document.hidden || reduceMotion || d?.status !== 'running') return;
  const now = Date.now(), ready = (d.board?.tasks || []).filter(t => t.status === 'in_progress' && state.wires?.[t.id] && !(cooldown.get(t.id) > now));
  if (!ready.length || document.querySelectorAll('#comets .comet').length >= 2) return;
  const t = ready[Math.floor(Math.random() * ready.length)];
  cooldown.set(t.id, now + 2600 + Math.random() * 3200);
  wireComet(t.id, null, false, () => flash(`.hub .row[data-task="${CSS.escape(t.id)}"]`));
}, 650);

/* ---------- 时间泳道 ---------- */
function renderLanes(d, live) {
  const host = $('#lanes'), tasks = d?.board?.tasks || [], messages = d?.board?.messages || [];
  const lanes = ['manager', ...members(d)], main = d?.settings?.main || 'claude';
  const W = Math.max(host.clientWidth - 2, 640), L = 116, R = 18, TOP = 22, H = 30;
  const now = Date.now();
  const times = [ts(d?.startedAt), ...tasks.flatMap(t => [ts(t.created_at), ts(t.started_at), ts(t.finished_at)]), ...messages.map(m => ts(m.ts))].filter(Number.isFinite);
  if (!d || !times.length) { host.innerHTML = `<svg width="${W}" height="60"><text class="lane-empty" x="${W / 2}" y="34" text-anchor="middle">任务派发后，这里按时间展示每个成员的执行轨迹</text></svg>`; return; }
  const t0 = Math.min(...times), t1 = Math.max(...times, live ? now : 0) + 1, span = Math.max(t1 - t0, 60e3);
  const x = t => L + (Math.min(Math.max(t, t0), t0 + span) - t0) / span * (W - L - R);
  const y = a => TOP + lanes.indexOf(a) * H + H / 2;
  const height = TOP + lanes.length * H + 6;
  const out = [];
  const step = [10e3, 30e3, 60e3, 120e3, 300e3, 600e3, 1800e3, 3600e3, 7200e3, 21600e3, 86400e3].find(s => span / s <= 7) || 86400e3;
  for (let t = Math.ceil(t0 / step) * step; t <= t0 + span; t += step) out.push(`<line class="lane-tick" x1="${x(t)}" x2="${x(t)}" y1="${TOP - 4}" y2="${height}"/><text class="lane-tick-text" x="${x(t)}" y="12" text-anchor="middle">${new Date(t).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', ...(step < 60e3 ? { second: '2-digit' } : {}) })}</text>`);
  lanes.forEach(a => {
    const c = a === 'manager' ? colorOf(main) : colorOf(a);
    out.push(`<g style="--c:${c}"><circle cx="12" cy="${y(a)}" r="4" fill="${c}"/><text class="lane-label" x="22" y="${y(a) + 4}">${esc(a === 'manager' ? '主代理' : nameOf(a))}</text><line class="lane-line" x1="${L}" x2="${W - R}" y1="${y(a)}" y2="${y(a)}"/></g>`);
  });
  if (live) out.push(`<line class="lane-now" x1="${x(now)}" x2="${x(now)}" y1="${TOP - 4}" y2="${height}"/>`);
  for (const t of tasks) {
    if (!lanes.includes(t.assignee)) continue;
    const c = colorOf(t.assignee), created = ts(t.created_at) ?? ts(t.started_at), start = ts(t.started_at), end = ts(t.finished_at) ?? (t.status === 'in_progress' ? now : null);
    const ym = y('manager'), ya = y(t.assignee), g = [];
    if (created != null) {
      const xc = x(created), xs = start != null ? x(start) : xc + 8;
      g.push(`<path class="lane-dispatch" d="M${xc},${ym} C${xc + 14},${ym} ${xs - 14},${ya} ${xs},${ya}"/>`, `<circle class="lane-node" cx="${xc}" cy="${ym}" r="3"/>`);
    }
    if (start != null) {
      const xs = x(start), xe = end != null ? x(end) : xs + 4;
      g.push(`<rect class="lane-bar" x="${xs}" y="${ya - 5}" width="${Math.max(xe - xs, 4)}" height="10" rx="5"/>`, `<circle class="lane-node" cx="${xs}" cy="${ya}" r="3.5"/>`);
      if (t.status === 'done' || t.status === 'failed') g.push(`<path class="lane-report" d="M${xe},${ya} C${xe + 14},${ya} ${xe + 4},${ym} ${xe + 18},${ym}"/>`, `<circle class="lane-node lane-end" cx="${xe}" cy="${ya}" r="4.5"/>`);
    } else if (created == null) continue;
    const tip = `${t.id} · ${nameOf(t.assignee)} · ${LABEL[t.status] || t.status}\n${t.title}${start ? `\n开始 ${clock(start)}` : ''}${ts(t.finished_at) ? `  结束 ${clock(ts(t.finished_at))}` : ''}`;
    out.push(`<g class="lane-item s-${esc(t.status)}" data-task="${esc(t.id)}" data-tip="${esc(tip)}" style="--c:${c}">${g.join('')}</g>`);
  }
  for (const m of messages) {
    const from = m.from === 'user' ? 'manager' : m.from, to = m.to;
    if (!lanes.includes(from) || !lanes.includes(to) || ts(m.ts) == null) continue;
    const xm = x(ts(m.ts)), y1 = y(from), y2 = y(to), bend = Math.min(30, Math.abs(y2 - y1) / 2 + 8);
    out.push(`<g class="lane-item" ${m.task_id ? `data-task="${esc(m.task_id)}"` : ''} data-tip="${esc(`${m.from} → ${m.to} · ${clock(ts(m.ts))}\n${String(m.content).slice(0, 160)}`)}"><path class="lane-mail-arc" d="M${xm},${y1} C${xm + bend},${y1} ${xm + bend},${y2} ${xm},${y2}"/><rect class="lane-mail" x="${xm - 3.5}" y="${y2 - 3.5}" width="7" height="7" transform="rotate(45 ${xm} ${y2})"/></g>`);
  }
  host.innerHTML = `<svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${out.join('')}</svg>`;
}

/* ---------- 交互：悬停联动、提示、详情抽屉 ---------- */
function highlight(id) {
  document.body.classList.toggle('focus', !!id);
  document.querySelectorAll('.hl').forEach(el => el.classList.remove('hl'));
  if (id) document.querySelectorAll(`[data-task="${CSS.escape(id)}"]`).forEach(el => el.classList.add('hl'));
}
let hovered = null;
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-task]'), id = el?.dataset.task || null;
  if (id !== hovered) { hovered = id; highlight(id); }
  const tipEl = e.target.closest('[data-tip]');
  $('#tip').hidden = !tipEl; if (tipEl) $('#tip').textContent = tipEl.dataset.tip;
});
document.addEventListener('mousemove', e => { const tip = $('#tip'); if (tip.hidden) return; tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; });
document.addEventListener('click', e => {
  const run = e.target.closest('[data-run]'); if (run) return select(run.dataset.run);
  if (e.target.closest('[data-demo]')) return;
  const el = e.target.closest('[data-task]'); if (!el || e.target.closest('#drawer')) return;
  // 点泳道条目：从泳道飞一条线到节点图里对应的行
  if (el.matches('.lane-item')) { const id = CSS.escape(el.dataset.task), t = state.data?.board?.tasks?.find(x => x.id === el.dataset.task); flyLine(el.querySelector('.lane-end, .lane-node, .lane-mail'), document.querySelector(`.hub .row[data-task="${id}"]`), t ? colorOf(t.assignee) : '#6d5efc', () => flash(`.hub .row[data-task="${id}"]`)); }
  openDrawer(el.dataset.task);
});
function openDrawer(id) {
  const t = state.data?.board?.tasks?.find(x => x.id === id); if (!t) return;
  const msgs = (state.data.board.messages || []).filter(m => m.task_id === id);
  $('#drawer-body').innerHTML = `<div class="dh">${avatar(t.assignee)}<div><b>${esc(t.title)}</b><div style="color:var(--muted);font-size:11.5px">${esc(t.id)} · ${esc(nameOf(t.assignee))} · ${LABEL[t.status] || esc(t.status)}${t.isolated ? ' · 隔离执行' : ''}</div></div></div>
    <h4>任务说明</h4><p>${esc(t.spec || '未填写')}</p>
    <h4>结果</h4><pre>${esc(t.result || '尚无结果')}</pre>
    ${t.artifacts?.length ? `<h4>产物</h4><ul>${t.artifacts.map(a => `<li>${esc(typeof a === 'string' ? a : JSON.stringify(a))}</li>`).join('')}</ul>` : ''}
    ${t.blocked_by?.length ? `<h4>依赖</h4><p>${esc(t.blocked_by.join(', '))}</p>` : ''}
    <h4>时间</h4><p>${t.created_at ? `创建 ${clock(ts(t.created_at))}` : ''}${t.started_at ? `\n开始 ${clock(ts(t.started_at))}` : ''}${t.finished_at ? `\n结束 ${clock(ts(t.finished_at))}` : ''}</p>
    ${msgs.length ? `<h4>相关消息</h4>${msgs.map(m => `<p><b>${esc(m.from)} → ${esc(m.to)}</b>：${esc(m.content)}</p>`).join('')}` : ''}`;
  $('#drawer').hidden = false;
}
$('#drawer-close').onclick = () => { $('#drawer').hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#drawer').hidden = true; });

function enter() { const el = $('#stage'); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); setTimeout(() => el.classList.remove('enter'), 1400); }
new ResizeObserver(() => { requestAnimationFrame(drawWires); renderLanes(state.data, state.data?.status === 'running'); }).observe($('#stage'));

/* ---------- 演示模式：一段自动推进的模拟运行 ---------- */
function demoSeed() {
  // 时间轴压缩到秒级（m = 8 秒），让演示节拍在泳道上看得清
  const now = Date.now(), m = 8e3, at =k => new Date(now + k * m).toISOString();
  const task = (id, assignee, title, status, created, started, finished, extra = {}) => ({ id, assignee, title, status, created_at: at(created), ...(started != null ? { started_at: at(started) } : {}), ...(finished != null ? { finished_at: at(finished) } : {}), artifacts: [], blocked_by: [], spec: title + '：按主代理拆解要求完成，并在最终回复中给出结论与产物位置。', ...extra });
  return {
    id: 'demo', mode: 'goal', status: 'running', startedAt: now - 6 * m, goal: '智能门锁 · 国内外竞品调研与报告交付',
    settings: { main: 'claude', agents: ['codex', 'zcode', 'devin', 'opencode', 'dsh'], repo: 'D:\\demo\\lock-research', models: { codex: 'gpt-5-codex', zcode: 'glm-4.6', devin: 'swe-1.5', opencode: 'space-bunny', dsh: 'deepseek-v3.2' } },
    agentStatus: { session: 'online', turns: 6, currentTool: 'create_task' },
    board: {
      tasks: [
        task('T1', 'codex', '抓取国内电商评论与评分', 'done', -5.6, -5.5, -3.2, { result: '国内主流平台评论 2,431 条已清洗入库，差评集中在指纹识别率与续航。', artifacts: ['data/reviews_cn.json', 'data/ratings.csv'] }),
        task('T2', 'zcode', '整理海外论坛与 Amazon 口碑', 'in_progress', -5.4, -5.2, null),
        task('T3', 'devin', '价格带与渠道分析', 'in_progress', -4.8, -3.0, null),
        task('T4', 'opencode', '专利与安全认证检索', 'failed', -4.6, -4.4, -1.5, { result: '检索接口返回 429 限流，已记录已检索到的 18 条专利，待重试补全。', artifacts: ['research/patents_partial.md'] }),
        task('T5', 'codex', '功能矩阵对比表', 'pending', -3.1, null, null, { blocked_by: ['T1'] }),
        task('T6', 'dsh', '撰写竞品调研报告', 'pending', -2.9, null, null, { blocked_by: ['T2', 'T3', 'T5'] })
      ],
      messages: [
        { id: 'M1', from: 'codex', to: 'manager', task_id: 'T1', content: '国内评论已入库，字段说明写在 data/README.md。', ts: at(-3.3), read: true },
        { id: 'M2', from: 'manager', to: 'zcode', task_id: 'T2', content: '重点看 Reddit 与 Amazon 一星差评的共性问题。', ts: at(-2.6), read: true }
      ]
    }
  };
}
const DEMO_RESULTS = {
  T2: ['海外口碑：电池续航与 App 稳定性是最大槽点，高端用户在意 HomeKit 兼容。', 'research/overseas_voice.md'],
  T3: ['价格带集中在 999–1,999 元，线上渠道占比 71%，高端市场留有空档。', 'analysis/pricing.csv'],
  T4: ['补检完成：共 42 条相关专利，3 家竞品持有 C 级安全认证。', 'research/patents.md'],
  T5: ['功能矩阵覆盖 12 个品牌 × 26 项功能，已标注差异化机会点。', 'analysis/feature_matrix.xlsx'],
  T6: ['调研报告已完成，含结论摘要、机会点与风险提示。', 'report/competitive_report.md']
};
function demoTick() {
  const d = state.data, tasks = d.board.tasks, now = new Date().toISOString(), s = d.agentStatus;
  if (d.status !== 'running') { state.data = demoSeed(); state.prevStatus.clear(); state.stageSig = ''; enter(); return render(); }
  s.turns++;
  const runningTasks = tasks.filter(t => t.status === 'in_progress');
  const ready = tasks.find(t => t.status === 'pending' && t.blocked_by.every(b => tasks.find(x => x.id === b)?.status === 'done'));
  const retry = tasks.find(t => t.status === 'failed' && !t.retried);
  const oldest = runningTasks.sort((a, b) => ts(a.started_at) - ts(b.started_at))[0];
  if (oldest && (Date.now() - ts(oldest.started_at) > 9000 || !ready && !retry)) {
    const [result, file] = DEMO_RESULTS[oldest.id] || ['已完成。', null];
    Object.assign(oldest, { status: 'done', finished_at: now, result }); if (file) oldest.artifacts.push(file);
    d.board.messages.push({ id: 'M' + (d.board.messages.length + 1), from: oldest.assignee, to: 'manager', task_id: oldest.id, content: result, ts: now, read: false });
    s.currentTool = 'read_inbox';
  } else if (ready) { Object.assign(ready, { status: 'in_progress', started_at: now }); s.currentTool = 'create_task'; }
  else if (retry) { Object.assign(retry, { status: 'in_progress', started_at: now, retried: true }); delete retry.finished_at; s.currentTool = 'followup_task'; }
  else if (!runningTasks.length) {
    d.status = 'finished'; s.currentTool = null;
    d.board.finished = { summary: '竞品调研已完成：国内外口碑、价格带、专利与功能矩阵均已汇总进 report/competitive_report.md。\n建议优先切入 1,500–2,000 元高端价位，主打续航与 HomeKit 兼容。' };
  }
  render();
}
function startDemo() {
  stopDemo(); es?.close(); es = null; state.demo = true; state.runId = null;
  state.data = demoSeed(); state.stageSig = ''; state.wireSig = ''; state.prevStatus.clear();
  $('#btn-demo').setAttribute('aria-pressed', 'true'); setConn('模拟数据 · 不调用 Agent', 'ok');
  enter(); renderSide(); render();
  demoTimer = setInterval(demoTick, 3200);
}
function stopDemo() { clearInterval(demoTimer); demoTimer = null; if (state.demo) { state.demo = false; $('#btn-demo').setAttribute('aria-pressed', 'false'); } }
$('#btn-demo').onclick = () => {
  if (state.demo) { stopDemo(); state.runs[0] ? select(state.runs[0].id) : startDemo(); }
  else { history.replaceState(null, '', '?demo=1'); startDemo(); }
};

// 明暗主题：默认暗色（head 里的内联脚本已先行设置，避免闪白），选择记在本机
function paintThemeButton() { $('#btn-theme').textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; }
$('#btn-theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next; paintThemeButton();
  try { localStorage.setItem('flow-theme', next); } catch {}
};
paintThemeButton();

// 演示模式下泳道的"当前时刻"要跟着走；真实运行靠 SSE 快照，再加 5 秒兜底轮询
setInterval(() => { if (state.data?.status === 'running') renderLanes(state.data, true); }, 1000);
setInterval(() => { if (!document.hidden && !state.demo) { if (state.data?.status === 'running' && !es) load(); loadRuns(); } }, 8000);
if (state.demo) startDemo();
loadRuns();
