import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { createBridge } from './dsh-bridge.mjs';
import { Sessions, readJson, safeId } from './sessions.mjs';
import { Runs } from './runs.mjs';
import { modelCatalog } from './models.mjs';
import { providerReady } from '../chat-agent/provider.mjs';
import { changesSummary, changesDiff } from './changes.mjs';
import { Attachments } from './attachments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'web', 'public');
const DSH = path.join(ROOT, 'dsh-web');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json' };
const PLUGINS = readJson(path.join(DSH, 'plugins', 'map.json'), {});
// 首页是 dsh 界面（dsh-web/ 为 deepseek-harness 的本地构建），注入 Agent Router 的样式、顶栏与面板；构建缺失时首页转到经典控制台
// AR_STREAM_PORT 告诉前端把常驻会话流指到独立端口：dsh 固定开 5 条长流，加上运行中的 SSE 正好占满
// 浏览器对单域名的 6 连接上限，普通接口请求会永远排队，面板就会"加载不出来"
const STREAM_PORT = Number(process.env.PORT || 2288) + 1;
const INDEX = (() => {
  try {
    return fs.readFileSync(path.join(DSH, 'index.html'), 'utf8').replace('<title>DSH Local Build</title>', '<title>Agent Router · 协作空间</title>').replace('</head>', `<script>window.AR_STREAM_PORT=${STREAM_PORT}</script><link rel="stylesheet" href="/router-ui.css"><script src="/router-transport.js" defer></script></head>`).replace('</body>', '<script src="/board-embed.js" defer></script></body>');
  } catch {
    return null;
  }
})();
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) { let value = ''; for await (const c of req) { value += c; if (value.length > 2e6) throw new Error('请求内容过长'); } return JSON.parse(value || '{}'); }
async function rawBody(req, limit = 5e7) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('请求内容过长'); chunks.push(c); }
  return Buffer.concat(chunks);
}
// 改动审查/桌面打开共用的文件定位：sessionId + 汇总里的 index → 仓库内绝对路径
function changedFileOf(bridge, sessionId, index) {
  const ctx = bridge.context(sessionId);
  const repo = ctx.settings?.repo;
  if (!repo) throw new Error('会话未绑定工作目录');
  const summary = changesSummary(repo, 1);
  const f = summary.files[Number(index)];
  if (!f) throw new Error('文件不在改动清单里');
  return { repo, path: f.path, full: path.resolve(repo, f.path) };
}
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
// 示例项目 demo/todo-cli 只作模板：首次启动时复制到数据目录（已被 .gitignore）并单独初始化仓库，
// 任务的改动和提交都落在副本里，不会弄脏 Agent Router 自己的工作区
function ensureDemoRepo(template, dir) {
  if (!fs.existsSync(dir)) {
    if (!fs.existsSync(template)) return template;
    fs.cpSync(template, dir, { recursive: true, filter: src => path.basename(src) !== '.git' });
  }
  const git = (...args) => spawnSync('git', ['-C', dir, '-c', 'user.name=Agent Router', '-c', 'user.email=agent-router@localhost', ...args], { encoding: 'utf8', windowsHide: true });
  // 已是独立仓库（顶层就是它自己）则跳过；残缺的 .git 目录也会被重新初始化
  const top = git('rev-parse', '--show-toplevel').stdout.trim();
  if (top && path.resolve(top) === path.resolve(dir)) return dir;
  if (git('init', '-q').status === 0) { git('add', '-A'); git('commit', '-q', '-m', 'demo: initial snapshot'); }
  return dir;
}
export function createApp({ dataDir = process.env.AGENT_ROUTER_DATA_DIR || path.join(ROOT, 'data'), launch, kill } = {}) {
  dataDir = path.resolve(dataDir);
  const runs = new Runs({ root: ROOT, dataDir, launch, kill });
  const demo = ensureDemoRepo(path.join(ROOT, 'demo', 'todo-cli'), path.join(dataDir, 'demo', 'todo-cli'));
  const sessions = new Sessions(dataDir, demo);
  const attachments = new Attachments(dataDir);
  const bridge = createBridge({ runs, sessions });
  // 预热可选模型清单（首个 CLI 扫描要数秒，避免第一个打开设置面板的请求卡顿）
  setTimeout(() => { try { modelCatalog(); } catch {} }, 500).unref();
  const server = http.createServer(handler);
  return { server, handler, runs, sessions, bridge };
  async function handler(req, res) {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      // 流端口与主端口是不同源：预检放行；流应答带 CORS，但只放行同主机名的页面（防任意网站跨站读取）
      const originHost = (() => { try { return new URL(req.headers.origin || 'x://x').hostname; } catch { return null; } })();
      const cors = originHost && originHost === (req.headers.host || '').split(':')[0]
        ? { 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST', Vary: 'Origin' }
        : {};
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (parts[0] === 'dsh-api' || parts[0] === 'dsh-api-stream') {
        const endpoint = parts.slice(1).join('/');
        if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
        const payload = await body(req);
        if (parts[0] === 'dsh-api') {
          try { return json(res, 200, bridge.unary(endpoint, payload)); }
          catch (e) { return json(res, 200, { ok: false, error: { code: 'router/request-failed', message: e.message, details: {} } }); }
        }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...cors });
        let closed = false;
        const send = frame => { if (!closed) res.write(JSON.stringify(frame) + '\n'); };
        let cleanup = () => {};
        try { cleanup = bridge.stream(endpoint, payload, send); }
        catch (e) { send({ type: 'error', error: { code: 'router/stream-failed', message: e.message } }); res.end(); }
        res.on('close', () => { closed = true; cleanup(); }); return;
      }
      // ---- dsh 前端的普通 HTTP 路由（非 RPC）：改动审查 / 桌面打开 / 附件上传 ----
      if (u.pathname === '/api/changes.summary' || u.pathname === '/api/changes.diff') {
        const sessionId = u.searchParams.get('sessionId'), seq = u.searchParams.get('seq');
        const repo = bridge.context(sessionId).settings?.repo;
        if (!repo) return json(res, 404, { error: '会话未绑定工作目录' });
        if (u.pathname === '/api/changes.summary') return json(res, 200, changesSummary(repo, seq));
        const diff = changesDiff(repo, u.searchParams.get('index'), seq);
        return diff ? json(res, 200, diff) : json(res, 404, { error: '文件不在改动清单里' });
      }
      if ((u.pathname === '/api/changes.open' || u.pathname === '/api/present.open') && req.method === 'POST') {
        if (process.platform !== 'win32') return json(res, 422, { error: 'nativeUnavailable' });
        const { full } = changedFileOf(bridge, u.searchParams.get('sessionId'), u.searchParams.get('index'));
        if (u.searchParams.get('action') === 'reveal' || u.pathname === '/api/changes.open') spawn('explorer', [`/select,${full}`], { detached: true, windowsHide: true }).unref();
        else spawn('cmd', ['/c', 'start', '', full], { detached: true, windowsHide: true }).unref();
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/present.host') {
        return json(res, 200, { name: 'Agent Router', available: process.platform === 'win32', fileManager: process.platform === 'win32' ? 'explorer' : null });
      }
      if (u.pathname === '/api/session/uploadFileBinary' && req.method === 'POST') {
        const buf = await rawBody(req);
        const meta = attachments.save(buf, u.searchParams.get('name') || 'file');
        return json(res, 200, { ok: true, value: { receiptId: meta.receiptId, file: { attachmentId: meta.attachmentId, name: meta.name, bytes: meta.bytes } } });
      }
      if (u.pathname === '/api/session.export') return json(res, 501, { error: '会话导出暂不支持' });
      if (u.pathname === '/api/health') {
        const cfg = loadConfig(), catalog = modelCatalog(), activeRuns = runs.list().filter(r => r.live);
        const codexOk = codexAvailable(); // 对话模型由 Codex 经 gateway 驱动
        return json(res, 200, { claude: fs.existsSync(cfg.claude.exe), zcode: fs.existsSync(cfg.zcode.entry), devin: fs.existsSync(cfg.devin.exe), codex: codexOk, opencode: fs.existsSync(cfg.opencode.exe), antigravity: fs.existsSync(cfg.antigravity.exe), checks: { claude: '仅检测 CLI 路径，未验证登录', zcode: '仅检测 CLI 路径，未验证登录', devin: '仅检测 CLI 路径，未验证登录', codex: '检测 codex --version 可执行（未验证登录）', opencode: '仅检测 CLI 路径，未验证登录', antigravity: '仅检测 CLI 路径，未验证登录（密钥环静默登录，生成接口走本地代理）' }, models: Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, v.default || '客户端默认'])), paths: { claude: cfg.claude.exe, zcode: cfg.zcode.entry, devin: cfg.devin.exe, codex: cfg.codex.exe, opencode: cfg.opencode.exe, antigravity: cfg.antigravity.exe }, llm: Object.fromEntries(Object.entries(cfg.llm).map(([k, v]) => [k, { label: v.label || v.model || k, model: v.model || (v.module ? 'custom module' : null), ready: providerReady(v) && codexOk, codex: codexOk, apiKeyEnv: v.apiKeyEnv || null }])), consult: cfg.llm[cfg.consult] ? cfg.consult : null, busy: activeRuns.length > 0, activeRuns, activeRun: activeRuns[0] || null });
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
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, handler } = createApp(); const port = Number(process.env.PORT || 2288);
  server.listen(port, '127.0.0.1', () => console.log(`Agent Router: http://127.0.0.1:${server.address().port}`));
  // 常驻会话流单独一个端口：流各占一条连接且永不结束，混在主端口会把浏览器同域 6 连接占满，
  // 面板的普通请求就永远排队。独立端口有自己的连接池；起不来时前端自动回退同源（回到旧行为）
  const streams = http.createServer(handler);
  streams.on('error', e => console.error(`会话流端口 ${port + 1} 不可用（${e.message}），前端将回退同源流`));
  streams.listen(port + 1, '127.0.0.1', () => console.log(`Agent Router 会话流: http://127.0.0.1:${streams.address().port}`));
}
