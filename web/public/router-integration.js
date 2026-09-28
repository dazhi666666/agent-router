window.__ModuleLoader__.load({
  id: 'agent-router-ui',
  factory: () => ({
    inject: ['uiWorkspace', 'sessions'],
    apply(ctx) {
      const api = window.AgentRouter;
      api.open = id => ctx.uiWorkspace.openSession(id);
      api.newSession = async () => {
        // 优先触发 dsh 原生「新会话」入口，由 dsh 完成内部会话注册与打开；
        // 直接对自建 id 调 openSession 会报 sessions.retain: unknown session
        const btn = [...document.querySelectorAll('#root button')]
          .find(b => !b.closest('.ar-ui') && /新会话/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')));
        const before = api.sessionId;
        if (btn) {
          btn.click();
          await new Promise(resolve => {
            const timer = setTimeout(done, 4000);
            const onSession = () => { if (api.sessionId !== before) done(); };
            const cleanup = () => { clearTimeout(timer); window.removeEventListener('ar:session', onSession); };
            function done() { cleanup(); resolve(); }
            window.addEventListener('ar:session', onSession);
          });
          return api.sessionId;
        }
        const result = await api.rpc(null, 'session/create', {});
        if (!result.ok) throw new Error(result.error.message);
        api.select(result.value.sessionId);
        return result.value.sessionId;
      };
      const sync = () => {
        const current = Object.values(ctx.sessions.list.getSnapshot().byId).find(row => (row.retainedBy.mainView ?? 0) > 0);
        api.select(current?.id || null);
      };
      ctx.effect(() => ctx.sessions.list.subscribe(sync));
      sync();
      const target = new URLSearchParams(location.search).get('session');
      if (target) api.open(target);
      window.dispatchEvent(new Event('ar:ready'));
    }
  })
});
