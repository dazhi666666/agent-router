(() => {
  const api = window.AgentRouter;
  document.documentElement.lang = 'zh-CN';
  document.body.dataset.arShell = '';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const icon = d => `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    runs: icon('<path d="M10 5.5V10l3 2"/><circle cx="10" cy="10" r="7"/>'),
    board: icon('<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M7.5 3.5v13M12.5 3.5v13"/>'),
    settings: icon('<path d="M4 6h7M15 6h1M4 14h1M9 14h7"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="14" r="2"/>'),
    env: icon('<path d="M3.5 10.5l4 4 9-9"/>')
  };
  const bar = document.createElement('header'); bar.className = 'ar-ui ar-topbar';
  const MARK = '<span class="ar-mark" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="10" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7 9.2 13 6M7 10.8l6 3.2"/></svg></span>';
  bar.innerHTML = `<div class="ar-context"><strong id="ar-title"></strong><small id="ar-subtitle"></small></div>
    <nav class="ar-actions" aria-label="运行操作">
      <button data-panel="runs" title="运行记录">${ICONS.runs}<span class="label">运行记录</span></button>
      <button data-panel="board" title="任务与成员">${ICONS.board}<span class="label">任务</span></button>
      <button data-panel="settings" title="运行设置">${ICONS.settings}<span class="label">设置</span></button>
      <button data-panel="env" title="环境检查">${ICONS.env}<span class="label">环境</span></button>
    </nav>`;
  const panel = document.createElement('aside'); panel.className = 'ar-ui ar-panel'; panel.hidden = true; panel.setAttribute('aria-label', '运行详情');
  panel.innerHTML = '<div class="ar-panel-head"><div><h2 id="ar-panel-title"></h2><p id="ar-panel-subtitle"></p></div><button id="ar-close" aria-label="关闭面板">✕</button></div><div class="ar-panel-body"></div>';
  const toast = document.createElement('div'); toast.className = 'ar-ui ar-feedback'; toast.hidden = true; toast.setAttribute('role', 'status');
  document.body.append(bar, panel, toast);
  const $ = s => document.querySelector(s), pane = panel.querySelector('.ar-panel-body');
  let ctx = null, wantSettings = false, version = 0, controller, panelKind, opener, frame, toastTimer, events, eventsRun, refreshBusy = false, health = null;
  const notify = (text, error = false) => { toast.textContent = text; toast.classList.toggle('error', error); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 6500); };
  window.addEventListener('ar:notice', e => notify(e.detail.text, e.detail.error));

  const AGENTS = {
    claude: { name: 'Claude Code', color: '#d97757', install: 'npm i -g @anthropic-ai/claude-code', login: 'claude（首次运行按提示登录）', mode: '常驻会话，事件即时送达（推荐）' },
    zcode: { name: 'ZCode', color: '#3b82f6', install: 'npm i -g zcode-app-cli', login: '复用 ZCode 桌面端的 GLM 套餐凭据', mode: '回合串联，事件在回合之间送达' },
    devin: { name: 'Devin', color: '#10b981', install: '从 Devin 官网安装 Devin CLI', login: 'devin auth login', mode: '常驻 ACP 会话' },
    codex: { name: 'Codex', color: '#6b7280', install: 'npm i -g @openai/codex', login: 'codex login', mode: '回合串联，事件在回合之间送达' },
    opencode: { name: 'OpenCode', color: '#f59e0b', install: 'npm i -g opencode-ai@latest', login: 'opencode auth login', mode: '回合串联，事件在回合之间送达' },
    antigravity: { name: 'Antigravity', color: '#8b5cf6', install: '使用 Antigravity 官方安装器（命令 agy）', login: '复用 IDE 登录；需本地代理', mode: '常驻会话，事件即时送达' }
  };
  const KEYS = Object.keys(AGENTS);
  const llm = () => health?.llm || {};
  const agentName = a => AGENTS[a]?.name || llm()[a]?.label || a || 'Claude Code';
  const avatar = a => `<span class="ar-avatar" style="--c:${AGENTS[a]?.color || '#0ea5e9'}">${esc(agentName(a)[0].toUpperCase())}</span>`;
  const mainReady = a => AGENTS[a] ? !!health?.[a] : !!llm()[a]?.ready;
  const statusNames = { running: '运行中', finished: '已结束', failed: '异常退出', interrupted: '已中断' };
  const chatStatus = { running: '在线', finished: '休眠中', failed: '异常退出', interrupted: '已中断' };
  const statusLabel = r => (r?.mode === 'chat' ? chatStatus : statusNames)[r?.status] || r?.status || '';
  const loadHealth = async (force = false) => { if (!health || force) health = await api.request('/api/health'); return health; };

  function drawContext() {
    const run = ctx?.run, tasks = run?.board?.tasks || [];
    const who = ctx ? (ctx.thread === 'manager' ? `主代理 · ${agentName(ctx.settings?.main)}` : `${ctx.agent || '成员'} · ${ctx.thread}`) : '';
    $('#ar-title').innerHTML = ctx ? `${run ? `<span class="ar-status ${esc(run.status || '')}">${esc(statusLabel(run))}</span>` : ''}${esc(who)}` : '';
    $('#ar-subtitle').textContent = ctx ? `${ctx.settings?.repo || ''}${run ? ` · ${tasks.filter(t => t.status === 'done').length}/${tasks.length} 个任务完成` : ' · 发送第一条消息开始'}` : '';
    $('#ar-subtitle').title = $('#ar-subtitle').textContent;
    if (frame && panelKind === 'board') {
      const next = ctx?.runId ? `/board?embedded=1&runId=${encodeURIComponent(ctx.runId)}` : '/board?embedded=1';
      if (frame.getAttribute('src') !== next) frame.src = next;
    }
    document.body.dataset.arReadonly = ctx && !ctx.capabilities.send ? 'true' : 'false';
    rebrand();
  }
  function subscribe() {
    const id = ctx?.run?.status === 'running' ? ctx.runId : null;
    if (id === eventsRun) return;
    events?.close(); events = null; eventsRun = id;
    if (!id) return;
    events = new EventSource(`/api/events?runId=${encodeURIComponent(id)}`);
    events.onmessage = e => { const data = JSON.parse(e.data); if (data.runId !== ctx?.runId) return; if (data.type === 'snapshot') { ctx.run = data.run; drawContext(); } if (data.type === 'exit') refresh(); };
  }
  async function refresh(changed = false) {
    if (refreshBusy && !changed) return;
    const id = api.sessionId, token = ++version;
    controller?.abort(); controller = new AbortController(); refreshBusy = true;
    if (changed) { ctx = null; events?.close(); eventsRun = null; drawContext(); }
    try {
      ctx = id ? await api.request(`/api/sessions/${encodeURIComponent(id)}/context`, { signal: controller.signal }) : null;
      if (token !== version) return;
      drawContext(); subscribe();
      // 刚点了 dsh 的「新建会话」：自动打开运行设置，先选目录和成员
      if (wantSettings && ctx?.capabilities.configure && !ctx.run) { wantSettings = false; if (panelKind !== 'settings') { await show('settings'); return; } }
      if (changed && !panel.hidden && panelKind !== 'runs' && panelKind !== 'env') await renderPanel();
    } catch (e) { if (e.name !== 'AbortError' && token === version) { ctx = null; drawContext(); notify(e.message, true); } }
    finally { if (token === version) refreshBusy = false; }
  }
  function close() {
    panel.hidden = true; delete document.body.dataset.arPanel; panelKind = null; markActive();
    frame?.contentWindow.postMessage({ type: 'ar:visibility', visible: false }, location.origin); opener?.focus();
  }
  const markActive = () => bar.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === panelKind));
  async function show(kind) {
    if (panelKind === kind && !panel.hidden) return close();
    opener = document.activeElement; panelKind = kind; panel.hidden = false; document.body.dataset.arPanel = kind; markActive();
    await renderPanel();
  }
  const TITLES = {
    board: ['任务与成员', '当前会话所属运行，自动同步'],
    settings: ['运行设置', '工作目录、主代理与子代理'],
    runs: ['运行记录', '多个目录可以同时运行'],
    env: ['环境检查', 'Agent Router 调用本机已安装的各家 CLI']
  };
  async function renderPanel() {
    frame?.remove(); frame = null; pane.hidden = false; pane.innerHTML = '';
    const [title, sub] = TITLES[panelKind];
    $('#ar-panel-title').textContent = title; $('#ar-panel-subtitle').textContent = sub;
    if (panelKind === 'board') {
      pane.hidden = true; frame = document.createElement('iframe'); frame.title = '当前运行任务板';
      frame.src = ctx?.runId ? `/board?embedded=1&runId=${encodeURIComponent(ctx.runId)}` : '/board?embedded=1'; panel.append(frame); return;
    }
    if (panelKind === 'runs') return renderRuns();
    if (panelKind === 'env') return renderEnv();
    return renderSettings();
  }

  /* ---------- 运行记录 ---------- */
  async function renderRuns() {
    const list = await api.request('/api/runs'); if (panelKind !== 'runs') return;
    const day = ts => { const d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0); const diff = (t - new Date(d).setHours(0, 0, 0, 0)) / 864e5; return diff <= 0 ? '今天' : diff === 1 ? '昨天' : diff < 7 ? '本周' : '更早'; };
    let last = '';
    pane.innerHTML = list.length ? `<div class="ar-run-list">${list.map(r => {
      const g = day(r.mtime || Date.now());
      const head = g !== last ? `<div class="ar-run-group">${(last = g)}</div>` : '';
      return `${head}<button class="ar-run-card" data-run="${esc(r.id)}"><span class="ar-status ${esc(r.status)}">${esc(statusLabel(r))}</span><strong>${esc(r.goal || '未命名对话')}</strong><p>${esc([agentName(r.settings?.main), `${r.summary.done}/${r.summary.total} 个任务完成`, r.settings?.repo].filter(Boolean).join(' · '))}</p></button>`;
    }).join('')}</div>` : '<p class="ar-help">还没有运行。点右上角「新会话」，把目标发给主代理就开始了。</p>';
    pane.insertAdjacentHTML('beforeend', '<p class="ar-help" style="margin-top:18px">需要旧版控制台？<a href="/console/" style="color:var(--ar-accent)">打开经典控制台 ↗</a></p>');
    pane.querySelectorAll('[data-run]').forEach(b => b.onclick = async () => {
      try { const d = await api.request(`/api/runs/${b.dataset.run}`); api.open(d.managerSessionId); close(); } catch (e) { notify(e.message, true); }
    });
  }

  /* ---------- 环境检查 ---------- */
  async function renderEnv(force = false) {
    pane.innerHTML = '<p class="ar-help">检测中…</p>';
    const h = await loadHealth(force); if (panelKind !== 'env') return;
    const rows = KEYS.map(k => `<div class="ar-row" style="cursor:default;align-items:flex-start">${avatar(k)}<span class="ar-row-text">
      <span class="ar-row-main">${AGENTS[k].name}<span class="ar-badge ${h[k] ? 'ok' : 'bad'}">${h[k] ? '已找到' : '未找到'}</span></span>
      <span class="ar-row-sub">${h[k] ? `默认模型：${esc(h.models?.[k] || '客户端默认')}` : `安装：<code>${esc(AGENTS[k].install)}</code>`}</span>
      <span class="ar-row-sub">登录：${esc(AGENTS[k].login)}</span>
      ${h.paths?.[k] ? `<span class="ar-mono" title="${esc(h.paths[k])}">${esc(h.paths[k])}</span>` : ''}</span></div>`).join('');
    const chats = Object.entries(h.llm || {}).map(([k, v]) => `<div class="ar-row" style="cursor:default;align-items:flex-start">${avatar(k)}<span class="ar-row-text">
      <span class="ar-row-main">${esc(v.label)}<span class="ar-badge ${v.ready ? 'ok' : 'bad'}">${v.ready ? '已配置' : '缺少密钥'}</span></span>
      <span class="ar-row-sub">对话模型 · ${esc(v.model || '')}${h.consult === k ? ' · 提供 consult 顾问工具' : ''}</span>
      ${v.ready ? '' : `<span class="ar-row-sub">设置环境变量 <code>${esc(v.apiKeyEnv || 'apiKey')}</code> 后重启服务</span>`}</span></div>`).join('');
    pane.innerHTML = `<section class="ar-section"><h3>编程代理（可当主代理或子代理）</h3><div class="ar-card">${rows}</div></section>
      ${chats ? `<section class="ar-section"><h3>对话模型（只能当主代理）</h3><div class="ar-card">${chats}</div></section>` : ''}
      <p class="ar-note">只检测了可执行文件是否存在，未验证登录状态。装在非默认位置时，在项目根目录的 <code>router.config.json</code> 里指定 <code>exe</code> 路径；需要代理的网络可以设置 <code>proxy</code>。</p>
      <div class="ar-footer"><button class="outline" id="ar-recheck">重新检测</button></div>`;
    $('#ar-recheck').onclick = () => renderEnv(true);
  }

  /* ---------- 运行设置 ---------- */
  function mainRows(current, chats) {
    const row = (a, sub) => {
      const ok = mainReady(a);
      return `<button type="button" class="ar-row${a === current ? ' on' : ''}" data-main="${esc(a)}" ${ok ? '' : 'disabled'}>${avatar(a)}<span class="ar-row-text"><span class="ar-row-main">${esc(agentName(a))}</span><span class="ar-row-sub">${esc(sub(ok))}</span></span>${a === current ? '<span class="ar-check">✓</span>' : ''}</button>`;
    };
    return `<div class="ar-card">${KEYS.map(a => row(a, ok => ok ? AGENTS[a].mode : '未安装 · 见环境检查')).join('')}</div>
      ${chats.length ? `<p class="ar-help" style="margin:12px 0 6px">对话模型：只规划、派活和审阅，改代码全部交给子代理</p><div class="ar-card">${chats.map(a => row(a, ok => ok ? llm()[a].model || '' : `未配置 API Key${llm()[a].apiKeyEnv ? `（${llm()[a].apiKeyEnv}）` : ''}`)).join('')}</div>` : ''}`;
  }
  function modelField(k, catalog, current) {
    const c = catalog[k] || {}, val = current[k] || '', def = c.default ? `默认（${c.default}）` : '客户端默认';
    if (c.options?.length && !c.custom) {
      const labels = c.labels || {}, efforts = c.efforts || {};
      const opts = c.options.flatMap(o => [o, ...(efforts[o] || []).map(e => `${o}@${e}`)]);
      const label = o => { const [m, e] = o.split('@'); return labels[m] ? `${labels[m]}${e ? ' · ' + e : ''}` : o; };
      if (opts.length > 60) return `<input list="ar-dl-${k}" data-model="${k}" value="${esc(val)}" placeholder="${esc(def)}（可输入筛选）"><datalist id="ar-dl-${k}">${opts.map(o => `<option value="${esc(o)}">${esc(labels[o.split('@')[0]] || '')}</option>`).join('')}</datalist>`;
      return `<select data-model="${k}"><option value="">${esc(def)}</option>${opts.map(o => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(label(o))}</option>`).join('')}</select>`;
    }
    return `<input data-model="${k}" value="${esc(val)}" placeholder="${esc(def)}">`;
  }
  const readModels = () => Object.fromEntries([...pane.querySelectorAll('[data-model]')].map(el => [el.dataset.model, el.value.trim()]));

  async function renderSettings() {
    if (!ctx) { pane.innerHTML = '<p class="ar-help">先新建或选择一个会话。</p><div class="ar-footer"><button class="primary" id="ar-create-settings">新会话</button></div>'; $('#ar-create-settings').onclick = createSession; return; }
    const saved = ctx;
    const [catalog] = await Promise.all([api.request('/api/models'), loadHealth()]);
    if (saved.sessionId !== ctx?.sessionId || panelKind !== 'settings') return;
    const s = { main: 'claude', agents: [], timeout: 900, worktree: false, models: {}, ...ctx.settings };
    const chats = Object.keys(llm());
    return ctx.capabilities.configure ? renderDraft(s, catalog, chats) : renderLocked(s, catalog, chats);
  }

  // 运行开始前：所有改动即时保存到会话，发送第一条消息时生效
  function renderDraft(s, catalog, chats) {
    const saved = ctx;
    pane.innerHTML = `
      <section class="ar-section"><h3>工作目录</h3>
        <div class="ar-inline"><input id="ar-repo" value="${esc(s.repo || '')}" placeholder="粘贴文件夹路径，如 D:\\code\\my-app"><button type="button" class="outline" id="ar-browse">浏览…</button></div>
        <div id="ar-browser"></div>
      </section>
      <section class="ar-section"><h3>主代理 <span style="font-weight:400">· 和你对话，决定自己做还是派给子代理</span></h3>${mainRows(s.main, chats)}</section>
      <section class="ar-section"><h3>子代理 <span style="font-weight:400">· 主代理可以把任务派给它们并行执行</span></h3>
        <div class="ar-card">${KEYS.map(a => `<label class="ar-row${health[a] ? '' : ' disabled'}"><input type="checkbox" name="agents" value="${a}" ${s.agents.includes(a) ? 'checked' : ''} ${health[a] ? '' : 'disabled'}>${avatar(a)}<span class="ar-row-text"><span class="ar-row-main">${AGENTS[a].name}</span><span class="ar-row-sub">${health[a] ? esc(s.models?.[a] || health.models?.[a] || '客户端默认') : '未安装 · 见环境检查'}</span></span></label>`).join('')}</div>
      </section>
      <section class="ar-section"><h3>执行方式</h3>
        <div class="ar-seg"><button type="button" data-wt="false" class="${s.worktree ? '' : 'on'}">直通模式<small>子代理直接在工作目录里并行修改，最快</small></button><button type="button" data-wt="true" class="${s.worktree ? 'on' : ''}">隔离模式<small>每个任务一个 git worktree，完成后合并</small></button></div>
      </section>
      <section class="ar-section"><h3>子代理超时</h3><div class="ar-range"><input type="range" id="ar-timeout" min="60" max="3600" step="60" value="${s.timeout}"><span id="ar-timeout-v">${Math.round(s.timeout / 60)} 分钟</span></div></section>
      <section class="ar-section"><h3>模型 <span style="font-weight:400">· 留空使用各 CLI 的默认模型</span></h3>
        <div class="ar-card">${KEYS.map(k => `<label class="ar-row" style="cursor:default">${avatar(k)}<span class="ar-row-text"><span class="ar-row-main">${AGENTS[k].name}</span></span>${modelField(k, catalog, s.models || {})}</label>`).join('')}</div>
      </section>
      <p id="ar-form-error" class="ar-error" role="alert"></p>
      <p class="ar-note">设置会自动保存。在对话框里发送第一条消息，主代理就会开始工作。</p>`;
    const save = async patch => {
      Object.assign(s, patch); $('#ar-form-error').textContent = '';
      try { await api.request(`/api/sessions/${encodeURIComponent(saved.sessionId)}/settings`, { method: 'PATCH', body: JSON.stringify({ repo: s.repo, agents: s.agents, main: s.main, worktree: s.worktree, timeout: s.timeout, models: s.models }) }); await refresh(); }
      catch (err) { $('#ar-form-error').textContent = err.message; }
    };
    const repo = $('#ar-repo');
    repo.onchange = () => save({ repo: repo.value.trim() });
    repo.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); repo.blur(); } };
    const browse = async dir => {
      const box = $('#ar-browser');
      try {
        const d = await api.request('/api/fs/dirs' + (dir ? `?path=${encodeURIComponent(dir)}` : ''));
        const join = n => d.path.replace(/[\\/]$/, '') + (d.path.includes('\\') ? '\\' : '/') + n;
        box.innerHTML = `<div class="ar-card" style="margin-top:8px">
          <div class="ar-row" style="cursor:default;gap:6px">${d.parent ? `<button type="button" class="outline" data-dir="${esc(d.parent)}" title="上一级">↑</button>` : ''}<span class="ar-mono" style="flex:1" title="${esc(d.path)}">${esc(d.path)}</span><button type="button" class="primary" data-pick="${esc(d.path)}">选择</button></div>
          <div class="ar-row" style="cursor:default;gap:4px;flex-wrap:wrap">${[d.home, ...d.roots].map(p => `<button type="button" class="outline" data-dir="${esc(p)}" style="padding:2px 8px;font-size:12px">${p === d.home ? '主目录' : esc(p)}</button>`).join('')}</div>
          <div style="max-height:220px;overflow:auto">${d.dirs.map(n => `<button type="button" class="ar-row" data-dir="${esc(join(n))}">📁 ${esc(n)}</button>`).join('') || '<p class="ar-help" style="padding:0 12px 10px">没有子目录</p>'}</div></div>`;
      } catch (err) { box.innerHTML = `<p class="ar-error">${esc(err.message)}</p>`; }
    };
    $('#ar-browse').onclick = () => $('#ar-browser').innerHTML ? ($('#ar-browser').innerHTML = '') : browse(repo.value.trim());
    $('#ar-browser').onclick = e => {
      const b = e.target.closest('[data-dir],[data-pick]'); if (!b) return;
      if (b.dataset.pick) { repo.value = b.dataset.pick; $('#ar-browser').innerHTML = ''; save({ repo: b.dataset.pick }); }
      else browse(b.dataset.dir);
    };
    pane.querySelectorAll('[data-main]').forEach(b => b.onclick = async () => { await save({ main: b.dataset.main }); renderSettings(); });
    pane.querySelectorAll('[name=agents]').forEach(i => i.onchange = () => {
      const agents = [...pane.querySelectorAll('[name=agents]:checked')].map(x => x.value);
      if (!agents.length) { i.checked = true; return notify('至少需要一个子代理'); }
      save({ agents });
    });
    pane.querySelectorAll('[data-wt]').forEach(b => b.onclick = () => { pane.querySelectorAll('[data-wt]').forEach(x => x.classList.toggle('on', x === b)); save({ worktree: b.dataset.wt === 'true' }); });
    const t = $('#ar-timeout');
    t.oninput = () => $('#ar-timeout-v').textContent = `${Math.round(t.value / 60)} 分钟`;
    t.onchange = () => save({ timeout: Number(t.value) });
    pane.querySelectorAll('[data-model]').forEach(el => el.onchange = () => save({ models: readModels() }));
  }

  // 运行开始后：目录和成员锁定；主代理可以切换（接手之前的对话），模型可以改
  function renderLocked(s, catalog, chats) {
    const saved = ctx, running = saved.run?.status === 'running';
    pane.innerHTML = `
      <section class="ar-section"><h3>主代理 <span style="font-weight:400">· ${running ? '当前回合结束后切换，子代理任务不受影响' : '下一条消息起由新主代理接手'}</span></h3>${mainRows(s.main, chats)}</section>
      <section class="ar-section"><h3>本次运行</h3><div class="ar-card">
        <div class="ar-row" style="cursor:default"><span class="ar-row-text"><span class="ar-row-sub">工作目录</span><span class="ar-row-main" style="font-weight:400;overflow-wrap:anywhere">${esc(s.repo || '')}</span></span></div>
        <div class="ar-row" style="cursor:default"><span class="ar-row-text"><span class="ar-row-sub">子代理</span><span class="ar-row-main" style="font-weight:400">${esc(s.agents.map(agentName).join('、'))}</span></span></div>
        <div class="ar-row" style="cursor:default"><span class="ar-row-text"><span class="ar-row-sub">执行方式</span><span class="ar-row-main" style="font-weight:400">${s.worktree ? '隔离模式（git worktree）' : '直通模式'} · 超时 ${Math.round(s.timeout / 60)} 分钟</span></span></div>
      </div><p class="ar-help">目录和成员在运行开始后锁定；要换就新建一个会话。</p></section>
      <section class="ar-section"><h3>模型 <span style="font-weight:400">· 主代理在本回合结束后切换，子代理在下一个任务开始时生效</span></h3>
        <div class="ar-card">${KEYS.map(k => `<label class="ar-row" style="cursor:default">${avatar(k)}<span class="ar-row-text"><span class="ar-row-main">${AGENTS[k].name}</span></span>${modelField(k, catalog, s.models || {})}</label>`).join('')}</div>
      </section>
      <p id="ar-form-error" class="ar-error" role="alert"></p>
      <div class="ar-footer">${saved.thread !== 'manager' ? '<button type="button" class="outline" id="ar-back-manager">返回主代理</button>' : ''}${saved.capabilities.stop ? '<button type="button" class="danger" id="ar-stop">停止运行</button>' : ''}<span class="grow"></span><button type="button" class="primary" id="ar-save-models" ${saved.capabilities.models ? '' : 'disabled'}>保存模型</button></div>`;
    pane.querySelectorAll('[data-main]').forEach(b => b.onclick = async () => {
      if (b.dataset.main === s.main) return;
      try {
        const res = await api.request(`/api/runs/${encodeURIComponent(saved.runId)}/main`, { method: 'PATCH', body: JSON.stringify({ main: b.dataset.main }) });
        notify(res.applied === 'after_turn' ? `将在当前回合结束后切换为 ${agentName(b.dataset.main)}，它会接手之前的对话` : `已切换为 ${agentName(b.dataset.main)}，发送消息后由它接手之前的对话`);
        await refresh(); renderSettings();
      } catch (err) { notify(err.message, true); }
    });
    $('#ar-save-models').onclick = async e => {
      e.target.disabled = true; $('#ar-form-error').textContent = '';
      try { const r = await api.request(`/api/runs/${saved.runId}/models`, { method: 'PATCH', body: JSON.stringify({ models: readModels() }) }); notify(r.message || '已保存'); await refresh(); }
      catch (err) { $('#ar-form-error').textContent = err.message; } finally { e.target.disabled = false; }
    };
    if ($('#ar-back-manager')) $('#ar-back-manager').onclick = () => { api.open(saved.managerSessionId); close(); };
    if ($('#ar-stop')) $('#ar-stop').onclick = async e => {
      if (!confirm('停止此运行？其他并发运行不受影响。')) return;
      e.target.disabled = true;
      try { await api.request(`/api/runs/${saved.runId}/stop`, { method: 'POST' }); notify('已请求停止'); await refresh(); } catch (err) { notify(err.message, true); e.target.disabled = false; }
    };
  }

  async function createSession() { try {
    if (api.newSession) await api.newSession();
    else {
      const created = await api.request('/dsh-api/session/create', { method: 'POST', body: JSON.stringify({}) });
      if (!created.ok) throw new Error(created.error?.message || '无法创建会话');
      api.select(created.value.sessionId);
      const original = [...document.querySelectorAll('#root button')].find(b => /新建会话/.test(b.textContent || b.getAttribute('aria-label') || ''));
      original?.click();
    }
    await refresh(true); panelKind = null; await show('settings');
  } catch (e) { notify(e.message, true); } }
  $('#ar-close').onclick = close;
  document.addEventListener('click', e => { if (e.target.closest?.('#root [aria-label="新建会话"]')) wantSettings = true; }, true);
  bar.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => show(b.dataset.panel).catch(e => notify(e.message, true)));
  window.addEventListener('ar:session', () => refresh(true)); window.addEventListener('ar:refresh', () => refresh());
  window.addEventListener('message', e => { if (e.origin !== location.origin || e.source !== frame?.contentWindow) return; if (e.data?.type === 'ar:close') close(); });
  document.addEventListener('keydown', e => {
    if (panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  const hideLabels = ['好的回答','有问题的回答','在新对话中分支','添加工作区','添加文件或调用指令','反馈','正在加载模型'];
  const hideExact = ['插件', '自动化任务'];
  // dsh 侧栏的品牌区换成 Agent Router
  const rebrand = () => {
    const mark = document.querySelector('#root [data-slot="sidebar.brand.mark"]');
    if (mark && !mark.querySelector('.ar-mark')) mark.innerHTML = MARK;
    for (const el of document.querySelectorAll('#root [class*="_localBuildTitle"]')) if (el.textContent !== 'Agent Router') el.textContent = 'Agent Router';
    for (const el of document.querySelectorAll('#root [class*="_localBuildBrand"] > :not([class*="_localBuildTitle"])')) el.dataset.arHidden = '';
    if (document.title.includes('DSH 本地构建')) document.title = document.title === 'DSH 本地构建' ? 'Agent Router' : document.title.replace(/\s*—\s*DSH 本地构建/, ' — Agent Router');
    // 空会话的欢迎区：换标题，去掉 dsh 的标志；工作区按钮改成显示工作目录，点击打开运行设置
    const fish = document.querySelector('#root [data-slot="conversation.hero.brand.mark"]');
    if (fish?.parentElement && !fish.parentElement.dataset.arHidden) fish.parentElement.dataset.arHidden = '';
    const title = document.querySelector('#root [class*="_titleGroup"]');
    if (title) {
      title.closest('[class*="_headline"]')?.setAttribute('data-ar-hero', '');
      const [text, ...rest] = title.children;
      if (text && text.textContent !== '有什么可以帮你？') text.textContent = '有什么可以帮你？';
      for (const el of rest) if (!el.dataset.arHidden) el.dataset.arHidden = '';
    }
    const chip = document.querySelector('#root [class*="_heroWorkspaceRow"] [aria-label="选择工作区"]');
    const label = chip?.querySelector('[class*="_workspaceLabel"]');
    if (label) {
      const repo = ctx?.settings?.repo || '', name = repo ? repo.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '选择工作目录';
      if (label.textContent !== name) label.textContent = name;
      if (chip.title !== repo) chip.title = repo;
      chip.dataset.arChip = '';
    }
  };
  document.addEventListener('click', e => {
    if (!e.target.closest?.('[data-ar-chip]')) return;
    e.preventDefault(); e.stopPropagation();
    if (panelKind !== 'settings') show('settings').catch(err => notify(err.message, true));
  }, true);
  // Router 注入的 [事件] / [信箱] 在 dsh 里是用户消息：改成左对齐的提示条，长内容折叠，点击展开
  const markNotices = () => {
    for (const item of document.querySelectorAll('#root [data-chat-flow-kind="user"]')) {
      const bubble = item.querySelector('[class*="_bubble"]');
      // 虚拟列表会复用节点：按节点 key 判断是否已检查
      if (!bubble || item.dataset.arChecked === item.dataset.chatNodeKey) continue;
      item.dataset.arChecked = item.dataset.chatNodeKey || '';
      const tag = (bubble.textContent || '').match(/^\s*\[(事件|信箱)\]/)?.[1];
      if (tag) item.dataset.arNotice = tag; else delete item.dataset.arNotice;
    }
  };
  document.addEventListener('click', e => {
    const bubble = e.target.closest?.('[data-ar-notice] [class*="_bubble"]');
    if (bubble && !getSelection()?.toString()) bubble.toggleAttribute('data-ar-open');
  });
  const sweep = () => {
    rebrand(); markNotices();
    for (const el of document.querySelectorAll('#root button,#root [role="menuitem"]')) {
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      if (hideLabels.some(t => label.includes(t)) || hideExact.includes(label)) el.dataset.arHidden = '';
    }
  };
  let scheduled = false;
  const mo = new MutationObserver(() => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; sweep(); }); });
  mo.observe($('#root'), { childList:true, subtree:true });
  // rAF 在标签页被节流/不可见时不会触发,定时兜底保证裁剪始终生效
  sweep();
  setInterval(sweep, 1500);
  setInterval(() => { if (!document.hidden) refresh(); }, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  loadHealth().then(drawContext).catch(() => {});
  refresh();
})();
