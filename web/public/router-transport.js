/* Owned integration boundary: no edits to the archived dsh bundles. */
(() => {
  const api = window.AgentRouter = { sessionId: null };
  api.select = id => { if (id === api.sessionId) return; api.sessionId = id || null; window.dispatchEvent(new CustomEvent('ar:session', { detail: api.sessionId })); };
  api.notify = (text, error = false) => window.dispatchEvent(new CustomEvent('ar:notice', { detail: { text, error } }));
  api.request = async (url, options = {}) => {
    const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`); return data;
  };
  const req = p => { const a = p?.args ?? p ?? {}; return a.request ?? a; };
  api.rpc = async (_, endpoint, payload, signal) => {
    if (endpoint === 'session/cancel' && !confirm('停止此会话所属运行？其他并发运行不会受影响。')) return { ok: true, value: { accepted: false } };
    const result = await api.request('/dsh-api/' + endpoint, { method: 'POST', body: JSON.stringify(payload ?? {}), signal });
    if (endpoint === 'session/create' && result.ok) api.select(result.value.sessionId);
    if (endpoint === 'session/prompt' || endpoint === 'session/cancel') {
      if (!result.ok) api.notify(result.error.message, true);
      else if (result.value?.delivery === 'mailbox') api.notify('已写入子代理信箱，等待子代理读取。');
      window.dispatchEvent(new Event('ar:refresh'));
    }
    return result;
  };
  api.stream = async function* (_, endpoint, payload, signal) {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}), signal };
    // 会话流是永不结束的常驻连接，dsh 一开就是 5 条，混在同域会把浏览器的 6 连接上限占满，
    // 面板的普通请求就永远排队。流走独立端口（自带连接池）；独立端口不可用时回退同源
    const remote = window.AR_STREAM_PORT ? `${location.protocol}//${location.hostname}:${window.AR_STREAM_PORT}/dsh-api-stream/` : null;
    let res = null;
    try { if (remote) res = await fetch(remote + endpoint, init); } catch (e) { if (signal?.aborted) throw e; res = null; }
    if (!res || !res.ok || !res.body) res = await fetch('/dsh-api-stream/' + endpoint, init);
    if (!res.ok || !res.body) throw new Error('无法连接会话流');
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) if (line.trim()) yield JSON.parse(line);
        if (done) { if (buffer.trim()) yield JSON.parse(buffer); break; }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  api.install = () => { window.__DSH_TRANSPORT__ = { ownsHost: true, rpc: { call: api.rpc, open: api.stream } }; return true; };
  api.install();
  const boot = window.__DSH_BOOT__;
  if (boot) {
    boot.entries.push({ id: 'agent-router-ui', url: '/router-integration.js', rev: '1', inject: ['@deepseek-ai/dsh-client-ui-workspace', '@deepseek-ai/dsh-client-ui-session'] });
    boot.batches.push({ phase: 'application', url: '/router-integration.js', rev: '1', entries: ['agent-router-ui'] });
  }
})();
