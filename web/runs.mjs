import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readJson, writeJson, safeId } from './sessions.mjs';
import { runtimeConfig, validateModels } from './models.mjs';
import { loadConfig } from '../lib/config.mjs';

const CLI_AGENTS = ['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity'];
// 成员可以是 CLI，也可以是 router.config.json 里 llm 下配置的对话模型（经 Codex + chat-agent gateway 运行）
const validAgent = name => CLI_AGENTS.includes(name) || Object.hasOwn(loadConfig().llm, name);
const validMain = validAgent;

// CLI 启动的运行没有 run.json：从主代理线程首条消息（goalMessage 的「## 总目标」段）取目标
function goalFromThread(dir) {
  try {
    const fd = fs.openSync(path.join(dir, 'threads', 'manager.jsonl'), 'r');
    const buf = Buffer.alloc(65536), n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.kind !== 'user') continue;
      const m = String(e.data?.text || '').match(/## 总目标\n([\s\S]*?)\n\n花名册：/);
      return m ? m[1].trim() : null;
    }
  } catch {}
  return null;
}

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
    if (!Array.isArray(agents) || !agents.length || agents.some(a => !validAgent(a))) throw new Error('请选择有效执行成员');
    const main = input.main ?? 'claude';
    if (!validMain(main)) throw new Error('请选择有效主代理');
    const worktree = input.worktree === true;
    if (worktree && spawnSync('git', ['-C', repo, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true }).status !== 0) throw new Error('worktree 模式需要 Git 仓库');
    return { repo, agents: [...new Set(agents)], main, worktree, models: validateModels(input.models) };
  }
  // 工作目录不能与其他进行中的运行重叠（同一 git 仓库内的子目录也算）
  assertNoOverlap(repo, selfId = null) {
    const canonical = dir => {
      const git = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
      const p = path.resolve(git.status === 0 ? git.stdout.trim() : dir);
      return process.platform === 'win32' ? p.toLowerCase() : p;
    };
    const target = canonical(repo);
    for (const run of this.active.values()) {
      if (run.status !== 'running' || run.id === selfId) continue;
      const other = canonical(run.settings.repo);
      if (target === other || target.startsWith(other + path.sep) || other.startsWith(target + path.sep)) throw new Error(`工作目录与运行 ${run.id} 重叠；请选择独立目录或独立 Git worktree`);
    }
  }
  start(input) {
    // 对话模式（默认）：第一条消息原样发给主代理；goal 模式（mode: 'goal'）沿用"总目标 → finish_run"流程
    const goal = String(input.message ?? input.goal ?? '').trim();
    if (!goal || goal.length > 16000) throw new Error('消息不能为空且不能超过 16000 字符');
    const settings = this.settings(input);
    this.assertNoOverlap(settings.repo);
    const id = `web-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = this.dir(id);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'board.json'), { seq: { task: 0, msg: 0 }, tasks: [], messages: [] });
    const meta = { id, goal, mode: input.mode === 'goal' ? 'goal' : 'chat', settings, startedAt: Date.now(), status: 'running', exitCode: null };
    writeJson(path.join(dir, 'run.json'), meta);
    writeJson(path.join(dir, 'runtime-config.json'), runtimeConfig(settings.models));
    const child = this.spawnRouter(meta, goal, false);
    return { id, dir, pid: child.pid };
  }
  /** 对话已休眠/被停止：用新消息重新拉起 Router，--resume 续接原主代理会话 */
  resume(id, text) {
    const dir = this.dir(id);
    const meta = readJson(path.join(dir, 'run.json'));
    if (!meta?.settings || meta.mode !== 'chat') throw new Error('该运行不在进行中');
    if (!fs.existsSync(meta.settings.repo)) throw new Error(`工作目录已不存在：${meta.settings.repo}`);
    this.assertNoOverlap(meta.settings.repo, id);
    const next = { ...meta, status: 'running', exitCode: null, error: undefined, resumedAt: Date.now() };
    writeJson(path.join(dir, 'run.json'), next);
    this.spawnRouter(next, text, true);
    return { ok: true, delivery: 'resumed' };
  }
  spawnRouter(meta, text, resume) {
    const { id, settings } = meta, dir = this.dir(id);
    const args = [text, '--repo', settings.repo, '--agents', settings.agents.join(','), '--main', settings.main, '--data', dir];
    if (settings.worktree) args.push('--worktree');
    if (meta.mode === 'chat') args.push('--chat');
    if (resume) args.push('--resume');
    let child;
    try { child = this.launch(args, { AGENT_ROUTER_RUN_CONFIG: path.join(dir, 'runtime-config.json') }); }
    catch (e) { writeJson(path.join(dir, 'run.json'), { ...meta, status: 'failed', error: e.message }); throw e; }
    const prev = this.active.get(id);
    const run = { ...meta, dir, child, clients: prev?.clients || new Set(), seq: prev?.seq || 0, events: [], signature: '' };
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
    return child;
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
        return [{ id: d.id, goal: d.goal, mode: d.mode, settings: d.settings, mtime: d.startedAt, live: this.running(d.id), status: d.status, summary: { total: tasks.length, done: tasks.filter(t => t.status === 'done').length, failed: tasks.filter(t => t.status === 'failed').length, running: tasks.filter(t => t.status === 'in_progress').length } }];
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
    return { id, goal: meta.goal || goalFromThread(dir), mode: meta.mode || 'goal', settings: run?.settings || meta.settings || null, status: run?.status || (meta.status === 'running' ? 'interrupted' : meta.status || 'finished'), exitCode: run?.exitCode ?? meta.exitCode ?? null, startedAt: meta.startedAt || fs.statSync(dir).mtimeMs, board: readJson(path.join(dir, 'board.json')), agentStatus: readJson(path.join(dir, 'status.json')), threads: files('threads'), logs: files('logs'), consoleAvailable: fs.existsSync(path.join(dir, 'console.log')) };
  }
  command(id, cmd) {
    if (!this.running(id)) throw new Error('该运行不在进行中');
    fs.appendFileSync(path.join(this.dir(id), 'commands.jsonl'), JSON.stringify({ ...cmd, ts: Date.now() }) + '\n');
    return { ok: true, delivery: 'queued' };
  }
  message(id, { text, to = 'manager', task_id = null }) {
    text = String(text || '').trim();
    if (!text || text.length > 16000) throw new Error('消息不能为空且不能超过 16000 字符');
    if (!this.running(id) && to === 'manager') return this.resume(id, text);
    if (!this.running(id)) throw new Error('该运行不在进行中');
    const run = this.active.get(id);
    if (to === 'manager') return this.command(id, { type: 'message', text });
    if (!run.settings.agents.includes(to)) throw new Error('接收者不属于本次运行');
    // 任务板归 Router 进程所有：留言经命令通道交给 Router 写入（子代理在 read_inbox 时看到）
    const board = readJson(path.join(run.dir, 'board.json'), { tasks: [] });
    if (task_id && !board.tasks.some(t => t.id === task_id && t.assignee === to)) throw new Error('任务与接收者不匹配');
    // 任务已终态（done/failed）说明子代理会话已关闭，信箱没人再读：明说，别让消息石沉大海
    if (task_id) {
      const task = board.tasks.find(t => t.id === task_id);
      if (task && (task.status === 'done' || task.status === 'failed')) {
        const state = task.status === 'done' ? '已完成' : '已结束（失败/被取消）';
        throw new Error(`任务 ${task_id}「${task.title?.slice(0, 30) || ''}」${state}，子代理会话已关闭，不会再读取留言。可 retry 该任务重新派发，或把消息发给 manager。`);
      }
    }
    this.command(id, { type: 'message', to, task_id, text });
    return { ok: true, delivery: 'mailbox' };
  }
  /** 切换主代理：运行中则交给 Router 在当前回合结束后切换；休眠/停止时写入设置，下次唤醒由新主代理接手 */
  switchMain(id, main) {
    if (!validMain(main)) throw new Error('请选择有效主代理');
    const file = path.join(this.dir(id), 'run.json');
    const meta = readJson(file);
    if (!meta?.settings) throw new Error('运行不存在');
    if (meta.mode !== 'chat') throw new Error('只有对话可以切换主代理');
    const settings = { ...meta.settings, main };
    writeJson(file, { ...meta, settings });
    const run = this.active.get(id);
    if (run) run.settings = settings;
    const running = this.running(id);
    if (running) this.command(id, { type: 'switch_main', main });
    return { ok: true, main, applied: running ? 'after_turn' : 'next_message' };
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
