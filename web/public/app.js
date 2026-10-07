/* Agent Router 控制台前端 */
'use strict';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  health: null,
  runs: [],
  currentRun: null,   // { id, status, board, logs, consoleAvailable }
  es: null,           // EventSource（活跃运行）
  paused: false,
  stick: true,
  logFiles: [],
  filter: 'all',
  agentStatus: null,
  threads: [],        // 当前运行的会话线程文件列表
  modalThread: null,  // 弹窗中打开的线程名
  modalLog: null,     // 弹窗中打开的日志名
  threadPending: [],  // 线程视图中待配对的工具卡片（等 tool_result）
  threadStick: true
};

/* ---------- ANSI → HTML（router.mjs 输出用到的颜色码） ---------- */
function ansiToHtml(text) {
  const map = { 1: '<span class="b">', 2: '<span class="dim">', 31: '<span class="red">', 32: '<span class="green">', 33: '<span class="yellow">', 36: '<span class="cyan">' };
  let out = esc(text);
  out = out.replace(/\x1b\[([0-9;]*)m/g, (_, code) => {
    if (code === '0' || code === '' || code === '22' || code === '39') return '</span>';
    return map[code.split(';')[0]] || '';
  });
  return out;
}

/* ---------- 健康 ---------- */
async function loadHealth() {
  try {
    state.health = await (await fetch('/api/health')).json();
  } catch { state.health = null; return; }
  for (const a of ['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity']) {
    $('#h-' + a).classList.toggle('ok', !!state.health[a]);
    $('#h-' + a).title = state.health.checks?.[a] || '仅检测 CLI 路径';
    const label = document.querySelector(`#f-agents input[value=${a}]`).closest('label');
    label.classList.toggle('disabled', !state.health[a]);
    if (!state.health[a]) label.querySelector('input').checked = false;
  }
  const models = state.health.models || {};
  for (const [k, v] of Object.entries(models)) {
    const span = document.querySelector(`.model-tag[data-m="${k}"]`);
    if (span) span.textContent = v;
  }
  updateRunState();
}

function updateRunState() {
  const running = state.currentRun?.status === 'running';
  $('#run-state').className = 'pill ' + (running ? 'running' : 'idle');
  $('#run-state').textContent = running ? '当前运行执行中' : '历史记录 / 空闲';
  $('#btn-stop').disabled = !running;
  $('#btn-start').disabled = false;
}

/* ---------- 运行列表 ---------- */
const MAIN_LABELS = { claude: 'Claude', zcode: 'ZCode', devin: 'Devin', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity' };

async function loadRuns() {
  try { state.runs = await (await fetch('/api/runs')).json(); } catch { return; }
  const box = $('#run-list');
  if (!state.runs.length) { box.innerHTML = '<div class="empty">暂无运行记录</div>'; return; }
  box.innerHTML = state.runs.map(r => `
    <div class="run-item ${state.currentRun?.id === r.id ? 'active' : ''}" data-id="${esc(r.id)}">
      <div class="r-name">${r.live ? '<span class="live"></span>' : ''}${esc(r.id)}</div>
      ${r.goal ? `<div class="r-goal" title="${esc(r.goal)}">${esc(r.goal)}</div>` : ''}
      <div class="r-meta">
        <span class="tag total" title="主代理">主 ${esc(MAIN_LABELS[r.settings?.main] || r.settings?.main || 'Claude')}</span>
        <span class="tag total">${r.summary.total} 任务</span>
        <span class="tag done">✔ ${r.summary.done}</span>
        ${r.summary.failed ? `<span class="tag failed">✗ ${r.summary.failed}</span>` : ''}
        <span>${r.status === 'running' ? '进行中' : new Date(r.mtime).toLocaleString('zh-CN', { hour12: false })}</span>
      </div>
    </div>`).join('');
}

// 事件委托：列表重渲染后点击依然有效
document.getElementById('run-list').addEventListener('click', e => {
  const el = e.target.closest('.run-item');
  if (el?.dataset.id) openRun(el.dataset.id);
});

/* ---------- 打开某次运行 ---------- */
function disconnectSse() {
  if (state.es) { state.es.close(); state.es = null; }
}

async function openRun(id) {
  state.openId = id;
  disconnectSse();
  $('#console').innerHTML = '';
  state.currentRun = null;
  renderAgentStrip(null);
  try {
    const d = await (await fetch(`/api/runs/${id}`)).json();
    if (state.openId !== id) return;
    state.currentRun = d;
    $('#current-goal').textContent = d.goal || '历史运行 · 目标未记录';
    $('#shared-board').src = `/board?embedded=1&runId=${encodeURIComponent(id)}`;
    updateRunState();
    state.threads = d.threads || [];
    renderBoard(d.board);
    renderAgentStrip(d.agentStatus);
    renderLogs(d.logs);
    if (d.status === 'running') connectSse(id);
    else loadConsoleRest(id, d.consoleAvailable);
  } catch (e) {
    $('#board').innerHTML = `<div class="empty">加载失败: ${esc(e.message)}</div>`;
  }
  markActiveRun();
  updateSayAccess();
  await loadRuns();
}

function markActiveRun() {
  document.querySelectorAll('.run-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === state.currentRun?.id));
}

function connectSse(id) {
  state.es = new EventSource('/api/events?runId=' + encodeURIComponent(id));
  state.es.onopen = () => { if (state.currentRun?.id === id) loadConsoleRest(id, true); };
  state.es.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (state.currentRun?.id !== id || (m.runId && m.runId !== id)) return;
    if (m.eventId && m.eventId <= (state.lastEventIds?.[id] || 0)) return;
    if (m.eventId) { state.lastEventIds ??= {}; state.lastEventIds[id] = m.eventId; }
    if (m.type === 'snapshot') { state.currentRun = m.run; updateRunState(); return; }
    if (m.type === 'console') appendConsole(m.line);
    else if (m.type === 'board') { state.currentRun.board = m.board; renderBoard(m.board); }
    else if (m.type === 'status') { state.agentStatus = m.status; renderAgentStrip(m.status); }
    else if (m.type === 'threads') { state.threads = m.threads; renderModalList(); }
    else if (m.type === 'thread') {
      if (state.modalThread === m.name && !$('#log-modal').classList.contains('hidden')) {
        for (const e of m.entries) appendThreadEntry(e);
      }
    }
    else if (m.type === 'exit') {
      appendConsole(`\n[进程退出，code=${m.code}]\n`);
      state.currentRun.status = 'finished';
      renderAgentStrip(null);
      updateSayAccess();
      loadHealth(); loadRuns();
    }
  };
}

async function loadConsoleRest(id, available) {
  if (!available) {
    $('#console').innerHTML = '<div class="empty dim">该运行由 CLI 启动，无控制台记录（任务板与会话日志仍可查看）</div>';
    return;
  }
  try {
    const d = await (await fetch(`/api/runs/${id}/console`)).json();
    $('#console').innerHTML = (d.text || '').split('\n')
      .map(l => `<div class="ln ${lineCat(l)}">${ansiToHtml(l)}</div>`).join('');
    applyFilter();
    scrollConsole(true);
  } catch {}
}

/* ---------- 控制台 ---------- */
// 按内容给控制台行分类，用于过滤：主代理 / 事件 / 信箱
function lineCat(text) {
  const t = String(text);
  if (t.includes('[manager]') || t.includes('[用户')) return 'c-manager';
  if (t.includes('[事件]')) return 'c-event';
  if (t.includes('[信箱]')) return 'c-mail';
  return 'c-other';
}

function applyFilter() {
  const cls = { manager: 'c-manager', event: 'c-event', mail: 'c-mail' }[state.filter];
  for (const el of $('#console').children) {
    el.classList.toggle('hide', !!cls && !el.classList.contains(cls));
  }
}

document.querySelectorAll('.chip-f').forEach(b => b.onclick = () => {
  document.querySelectorAll('.chip-f').forEach(x => x.classList.toggle('active', x === b));
  state.filter = b.dataset.f;
  applyFilter();
});

function appendConsole(line) {
  const box = $('#console');
  if (box.querySelector('.empty')) box.innerHTML = '';
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const div = document.createElement('div');
  div.className = 'ln ' + lineCat(line);
  div.innerHTML = ansiToHtml(line);
  box.appendChild(div);
  if (state.filter !== 'all') div.classList.add('hide');
  while (box.childNodes.length > 6000) box.removeChild(box.firstChild);
  if (state.stick && !state.paused && atBottom) scrollConsole();
}
function scrollConsole(force) {
  const box = $('#console');
  if (force || state.stick) box.scrollTop = box.scrollHeight;
}
$('#btn-pause').onclick = e => {
  state.paused = !state.paused;
  e.target.textContent = state.paused ? '恢复滚动' : '暂停滚动';
};
$('#btn-clear').onclick = () => { $('#console').innerHTML = ''; };

/* ---------- 主代理状态条 / 插话 ---------- */
function renderAgentStrip(s) {
  state.agentStatus = s;
  const el = $('#agent-strip');
  if (state.currentRun?.status !== 'running' || !s) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const map = { starting: '启动中', online: '在线', restarting: '重启续命中', dead: '已停止' };
  const mainLabel = MAIN_LABELS[state.currentRun.settings?.main] || state.currentRun.settings?.main || 'Claude';
  el.innerHTML = `
    <span class="as-item"><b>主代理（${esc(mainLabel)}）</b> ${map[s.session] || esc(s.session)}</span>
    <span class="as-item">回合 ${s.turns ?? 0}</span>
    ${s.cost ? `<span class="as-item">花费 $${Number(s.cost).toFixed(4)}</span>` : ''}
    ${s.currentTool ? `<span class="as-item">⚙ ${esc(s.currentTool)}</span>` : ''}
    ${s.restarts ? `<span class="as-item dim2">续命 ${s.restarts} 次</span>` : ''}`;
}

function updateSayAccess() {
  const running = state.currentRun?.status === 'running';
  $('#say').disabled = !running;
  $('#btn-say').disabled = !running;
}

async function sendSay() {
  const inp = $('#say');
  const text = inp.value.trim();
  if (!text || !state.currentRun?.id || state.currentRun.status !== 'running') return;
  $('#btn-say').disabled = true;
  try {
    const r = await fetch(`/api/runs/${state.currentRun.id}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      appendConsole(`[发送失败] ${d.error || r.status}`);
    } else { inp.value = ''; }
  } catch (e) { appendConsole(`[发送失败] ${e.message}`); }
  updateSayAccess();
  inp.focus();
}
$('#btn-say').onclick = sendSay;
$('#say').addEventListener('keydown', e => { if (e.key === 'Enter') sendSay(); });

/* ---------- 任务板 / 信箱 ---------- */
function fmtDur(sec) {
  if (sec == null || isNaN(sec)) return '';
  return sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`;
}
function liveDur(started) {
  return Math.max(0, Math.round((Date.now() - new Date(started).getTime()) / 1000));
}
// 执行中任务的实时用时（每秒刷新，重渲染后由 data-started 重新接管）
setInterval(() => {
  document.querySelectorAll('[data-started]').forEach(el => { el.textContent = '⏱ ' + fmtDur(liveDur(el.dataset.started)); });
}, 1000);
function renderBoard(board) {
  const box = $('#board');
  const tasks = board?.tasks ?? [];
  const msgs = board?.messages ?? [];
  const done = tasks.filter(t => t.status === 'done').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  $('#task-summary').textContent = tasks.length ? `${done}/${tasks.length} 完成${failed ? ` · ${failed} 失败` : ''}` : '';
  $('#msg-count').textContent = msgs.length || '';

  // 运行总结横幅
  const fin = board?.finished;
  const fb = $('#finish-banner');
  if (fin) {
    fb.classList.remove('hidden');
    fb.innerHTML = `<div class="fb-title">🏁 manager 结束总结 <span>${esc((fin.at || '').slice(0, 19).replace('T', ' '))}</span></div><div class="fb-body">${esc(fin.summary || '(无)')}</div>`;
  } else {
    fb.classList.add('hidden');
  }

  const running = state.currentRun?.status === 'running';
  if (!tasks.length) { box.innerHTML = '<div class="empty">任务板上还没有任务</div>'; }
  else {
    box.innerHTML = tasks.map(t => {
      const logs = (state.currentRun?.logs || []).filter(l => l.name.startsWith(t.id + '-'));
      const threads = (state.threads || []).filter(x => x.name.startsWith(t.id + '-'));
      const dur = t.started_at && t.updated_at ? Math.round((new Date(t.updated_at) - new Date(t.started_at)) / 1000) : null;
      const actions = [];
      if (running && t.status === 'in_progress') actions.push(`<button data-cancel="${esc(t.id)}">✕ 取消</button>`);
      if (running && t.status === 'failed') actions.push(`<button data-retry="${esc(t.id)}">↻ 重试</button>`);
      return `
      <div class="task ${esc(t.status)}">
        <div class="t-head">
          <span class="badge ${esc(t.status)}">${{ pending: '待执行', in_progress: '执行中', done: '已完成', failed: '失败' }[t.status] || t.status}</span>
          <span class="t-id">${esc(t.id)}</span>
          <span class="t-title">${esc(t.title)}</span>
        </div>
        <div class="t-meta">
          <span class="chip">→ ${esc(t.assignee)}</span>
          ${(t.blocked_by || []).map(b => `<span class="chip blocked">依赖 ${esc(b)}</span>`).join('')}
          ${t.isolated ? '<span class="chip iso" title="该任务在独立 worktree 中执行，与其他任务的改动互不可见，完成后自动合并">🔒 隔离</span>' : ''}
          ${t.followup?.state === 'queued' ? '<span class="chip followup" title="主代理已请求该子代理在原任务上下文上继续">↻ 续派待执行</span>' : ''}
          ${t.followup?.state === 'rejected' ? `<span class="chip blocked" title="${esc(t.followup.reason || '续派被拒绝')}">↻ 续派被拒</span>` : ''}
          ${t.continuations ? `<span class="chip" title="主代理 followup_task 让该子代理继续了 ${t.continuations} 次">↻ 续派 ×${t.continuations}</span>` : ''}
          ${t.status === 'in_progress' && t.started_at
            ? `<span class="live-dur" data-started="${esc(t.started_at)}">⏱ ${fmtDur(liveDur(t.started_at))}</span>`
            : t.updated_at ? `<span>${esc(t.updated_at.slice(5, 19).replace('T', ' '))}${dur ? ` · 用时 ${fmtDur(dur)}` : ''}</span>` : ''}
        </div>
        ${t.spec ? `<div class="t-result">${esc(t.spec.length > 200 ? t.spec.slice(0, 200) + '…' : t.spec)}</div>` : ''}
        ${t.result ? `<div class="t-result clamp" id="res-${esc(t.id)}">${esc(t.result)}</div>` : ''}
        ${t.worktree ? `<div class="t-wt" title="${esc(t.worktree)}">📁 现场保留：${esc(t.branch)} · ${esc(t.worktree)}</div>` : ''}
        ${t.result || logs.length || threads.length || actions.length ? `<div class="t-link">${t.result ? `<button data-res="${esc(t.id)}">展开/收起结果</button>` : ''}${threads.map(x => ` <button data-thread="${esc(x.name)}">🧵 线程</button>`).join('')}${logs.map(l => ` <button data-log="${esc(l.name)}">日志 ${esc(l.name.replace('.log', ''))}</button>`).join('')}${actions.map(a => ` ${a}`).join('')}</div>` : ''}
      </div>`;
    }).join('');
    box.querySelectorAll('[data-res]').forEach(b => b.onclick = () =>
      document.getElementById('res-' + b.dataset.res)?.classList.toggle('clamp'));
    box.querySelectorAll('[data-log]').forEach(b => b.onclick = () => openLogModal({ log: b.dataset.log }));
    box.querySelectorAll('[data-thread]').forEach(b => b.onclick = () => openLogModal({ thread: b.dataset.thread }));
  }
  renderMailbox(msgs);
}

// 任务卡操作（取消/重试）走事件委托，重渲染后依然有效
$('#board').addEventListener('click', e => {
  const c = e.target.closest('[data-cancel]');
  if (c && state.currentRun?.id) {
    if (confirm(`确认取消任务 ${c.dataset.cancel}？现场会保留。`)) {
      fetch(`/api/runs/${state.currentRun.id}/task/${c.dataset.cancel}/cancel`, { method: 'POST' });
    }
    return;
  }
  const r = e.target.closest('[data-retry]');
  if (r && state.currentRun?.id) {
    fetch(`/api/runs/${state.currentRun.id}/task/${r.dataset.retry}/retry`, { method: 'POST' });
  }
});

function renderMailbox(msgs) {
  const box = $('#mailbox');
  if (!msgs.length) { box.innerHTML = '<div class="empty">暂无消息</div>'; return; }
  box.innerHTML = msgs.map(m => `
    <div class="msg">
      <div class="m-head">
        <span class="m-from">${esc(m.from)}</span><span>→</span>
        <span class="m-to">${esc(m.to)}</span>
        ${m.task_id ? `<span class="m-task">${esc(m.task_id)}</span>` : ''}
        ${m.read === false ? '<span class="tag failed">未读</span>' : ''}
        <span class="m-time">${esc((m.ts || '').slice(5, 19).replace('T', ' '))}</span>
      </div>
      <div class="m-body">${esc(m.content)}</div>
    </div>`).reverse().join('');
}

/* ---------- 会话线程 / 日志弹窗 ---------- */
function renderLogs(logs) {
  state.logFiles = logs || [];
}

function renderModalList() {
  const box = $('#log-list');
  const threads = state.threads || [];
  const logs = state.logFiles || [];
  let html = '';
  if (threads.length) {
    html += '<div class="list-sec">会话线程</div>' + threads.map(t =>
      `<div class="log-item ${state.modalThread === t.name ? 'active' : ''}" data-thread="${esc(t.name)}">🧵 ${esc(t.name.replace('.jsonl', ''))}<span class="dim">（${t.size}B）</span></div>`).join('');
  }
  if (logs.length) {
    html += '<div class="list-sec">原始日志</div>' + logs.map(l =>
      `<div class="log-item ${!state.modalThread && state.modalLog === l.name ? 'active' : ''}" data-f="${esc(l.name)}">${esc(l.name)} <span class="dim">(${l.size}B)</span></div>`).join('');
  }
  box.innerHTML = html || '<div class="log-item">无线程与日志</div>';
  box.querySelectorAll('.log-item[data-thread]').forEach(el => el.onclick = () => showThread(el.dataset.thread));
  box.querySelectorAll('.log-item[data-f]').forEach(el => el.onclick = () => showLog(el.dataset.f));
}

async function openLogModal(pick = {}) {
  $('#log-modal').classList.remove('hidden');
  renderModalList();
  if (pick.thread) await showThread(pick.thread);
  else if (pick.log) await showLog(pick.log);
}

async function showLog(name) {
  state.modalThread = null;
  state.modalLog = name;
  renderModalList();
  $('#log-title').textContent = '· ' + name;
  const content = $('#log-content');
  content.classList.remove('thread-view');
  try {
    const d = await (await fetch(`/api/runs/${state.currentRun.id}/log/${encodeURIComponent(name)}`)).json();
    content.textContent = d.text || '(空)';
  } catch (e) {
    content.textContent = '加载失败: ' + e.message;
  }
}

async function showThread(name) {
  state.modalThread = name;
  state.modalLog = null;
  state.threadPending = [];
  state.threadStick = true;
  renderModalList();
  $('#log-title').textContent = '· ' + name.replace('.jsonl', '');
  const content = $('#log-content');
  content.classList.add('thread-view');
  content.innerHTML = '<div class="empty dim">加载中…</div>';
  try {
    const d = await (await fetch(`/api/runs/${state.currentRun.id}/thread/${encodeURIComponent(name)}`)).json();
    content.innerHTML = '';
    for (const e of d.entries || []) appendThreadEntry(e);
    if (!(d.entries || []).length) content.innerHTML = '<div class="empty dim">这个线程还没有内容</div>';
    scrollThread(true);
  } catch (e) {
    content.classList.remove('thread-view');
    content.textContent = '加载失败: ' + e.message;
  }
}

/* ---------- 线程渲染（事件 → 节点投影） ---------- */
function toolSummary(input) {
  try {
    if (input == null) return '';
    if (typeof input === 'string') return input.slice(0, 90);
    if (input.command) return String(input.command).replace(/\s+/g, ' ').slice(0, 90);
    if (input.file_path) return String(input.file_path).slice(0, 90);
    if (input.title) return String(input.title).slice(0, 90);
    if (input.query) return String(input.query).slice(0, 90);
    const s = JSON.stringify(input);
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  } catch { return ''; }
}

function appendThreadEntry(e) {
  const box = $('#log-content');
  const el = document.createElement('div');
  const d = e.data || {};
  if (e.kind === 'system') {
    el.className = 'th-system';
    const via = d.via === 'append-system-prompt' ? '（--append-system-prompt · 随每次请求生效）'
      : d.via === 'first-message' ? '（已并入该会话第一条消息）' : '';
    el.innerHTML = `<details open><summary>📋 系统提示词${esc(via)}</summary><div class="th-body"><pre>${esc(String(d.text || ''))}</pre></div></details>`;
  } else if (e.kind === 'user') {
    el.className = 'th-user';
    el.innerHTML = `<div class="th-role">派发 / 注入</div><div class="th-body">${esc(String(d.text || ''))}</div>`;
  } else if (e.kind === 'assistant') {
    el.className = 'th-msg';
    el.innerHTML = `<div class="th-body">${esc(String(d.text || ''))}</div>`;
  } else if (e.kind === 'thought') {
    el.className = 'th-thought';
    el.innerHTML = `<details><summary>💭 思考</summary><div class="th-body">${esc(String(d.text || '').slice(0, 3000))}</div></details>`;
  } else if (e.kind === 'tool_use') {
    el.className = 'th-tool';
    el.dataset.tid = d.id || `seq-${e.seq}`;
    el.dataset.pending = '1';
    el.innerHTML = `<details open><summary>⚙ ${esc(d.name || 'tool')} <span class="th-sum">${esc(toolSummary(d.input))}</span><span class="th-run">⏳</span></summary><div class="th-body"><pre>${esc(JSON.stringify(d.input ?? d.raw ?? {}, null, 1).slice(0, 4000))}</pre><div class="th-result"></div></div></details>`;
    state.threadPending.push(el);
  } else if (e.kind === 'tool_result') {
    const tid = d.id || '';
    let idx = state.threadPending.findIndex(c => c.dataset.tid === tid);
    if (idx === -1) idx = 0;
    const card = state.threadPending.splice(idx, 1)[0];
    if (card) {
      delete card.dataset.pending;
      const run = card.querySelector('.th-run');
      if (run) { run.textContent = d.isError ? '✗' : '✓'; run.classList.add(d.isError ? 'err' : 'ok'); }
      const res = card.querySelector('.th-result');
      if (res) res.innerHTML = `<div class="th-role ${d.isError ? 'err' : ''}">${d.isError ? '结果（出错）' : '结果'}</div><pre>${esc(String(d.text || '').slice(0, 4000))}</pre>`;
      const det = card.querySelector('details');
      if (det && state.threadPending.length >= 0) det.open = false;
      return;
    }
    el.className = 'th-tool';
    el.innerHTML = `<details><summary>工具结果${d.isError ? '（出错）' : ''}</summary><div class="th-body"><pre>${esc(String(d.text || '').slice(0, 4000))}</pre></div></details>`;
  } else if (e.kind === 'result') {
    el.className = 'th-final ' + (d.isError ? 'err' : 'ok');
    el.innerHTML = `<div class="th-role">${d.isError ? '■ 会话失败' : '■ 会话完成'}${d.cost ? ` · 累计 $${Number(d.cost).toFixed(4)}` : ''}</div><div class="th-body">${esc(String(d.text || '').slice(0, 2000) || '(无文本)')}</div>`;
  } else {
    return;
  }
  box.appendChild(el);
  scrollThread();
}

function scrollThread(force) {
  const box = $('#log-content');
  if (!box.classList.contains('thread-view')) return;
  if (force || state.threadStick) box.scrollTop = box.scrollHeight;
}
$('#log-content')?.addEventListener('scroll', () => {
  const box = $('#log-content');
  state.threadStick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
});
$('#btn-close-modal').onclick = () => $('#log-modal').classList.add('hidden');
$('#log-modal').onclick = e => { if (e.target.id === 'log-modal') $('#log-modal').classList.add('hidden'); };

/* ---------- 启动 / 停止 ---------- */
$('#btn-start').onclick = async () => {
  $('#start-err').textContent = '';
  const goal = $('#f-goal').value.trim();
  if (!goal) { $('#start-err').textContent = '请填写总目标'; return; }
  const agents = [...document.querySelectorAll('#f-agents input:checked')].map(i => i.value);
  if (!agents.length) { $('#start-err').textContent = '至少选择一名执行成员'; return; }
  const btn = $('#btn-start');
  btn.disabled = true; btn.textContent = '启动中…';
  try {
    const r = await fetch('/api/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal,
        repo: $('#f-repo').value.trim() || undefined,
        agents,
        main: $('#f-main')?.value || 'claude',
        worktree: $('#f-mode')?.value === 'worktree'
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    await loadRuns();
    await openRun(d.id);
    await loadHealth();
  } catch (e) {
    $('#start-err').textContent = '启动失败: ' + e.message;
  } finally {
    btn.textContent = '▶ 启动运行';
    updateRunState();
  }
};

$('#btn-stop').onclick = async () => {
  if (state.currentRun?.status !== 'running') return;
  if (!confirm('确认停止当前运行？')) return;
  await fetch(`/api/runs/${state.currentRun.id}/stop`, { method: 'POST' });
  await new Promise(r => setTimeout(r, 800));
  await loadHealth(); await loadRuns();
};

$('#btn-refresh').onclick = loadRuns;
$('#btn-logs').onclick = () => { if (state.currentRun?.id) openLogModal(); };

/* ---------- 初始化 ---------- */
loadHealth();
loadRuns();
setInterval(loadHealth, 15000);

