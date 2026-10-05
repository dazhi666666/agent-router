import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { createBridge } from './dsh-bridge.mjs';
import { Sessions, readJson, safeId } from './sessions.mjs';
import { Runs } from './runs.mjs';
import { modelCatalog } from './models.mjs';
import { providerReady } from '../chat-agent/provider.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'web', 'public');
const DSH = path.join(ROOT, 'dsh-web');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json' };
const PLUGINS = readJson(path.join(DSH, 'plugins', 'map.json'), {});
// 首页是 dsh 界面（dsh-web/ 为 deepseek-harness 的本地构建），注入 Agent Router 的样式、顶栏与面板；构建缺失时首页转到经典控制台
const INDEX = (() => {
  try {
    return fs.readFileSync(path.join(DSH, 'index.html'), 'utf8').replace('<title>DSH Local Build</title>', '<title>Agent Router · 协作空间</title>').replace('</head>', '<link rel="stylesheet" href="/router-ui.css"><script src="/router-transport.js" defer></script></head>').replace('</body>', '<script src="/board-embed.js" defer></script></body>');
  } catch {
    return null;
  }
})();
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) { let value = ''; for await (const c of req) { value += c; if (value.length > 2e6) throw new Error('请求内容过长'); } return JSON.parse(value || '{}'); }
function file(res, root, name) {
  const full = path.resolve(root, name);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); fs.createReadStream(full).pipe(res);
}
// codex 的 exe 可能是 PATH 相对名（npm 垫片是 .cmd，fs.existsSync 探测不到）：用 --version 实测，结果缓存 60s
let codexOk = null, codexCheckedAt = 0;
function codexAvailable() {
  if (codexOk !== null && Date.now() - codexCheckedAt < 60000) return codexOk;
  codexCheckedAt = Date.now();
  const exe = loadConfig().codex.exe;
  if (!exe) { codexOk = false; return false; }
  if (path.isAbsolute(exe)) codexOk = fs.existsSync(exe);
  else codexOk = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true }).status === 0;
  return codexOk;
}
// 目录浏览（新建任务时选择工作目录）：只列子目录；不传 path 时返回主目录与 Windows 盘符
function listDirs(dir) {
  const home = os.homedir();
  const roots = process.platform === 'win32'
    ? 'CDEFGHIJ'.split('').map(l => `${l}:\\`).filter(d => fs.existsSync(d))
    : ['/'];
  const target = path.resolve(dir || home);
  const st = fs.statSync(target);
  if (!st.isDirectory()) throw new Error('不是文件夹');
  const dirs = fs.readdirSync(target, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !/^(node_modules|\$Recycle\.Bin|System Volume Information)$/i.test(e.name))
    .map(e => e.name).sort((a, b) => a.localeCompare(b)).slice(0, 500);
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, dirs, home, roots, isGit: fs.existsSync(path.join(target, '.git')) };
}
// 示例项目随仓库分发；新 clone 下它没有自己的 .git，会被当成 Agent Router 仓库的一部分（任务提交会落进本仓库）。首次启动时给它单独初始化一个仓库
function ensureDemoRepo(dir) {
  if (!fs.existsSync(dir) || fs.existsSync(path.join(dir, '.git'))) return;
  const git = (...args) => spawnSync('git', ['-C', dir, '-c', 'user.name=Agent Router', '-c', 'user.email=agent-router@localhost', ...args], { encoding: 'utf8', windowsHide: true });
  if (git('init', '-q').status !== 0) return;
  git('add', '-A'); git('commit', '-q', '-m', 'demo: initial snapshot');
}
export function createApp({ dataDir = process.env.AGENT_ROUTER_DATA_DIR || path.join(ROOT, 'data'), launch, kill } = {}) {
  dataDir = path.resolve(dataDir);
  const runs = new Runs({ root: ROOT, dataDir, launch, kill });
  ensureDemoRepo(path.join(ROOT, 'demo', 'todo-cli'));
  const sessions = new Sessions(dataDir, path.join(ROOT, 'demo', 'todo-cli'));
  const bridge = createBridge({ runs, sessions });
  // 预热可选模型清单（首个 CLI 扫描要数秒，避免第一个打开设置面板的请求卡顿）
  setTimeout(() => { try { modelCatalog(); } catch {} }, 500).unref();
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'dsh-api' || parts[0] === 'dsh-api-stream') {
        const endpoint = parts.slice(1).join('/');
        if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
        const payload = await body(req);
        if (parts[0] === 'dsh-api') {
          try { return json(res, 200, bridge.unary(endpoint, payload)); }
          catch (e) { return json(res, 200, { ok: false, error: { code: 'router/request-failed', message: e.message, details: {} } }); }
        }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        let closed = false;
        const send = frame => { if (!closed) res.write(JSON.stringify(frame) + '\n'); };
        let cleanup = () => {};
        try { cleanup = bridge.stream(endpoint, payload, send); }
        catch (e) { send({ type: 'error', error: { code: 'router/stream-failed', message: e.message } }); res.end(); }
        res.on('close', () => { closed = true; cleanup(); }); return;
      }
      if (u.pathname === '/api/health') {
        const cfg = loadConfig(), catalog = modelCatalog(), activeRuns = runs.list().filter(r => r.live);
        return json(res, 200, { claude: fs.existsSync(cfg.claude.exe), zcode: fs.existsSync(cfg.zcode.entry), devin: fs.existsSync(cfg.devin.exe), codex: codexAvailable(), opencode: fs.existsSync(cfg.opencode.exe), antigravity: fs.existsSync(cfg.antigravity.exe), checks: { claude: '仅检测 CLI 路径，未验证登录', zcode: '仅检测 CLI 路径，未验证登录', devin: '仅检测 CLI 路径，未验证登录', codex: '检测 codex --version 可执行（未验证登录）', opencode: '仅检测 CLI 路径，未验证登录', antigravity: '仅检测 CLI 路径，未验证登录（密钥环静默登录，生成接口走本地代理）' }, models: Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, v.default || '客户端默认'])), paths: { claude: cfg.claude.exe, zcode: cfg.zcode.entry, devin: cfg.devin.exe, codex: cfg.codex.exe, opencode: cfg.opencode.exe, antigravity: cfg.antigravity.exe }, llm: Object.fromEntries(Object.entries(cfg.llm).map(([k, v]) => [k, { label: v.label || v.model || k, model: v.model || (v.module ? 'custom module' : null), ready: providerReady(v), apiKeyEnv: v.apiKeyEnv || null }])), consult: cfg.llm[cfg.consult] ? cfg.consult : null, busy: activeRuns.length > 0, activeRuns, activeRun: activeRuns[0] || null });
      }
      if (u.pathname === '/api/fs/dirs') return json(res, 200, listDirs(u.searchParams.get('path')));
      if (u.pathname === '/api/models') return json(res, 200, modelCatalog());
      if (u.pathname === '/api/events') {
        const id = u.searchParams.get('runId');
        if (!id || !safeId(id)) return json(res, 400, { error: '必须指定 runId' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        runs.subscribe(id, res, Number(req.headers['last-event-id'] || 0)); return;
      }
      if (parts[0] === 'api' && parts[1] === 'sessions' && parts[2]) {
        const id = parts[2], ctx = bridge.context(id);
        if (parts[3] === 'context' && req.method === 'GET') return json(res, 200, ctx);
        if (parts[3] === 'settings' && req.method === 'PATCH') {
          if (!ctx.capabilities.configure) return json(res, 409, { error: '运行已启动，工作目录和成员不可修改；模型可单独切换。' });
          const item = sessions.resolve(id);
          item.settings = runs.settings({ ...item.settings, ...await body(req) }); sessions.save(); return json(res, 200, bridge.context(id));
        }
      }
      if (u.pathname === '/api/runs') {
        if (req.method === 'GET') return json(res, 200, runs.list());
        if (req.method === 'POST') return json(res, 200, runs.start(await body(req)));
      }
      if (parts[0] === 'api' && parts[1] === 'runs' && parts[2]) {
        const id = parts[2], d = runs.detail(id), dir = runs.dir(id), action = parts[3];
        if (!action && req.method === 'GET') return json(res, 200, { ...d, managerSessionId: sessions.managerId(id) });
        if (action === 'stop' && req.method === 'POST') return json(res, 200, runs.stop(id));
        if (action === 'message' && req.method === 'POST') return json(res, 200, runs.message(id, await body(req)));
        if (action === 'main' && req.method === 'PATCH') return json(res, 200, runs.switchMain(id, (await body(req)).main));
        if (action === 'models' && req.method === 'PATCH') return json(res, 200, runs.models(id, (await body(req)).models));
        if (action === 'task' && req.method === 'POST') {
          const task = d.board?.tasks?.find(t => t.id === parts[4]), command = parts[5];
          if (!task || !['cancel', 'retry'].includes(command)) throw new Error('无效任务操作');
          if (command === 'retry' && task.status !== 'failed' || command === 'cancel' && task.status !== 'in_progress') throw new Error('任务状态已变化，请刷新后重试');
          return json(res, 200, runs.command(id, { type: command, task_id: task.id }));
        }
        if (action === 'console') return json(res, 200, { text: fs.existsSync(path.join(dir, 'console.log')) ? fs.readFileSync(path.join(dir, 'console.log'), 'utf8') : '' });
        if (action === 'logs') return json(res, 200, d.logs);
        if (action === 'threads') return json(res, 200, d.threads);
        if (['log', 'thread'].includes(action) && safeId(parts[4])) {
          const name = parts[4], full = path.join(dir, action === 'log' ? 'logs' : 'threads', name), text = fs.readFileSync(full, 'utf8');
          return json(res, 200, action === 'log' ? { name, text: text.slice(-400000) } : { name, entries: text.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) });
        }
      }
      if (parts[0] === 'api') return json(res, 404, { error: '接口不存在' });
      if (['/', '/index.html', '/dsh', '/dsh/'].includes(u.pathname)) {
        if (!INDEX) { res.writeHead(302, { Location: '/console/' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); return res.end(INDEX);
      }
      if (u.pathname.startsWith('/assets/router-transport-')) return file(res, PUBLIC, 'router-transport-module.js');
      if (parts[0] === 'plugins') {
        const key = PLUGINS[u.pathname.slice(1) + u.search] || PLUGINS[u.pathname.slice('/plugins/'.length) + u.search];
        return key ? file(res, path.join(DSH, 'plugins'), key) : json(res, 404, { error: '插件资源不存在' });
      }
      if (parts[0] === 'assets' || /favicon|manifest/.test(u.pathname)) return file(res, path.join(DSH, 'dist'), u.pathname.slice(1));
      if (u.pathname === '/board') return file(res, PUBLIC, 'board.html');
      if (u.pathname === '/console') { res.writeHead(302, { Location: '/console/' }); return res.end(); }
      return file(res, PUBLIC, parts[0] === 'console' ? parts.slice(1).join('/') || 'index.html' : parts.join('/'));
    } catch (e) { if (res.headersSent) return res.end(); json(res, e.code === 'ENOENT' ? 404 : 400, { error: e.message }); }
  });
  return { server, runs, sessions, bridge };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp(); const port = Number(process.env.PORT || 2288);
  server.listen(port, '127.0.0.1', () => console.log(`Agent Router: http://127.0.0.1:${server.address().port}`));
}
