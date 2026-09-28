import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { read, mutate } from '../lib/store.mjs';
import { readJson, writeJson, safeId } from './sessions.mjs';
import { runtimeConfig, validateModels } from './models.mjs';

export class Runs {
  constructor({ dataDir, root, launch, kill } = {}) {
    this.dataDir = dataDir; this.root = root; this.active = new Map();
    this.launch = launch || ((args, env) => spawn(process.execPath, [path.join(root, 'router.mjs'), ...args], { cwd: root, env: { ...process.env, ...env }, windowsHide: true }));
    this.kill = kill || (child => {
      if (process.platform === 'win32') {
        const r = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
        if (r.status !== 0) throw new Error(r.stderr || r.stdout || '停止失败');
      } else if (!child.kill('SIGTERM')) throw new Error('停止失败');
    });
  }
  dir(id) { if (!safeId(id)) throw new Error('无效运行标识'); return path.join(this.dataDir, id); }
  running(id) { return this.active.get(id)?.status === 'running'; }
  settings(input) {
    const repo = fs.realpathSync(path.resolve(input.repo || path.join(this.root, 'demo', 'todo-cli')));
    if (!fs.statSync(repo).isDirectory()) throw new Error('工作目录必须是文件夹');
    const agents = input.agents ?? ['claude', 'zcode'];
    if (!Array.isArray(agents) || !agents.length || agents.some(a => !['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity'].includes(a))) throw new Error('请选择有效执行成员');
    const main = input.main ?? 'claude';
    if (!['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity'].includes(main)) throw new Error('请选择有效主代理');
    const timeout = Number(input.timeout ?? 900);
    if (!Number.isInteger(timeout) || timeout < 60 || timeout > 3600) throw new Error('超时须在 60–3600 秒之间');
    const worktree = input.worktree === true;
    if (worktree && spawnSync('git', ['-C', repo, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true }).status !== 0) throw new Error('worktree 模式需要 Git 仓库');
    return { repo, agents: [...new Set(agents)], main, timeout, worktree, models: validateModels(input.models) };
  }
  start(input) {
    const goal = String(input.goal || '').trim();
    if (!goal || goal.length > 16000) throw new Error('目标不能为空且不能超过 16000 字符');
    const settings = this.settings(input);
    const canonical = dir => {
      const git = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
      const p = path.resolve(git.status === 0 ? git.stdout.trim() : dir);
      return process.platform === 'win32' ? p.toLowerCase() : p;
    };
    const target = canonical(settings.repo);
    for (const run of this.active.values()) {
      if (run.status !== 'running') continue;
      const other = canonical(run.settings.repo);
      if (target === other || target.startsWith(other + path.sep) || other.startsWith(target + path.sep)) throw new Error(`工作目录与运行 ${run.id} 重叠；请选择独立目录或独立 Git worktree`);
    }
    const id = `web-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = this.dir(id);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'board.json'), { seq: { task: 0, msg: 0 }, tasks: [], messages: [] });
    const meta = { id, goal, settings, startedAt: Date.now(), status: 'running', exitCode: null };
    writeJson(path.join(dir, 'run.json'), meta);
    writeJson(path.join(dir, 'runtime-config.json'), runtimeConfig(settings.models));
    const args = [goal, '--repo', settings.repo, '--agents', settings.agents.join(','), '--main', settings.main, '--timeout', String(settings.timeout), '--data', dir];
    if (settings.worktree) args.push('--worktree');
    let child;
    try { child = this.launch(args, { AGENT_ROUTER_RUN_CONFIG: path.join(dir, 'runtime-config.json') }); }
    catch (e) { writeJson(path.join(dir, 'run.json'), { ...meta, status: 'failed', error: e.message }); throw e; }
    const run = { ...meta, dir, child, clients: new Set(), seq: 0, events: [], signature: '' };
    this.active.set(id, run);
    const output = chunk => {
      const line = String(chunk);
      fs.appendFileSync(path.join(dir, 'console.log'), line);
      this.emit(run, { type: 'console', line });
    };
    child.stdout?.on('data', output); child.stderr?.on('data', output);
    const finish = (code, error) => {
      if (run.status !== 'running') return;
      run.status = error || code !== 0 ? 'failed' : 'finished'; run.exitCode = code;
      writeJson(path.join(dir, 'run.json'), { ...meta, settings: run.settings, status: run.status, exitCode: code, error });
      this.poll(run);
      this.emit(run, { type: 'exit', code, error });
      clearInterval(run.timer);
      for (const res of run.clients) res.end();
      run.clients.clear();
    };
    child.on('error', e => finish(-1, e.message));
    child.on('close', code => finish(code));
    run.timer = setInterval(() => this.poll(run), 1200);
    run.timer.unref();
    return { id, dir, pid: child.pid };
  }
  poll(run) {
    try {
      const d = this.detail(run.id);
      const signature = JSON.stringify([d.board, d.agentStatus, d.threads, d.status]);
      if (signature === run.signature) return;
      run.signature = signature;
      this.emit(run, { type: 'board', board: d.board });
      this.emit(run, { type: 'status', status: d.agentStatus });
      this.emit(run, { type: 'threads', threads: d.threads });
      this.emit(run, { type: 'snapshot', run: d });
    } catch (e) { this.emit(run, { type: 'error', error: e.message }); }
  }
  emit(run, event) {
    const item = { ...event, runId: run.id, eventId: ++run.seq };
    run.events.push(item); if (run.events.length > 500) run.events.shift();
    for (const res of run.clients) res.write(`id: ${item.eventId}\ndata: ${JSON.stringify(item)}\n\n`);
  }
  subscribe(id, res, lastId = 0) {
    const run = this.active.get(id);
    if (!run || run.status !== 'running') {
      res.write(`data: ${JSON.stringify({ type: 'hello', runId: id, running: false })}\n\n`); res.end(); return;
    }
    res.write(`data: ${JSON.stringify({ type: 'hello', runId: id, running: true })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'snapshot', runId: id, run: this.detail(id) })}\n\n`);
    for (const item of run.events) if (lastId > 0 && item.eventId > lastId) res.write(`id: ${item.eventId}\ndata: ${JSON.stringify(item)}\n\n`);
    run.clients.add(res);
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
    res.on('close', () => { run.clients.delete(res); clearInterval(heartbeat); });
  }
  list() {
    if (!fs.existsSync(this.dataDir)) return [];
    return fs.readdirSync(this.dataDir, { withFileTypes: true }).filter(e => e.isDirectory() && safeId(e.name)).flatMap(e => {
      try {
        const d = this.detail(e.name); if (!d.board) return [];
        const tasks = d.board.tasks || [];
        return [{ id: d.id, goal: d.goal, settings: d.settings, mtime: d.startedAt, live: this.running(d.id), status: d.status, summary: { total: tasks.length, done: tasks.filter(t => t.status === 'done').length, failed: tasks.filter(t => t.status === 'failed').length, running: tasks.filter(t => t.status === 'in_progress').length } }];
      } catch { return []; }
    }).sort((a, b) => b.mtime - a.mtime);
  }
  detail(id) {
    const dir = this.dir(id); if (!fs.existsSync(dir)) throw new Error('运行不存在');
    const meta = readJson(path.join(dir, 'run.json'), {});
    const run = this.active.get(id);
    const files = sub => {
      try { return fs.readdirSync(path.join(dir, sub)).filter(safeId).map(name => ({ name, size: fs.statSync(path.join(dir, sub, name)).size, mtime: fs.statSync(path.join(dir, sub, name)).mtimeMs })); } catch { return []; }
    };
    return { id, goal: meta.goal || null, settings: run?.settings || meta.settings || null, status: run?.status || (meta.status === 'running' ? 'interrupted' : meta.status || 'finished'), exitCode: run?.exitCode ?? meta.exitCode ?? null, startedAt: meta.startedAt || fs.statSync(dir).mtimeMs, board: readJson(path.join(dir, 'board.json')), agentStatus: readJson(path.join(dir, 'status.json')), threads: files('threads'), logs: files('logs'), consoleAvailable: fs.existsSync(path.join(dir, 'console.log')) };
  }
  command(id, cmd) {
    if (!this.running(id)) throw new Error('该运行不在进行中');
    fs.appendFileSync(path.join(this.dir(id), 'commands.jsonl'), JSON.stringify({ ...cmd, ts: Date.now() }) + '\n');
    return { ok: true, delivery: 'queued' };
  }
  message(id, { text, to = 'manager', task_id = null }) {
    if (!this.running(id)) throw new Error('该运行不在进行中');
    const run = this.active.get(id);
    text = String(text || '').trim();
    if (!text || text.length > 16000) throw new Error('消息不能为空且不能超过 16000 字符');
    if (to === 'manager') return this.command(id, { type: 'message', text });
    if (!run.settings.agents.includes(to)) throw new Error('接收者不属于本次运行');
    let result;
    mutate(path.join(run.dir, 'board.json'), b => {
      if (task_id && !b.tasks.some(t => t.id === task_id && t.assignee === to)) throw new Error('任务与接收者不匹配');
      const message = { id: `M${++b.seq.msg}`, from: 'user', to, task_id, content: text, read: false, ts: new Date().toISOString() };
      b.messages.push(message); result = { ok: true, delivery: 'mailbox', messageId: message.id };
    });
    this.poll(run); return result;
  }
  models(id, models) {
    if (!this.running(id)) throw new Error('只有运行中的会话可切换模型');
    const run = this.active.get(id);
    const selected = validateModels(models);
    run.settings = { ...run.settings, models: selected };
    writeJson(path.join(run.dir, 'runtime-config.json'), runtimeConfig(selected));
    const meta = readJson(path.join(run.dir, 'run.json'));
    writeJson(path.join(run.dir, 'run.json'), { ...meta, settings: run.settings });
    this.command(id, { type: 'models_changed' });
    return { ok: true, models: selected, message: '主代理将在当前回合结束后切换；子代理在下一次会话启动时使用新模型。' };
  }
  stop(id) {
    if (!this.running(id)) throw new Error('该运行不在进行中');
    this.kill(this.active.get(id).child); return { ok: true };
  }
}
