(() => {
  const api = window.AgentRouter;
  document.documentElement.lang = 'zh-CN';
  document.body.removeAttribute('data-ds-dark-theme');
  document.documentElement.dataset.dsThemeSource = 'light';
  document.body.dataset.arShell = '';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const bar = document.createElement('header'); bar.className = 'ar-ui ar-topbar';
  bar.innerHTML = `<div class="ar-brand"><span class="ar-mark" aria-hidden="true">⧉</span><div><strong>Agent Router</strong><div class="ar-eyebrow">LOCAL COLLABORATION</div></div></div><div class="ar-context"><strong id="ar-title">协作从一个目标开始</strong><small id="ar-subtitle">新建会话，配置工作目录，再发送目标</small></div><nav class="ar-actions" aria-label="运行操作"><button id="ar-new" class="primary">＋ 新会话</button><button data-panel="runs">运行记录</button><button data-panel="settings">运行设置</button><button data-panel="board">任务板</button><a class="ar-button ar-console" href="/console/">控制台 ↗</a></nav>`;
  const panel = document.createElement('aside'); panel.className = 'ar-ui ar-panel'; panel.hidden = true; panel.setAttribute('aria-label', '运行详情');
  panel.innerHTML = '<div class="ar-panel-head"><div><h2 id="ar-panel-title"></h2><p id="ar-panel-subtitle"></p></div><button id="ar-close" aria-label="关闭面板">✕</button></div><div class="ar-panel-body"></div>';
  const toast = document.createElement('div'); toast.className = 'ar-ui ar-feedback'; toast.hidden = true; toast.setAttribute('role', 'status');
  document.body.append(bar, panel, toast);
  const $ = s => document.querySelector(s), pane = panel.querySelector('.ar-panel-body');
  let ctx = null, version = 0, controller, panelKind, opener, frame, contextTimer, toastTimer, events, eventsRun, refreshBusy = false;
  const notify = (text, error = false) => { toast.textContent = text; toast.classList.toggle('error', error); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 6500); };
  window.addEventListener('ar:notice', e => notify(e.detail.text, e.detail.error));
  const statusNames = { running: '运行中', finished: '已结束', failed: '失败', interrupted: '已中断' };
  const AGENT_KEYS = ['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity'];
  const MAIN_LABELS = { claude: 'Claude', zcode: 'ZCode', devin: 'Devin', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity' };
  const mainName = s => MAIN_LABELS[s?.main] || s?.main || 'Claude';
  function drawContext() {
    const run = ctx?.run, tasks = run?.board?.tasks || [];
    $('#ar-title').innerHTML = ctx ? `<span class="ar-status ${esc(run?.status || '')}">${statusNames[run?.status] || '待启动'}</span>${esc(ctx.thread === 'manager' ? `主代理 · ${mainName(ctx.settings)}` : `${ctx.agent || '成员'} · ${ctx.thread}`)}` : '协作从一个目标开始';
    $('#ar-subtitle').textContent = ctx ? `${ctx.settings?.repo || '工作目录未记录'}${run ? ` · ${tasks.filter(t => t.status === 'done').length}/${tasks.length} 任务完成` : ' · 首条消息将启动运行'}` : '新建会话，配置工作目录，再发送目标';
    $('#ar-subtitle').title = $('#ar-subtitle').textContent;
    if (frame && panelKind === 'board') {
      const next = ctx?.runId ? `/board?embedded=1&runId=${encodeURIComponent(ctx.runId)}` : '/board?embedded=1';
      if (frame.getAttribute('src') !== next) frame.src = next;
    }
    // Only project-owned controls are hidden; the chat rendering remains dsh-owned.
    document.body.dataset.arReadonly = ctx && !ctx.capabilities.send ? 'true' : 'false';
  }
  function subscribe() {
    const id = ctx?.run?.status === 'running' ? ctx.runId : null;
    if (id === eventsRun) return;
    events?.close(); events = null; eventsRun = id;
    if (!id) return;
    events = new EventSource(`/api/events?runId=${encodeURIComponent(id)}`);
    events.onmessage = e => { const data = JSON.parse(e.data); if (data.runId !== ctx?.runId) return; if (data.type === 'snapshot') { ctx.run = data.run; drawContext(); } if (data.type === 'exit') refresh(); };
    events.onerror = () => { $('#ar-subtitle').textContent = '连接恢复中 · 自动重连并定期刷新'; };
  }
  async function refresh(changed = false) {
    if (refreshBusy && !changed) return;
    const id = api.sessionId, token = ++version;
    controller?.abort(); controller = new AbortController(); refreshBusy = true;
    if (changed) { ctx = null; events?.close(); eventsRun = null; drawContext(); if (!panel.hidden) { frame?.remove(); frame = null; pane.textContent = '正在加载会话…'; } }
    try {
      ctx = id ? await api.request(`/api/sessions/${encodeURIComponent(id)}/context`, { signal: controller.signal }) : null;
      if (token !== version) return;
      drawContext(); subscribe();
      if (changed && !panel.hidden) await renderPanel();
    } catch (e) { if (e.name !== 'AbortError' && token === version) { ctx = null; drawContext(); notify(e.message, true); } }
    finally { if (token === version) refreshBusy = false; }
  }
  function close() { panel.hidden = true; delete document.body.dataset.arPanel; frame?.contentWindow.postMessage({ type: 'ar:visibility', visible: false }, location.origin); opener?.focus(); }
  async function show(kind) {
    opener = document.activeElement; panelKind = kind; panel.hidden = false; document.body.dataset.arPanel = kind;
    await renderPanel(); $('#ar-close').focus();
  }
  async function renderPanel() {
    frame?.remove(); frame = null; pane.hidden = false; pane.innerHTML = '';
    const titles = { board: ['任务与成员', '当前会话所属运行 · 自动同步'], settings: ['运行设置', '配置工作目录、成员与模型'], runs: ['运行记录', '多个独立目录可同时运行'] };
    $('#ar-panel-title').textContent = titles[panelKind][0]; $('#ar-panel-subtitle').textContent = titles[panelKind][1];
    if (panelKind === 'board') {
      pane.hidden = true; frame = document.createElement('iframe'); frame.title = '当前运行任务板';
      frame.src = ctx?.runId ? `/board?embedded=1&runId=${encodeURIComponent(ctx.runId)}` : '/board?embedded=1'; panel.append(frame); return;
    }
    if (panelKind === 'runs') {
      const list = await api.request('/api/runs'); if (panelKind !== 'runs') return;
      pane.innerHTML = `<div class="ar-run-list">${list.map(r => `<article class="ar-run-card"><span class="ar-status ${esc(r.status)}">${statusNames[r.status] || r.status}</span><strong>${esc(r.goal || '历史运行')}</strong><p>${esc(r.settings?.repo || '工作目录未记录')}</p><p>${esc(r.id)} · 主代理 ${esc(mainName(r.settings))} · ${r.summary.done}/${r.summary.total} 完成</p><button data-run="${esc(r.id)}">打开主代理 →</button></article>`).join('') || '<p class="ar-help">还没有运行。创建会话，发送你的第一个目标。</p>'}</div>`;
      pane.querySelectorAll('[data-run]').forEach(button => button.onclick = async () => { try { const d = await api.request(`/api/runs/${button.dataset.run}`); api.open(d.managerSessionId); close(); } catch (e) { notify(e.message, true); } }); return;
    }
    if (!ctx) { pane.innerHTML = '<p class="ar-help">先新建或选择一个会话，再设置工作目录与成员。</p><button class="primary" id="ar-create-settings">新建会话</button>'; $('#ar-create-settings').onclick = createSession; return; }
    const savedCtx = ctx;
    const [catalog, health] = await Promise.all([api.request('/api/models'), api.request('/api/health')]);
    if (savedCtx.sessionId !== ctx?.sessionId || panelKind !== 'settings') return;
    const s = ctx.settings || {}, locked = !ctx.capabilities.configure;
    pane.innerHTML = `<form id="ar-settings"><fieldset ${locked ? 'disabled' : ''}><label class="ar-field"><span>工作目录</span><input name="repo" required value="${esc(s.repo || '')}" placeholder="输入本机目录的完整路径"></label><label class="ar-field"><span>主代理</span><select name="main">${AGENT_KEYS.map(a => `<option value="${a}" ${(s.main || 'claude') === a ? 'selected' : ''}>${a} · ${MAIN_LABELS[a]}${a === 'claude' ? '（推荐）' : ''}</option>`).join('')}</select><p class="ar-help">主代理常驻主线程负责拆解与派发：claude/antigravity 为 stream-json 常驻（事件即时注入）；devin 为 ACP 常驻（需已登录）；zcode/codex/opencode 为回合串联，事件在回合间注入。</p></label><div class="ar-field"><span>执行成员</span><div class="ar-checks">${AGENT_KEYS.map(a => `<label><input type="checkbox" name="agents" value="${a}" ${(s.agents || []).includes(a) ? 'checked' : ''}>${a}</label>`).join('')}</div><p class="ar-help">${AGENT_KEYS.map(a => `${a}：${health[a] ? 'CLI 已找到' : 'CLI 未找到'}`).join(' · ')}<br>路径检测不代表已登录。</p></div><label class="ar-field"><span>执行模式</span><select name="worktree"><option value="false">共享目录 · 直接修改工作区</option><option value="true" ${s.worktree ? 'selected' : ''}>worktree · 按任务隔离</option></select></label><label class="ar-field"><span>子代理超时（秒）</span><input name="timeout" type="number" min="60" max="3600" value="${s.timeout || 900}"></label></fieldset><hr class="ar-divider"><strong>模型选择</strong><p class="ar-help">主代理与各成员的模型分别生效：主代理按其所属 CLI 的配置，成员留空继承客户端配置。antigravity 可填 agy models 里的模型名（gemini-3.8-flash-high 等档位后缀会转为思考档位）。</p><fieldset ${locked && !ctx.capabilities.models ? 'disabled' : ''}>${AGENT_KEYS.map(a => `<label class="ar-field"><span>${a}</span>${a === 'zcode' ? `<select name="model-${a}"><option value="">默认 · ${esc(catalog[a].default || '客户端默认')}</option>${catalog[a].options.map(m => `<option value="${esc(m)}" ${s.models?.[a] === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : `<input name="model-${a}" value="${esc(s.models?.[a] || '')}" placeholder="${esc(catalog[a].default || '客户端默认')}" maxlength="250">`}</label>`).join('')}</fieldset><p class="ar-note">${locked ? '运行目录和成员已锁定。模型变更：主代理在当前回合结束后切换，子代理在下一次会话启动时生效。' : '保存不会启动运行。配置完成后，在聊天中发送第一条目标即可启动。'}</p><p id="ar-form-error" class="ar-error" role="alert"></p><button class="primary" type="submit" ${locked && !ctx.capabilities.models ? 'disabled' : ''}>${locked ? '切换模型' : '保存运行设置'}</button></form>${ctx.thread !== 'manager' ? '<hr class="ar-divider"><button id="ar-back-manager">返回主代理</button><p class="ar-help">子代理消息直接写入信箱，读取时机由子代理决定。</p>' : ''}${ctx.capabilities.stop ? '<hr class="ar-divider"><button class="danger" id="ar-stop">停止此运行</button>' : ''}`;
    $('#ar-settings').onsubmit = async e => {
      e.preventDefault(); const form = e.currentTarget, button = form.querySelector('[type=submit]'), fields = new FormData(form), models = Object.fromEntries(AGENT_KEYS.map(a => [a, fields.get('model-' + a) || '']));
      button.disabled = true; $('#ar-form-error').textContent = '';
      try {
        const result = locked ? await api.request(`/api/runs/${savedCtx.runId}/models`, { method: 'PATCH', body: JSON.stringify({ models }) }) : await api.request(`/api/sessions/${encodeURIComponent(savedCtx.sessionId)}/settings`, { method: 'PATCH', body: JSON.stringify({ repo: fields.get('repo'), agents: fields.getAll('agents'), main: fields.get('main') || 'claude', worktree: fields.get('worktree') === 'true', timeout: Number(fields.get('timeout')), models }) });
        notify(result.message || '设置已保存，发送目标即可启动。'); await refresh();
      } catch (err) { $('#ar-form-error').textContent = err.message; } finally { button.disabled = false; }
    };
    if ($('#ar-back-manager')) $('#ar-back-manager').onclick = () => { api.open(savedCtx.managerSessionId); close(); };
    if ($('#ar-stop')) $('#ar-stop').onclick = async e => {
      if (!confirm('停止此运行？其他并发运行不会受影响。')) return;
      e.target.disabled = true;
      try { await api.request(`/api/runs/${savedCtx.runId}/stop`, { method:'POST' }); notify('已请求停止'); await refresh(); } catch (err) { notify(err.message, true); e.target.disabled = false; }
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
    await refresh(true); await show('settings');
  } catch (e) { notify(e.message, true); } }
  $('#ar-new').onclick = createSession; $('#ar-close').onclick = close;
  bar.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => show(b.dataset.panel).catch(e => notify(e.message, true)));
  window.addEventListener('ar:session', () => refresh(true)); window.addEventListener('ar:refresh', () => refresh());
  window.addEventListener('message', e => { if (e.origin !== location.origin || e.source !== frame?.contentWindow) return; if (e.data?.type === 'ar:close') close(); });
  document.addEventListener('keydown', e => {
    if (panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab' && matchMedia('(max-width:1100px)').matches) {
      const controls = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),iframe,a[href]')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  const hideLabels = ['好的回答','有问题的回答','在新对话中分支','添加工作区','添加文件或调用指令','反馈','正在加载模型'];
  const sweep = () => {
    for (const el of document.querySelectorAll('#root button,#root [role="menuitem"]')) {
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      if (hideLabels.some(t => label.includes(t))) el.dataset.arHidden = '';
    }
  };
  let scheduled = false;
  new MutationObserver(() => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; sweep(); }); }).observe($('#root'), { childList:true, subtree:true });
  contextTimer = setInterval(() => { if (!document.hidden) refresh(); }, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
})();

