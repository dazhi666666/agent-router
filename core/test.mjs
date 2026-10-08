// 协作核心测试：node --test core/test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Board } from './board.mjs';
import { callTool, toolsFor } from './tools.mjs';
import { startRpcServer } from './rpc.mjs';
import { Scheduler } from './scheduler.mjs';
import { Workspace } from './workspace.mjs';
import { spawnCollect } from '../lib/spawn-util.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROSTER = [{ name: 'manager', description: 'm' }, { name: 'claude', description: 'c' }, { name: 'zcode', description: 'z' }];
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-core-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
}
/** Kill a spawned router and everything it started (Codex, MCP servers), and wait for it to exit */
async function killTree(child) {
  if (child.exitCode !== null) return;
  const closed = new Promise(r => child.once('close', r));
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
  await closed;
}
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await tick(); }
}

test('tools: permissions and router-owned lifecycle', t => {
  const board = new Board(path.join(tmp(t), 'board.json'));
  const ctx = { roster: ROSTER, chat: true };
  assert.ok(!toolsFor('claude').some(x => x.name === 'create_task'));
  assert.ok(!toolsFor('manager', { chat: true }).some(x => x.name === 'finish_run'));
  assert.match(callTool(board, 'claude', 'create_task', { title: 'x', spec: '', assignee: 'zcode' }, ctx).error, /only the manager/);
  assert.match(callTool(board, 'manager', 'create_task', { title: 'x', assignee: 'devin' }, ctx).error, /not on the roster/);
  assert.match(callTool(board, 'manager', 'create_task', { title: 'x', assignee: 'zcode', blocked_by: ['T9'] }, ctx).error, /unknown blocked_by/);
  const { id } = callTool(board, 'manager', 'create_task', { title: 'x', spec: 's', assignee: 'zcode' }, ctx);
  assert.match(callTool(board, 'claude', 'update_task', { task_id: id, status: 'failed' }, ctx).error, /assigned to zcode/);
  board.updateTask(id, { status: 'in_progress' });
  // 子代理中途报状态只记录意向，不提前结束任务
  const r = callTool(board, 'zcode', 'update_task', { task_id: id, status: 'failed', result: 'no' }, ctx);
  assert.equal(r.status, 'in_progress'); assert.equal(board.task(id).reported, 'failed');
  assert.match(callTool(board, 'manager', 'followup_task', { task_id: id, message: 'm' }, ctx).error, /still in_progress/);
  // 广播按收件人分别记已读
  callTool(board, 'manager', 'send_message', { to: '*', content: 'hi' }, ctx);
  assert.equal(callTool(board, 'claude', 'read_inbox', {}, ctx).length, 1);
  assert.equal(callTool(board, 'claude', 'read_inbox', {}, ctx).length, 1); // 无 unreadOnly：仍可回看
  assert.equal(board.inbox('zcode', { unreadOnly: true }).length, 1);
  assert.equal(board.inbox('claude', { unreadOnly: true }).length, 0);
  // 快照落盘
  assert.equal(JSON.parse(fs.readFileSync(board.file, 'utf8')).tasks[0].reported, 'failed');
  // followup_task 快照当时的报告：续派会清掉 result（让新一轮的最终回复生效），previousResult 留在 followup 里
  const done = callTool(board, 'manager', 'create_task', { title: 'y', spec: 's', assignee: 'claude' }, ctx);
  board.updateTask(done.id, { status: 'done', result: 'first report' });
  callTool(board, 'manager', 'followup_task', { task_id: done.id, message: 'continue' }, ctx);
  assert.equal(board.task(done.id).followup.previousResult, 'first report');
});

test('rpc: the stdio board proxy forwards tool calls with the caller identity', async t => {
  const board = new Board(path.join(tmp(t), 'board.json'));
  const rpc = await startRpcServer({ board, roster: ROSTER, chat: true });
  t.after(() => rpc.close());
  const call = (agent, lines) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'lib', 'board-server.mjs')], { env: { ...process.env, ROUTER_URL: rpc.url, ROUTER_TOKEN: rpc.token, AGENT_NAME: agent }, windowsHide: true });
    let out = '';
    child.stdout.on('data', d => {
      out += d;
      if (out.split('\n').filter(Boolean).length >= lines.filter(l => l.id !== undefined).length) child.stdin.end();
    });
    child.on('error', reject);
    child.on('close', () => resolve(out.split('\n').filter(Boolean).map(l => JSON.parse(l)).sort((a, b) => a.id - b.id)));
    for (const l of lines) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...l }) + '\n');
  });
  const [init, list, created] = await call('manager', [
    { id: 1, method: 'initialize', params: {} },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'T', spec: 'S', assignee: 'claude' } } }
  ]);
  assert.equal(init.result.serverInfo.name, 'agent-router-board');
  assert.ok(list.result.tools.some(x => x.name === 'cancel_task'));
  assert.equal(JSON.parse(created.result.content[0].text).id, 'T1');
  assert.equal(board.task('T1').created_by, 'manager');
  const [denied] = await call('claude', [{ id: 1, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'x', assignee: 'zcode' } } }]);
  assert.equal(denied.result.isError, true);
  // 错误 token 被拒
  const r = await fetch(rpc.url, { method: 'POST', headers: { Authorization: 'Bearer nope', 'X-Agent': 'manager' }, body: '{}' });
  assert.equal(r.status, 401);
});

test('scheduler: dependencies, per-agent concurrency, follow-ups, cancel, blocked', async t => {
  const board = new Board(path.join(tmp(t), 'board.json'));
  const gates = new Map(), runs = [];
  const run = (task, agent, { followup, handle }) => new Promise(resolve => {
    runs.push({ id: task.id, followup: !!followup });
    gates.set(task.id, (status = 'done') => { board.updateTask(task.id, { status, followup: null }); resolve(); });
    handle.attach({ pid: 0 });
  });
  const s = new Scheduler({ board, agents: ['claude', 'zcode'], concurrency: { claude: 2, zcode: 1 }, run });
  const blocked = [];
  s.on('blocked', (task, dep) => blocked.push([task.id, dep.id]));
  const mk = (assignee, blocked_by = []) => board.createTask({ title: assignee, assignee, blocked_by }, 'manager').id;
  const a = mk('claude'), b = mk('claude'), c = mk('claude'), z1 = mk('zcode'), z2 = mk('zcode'), dep = mk('claude', [z1]);
  await tick();
  assert.deepEqual(runs.map(r => r.id).sort(), [a, b, z1].sort());     // claude 并发 2、zcode 并发 1
  assert.equal(board.task(c).status, 'pending');
  gates.get(a)(); await until(() => runs.some(r => r.id === c));
  gates.get(z1)(); await until(() => runs.some(r => r.id === z2) && runs.some(r => r.id === dep) || runs.some(r => r.id === z2));
  await until(() => runs.some(r => r.id === z2));
  // 依赖完成后放行（claude 有空位时）
  gates.get(b)(); await until(() => runs.some(r => r.id === dep));
  // 依赖失败 → blocked 事件，任务不启动
  const failing = mk('zcode'), downstream = mk('claude', [failing]);
  gates.get(z2)(); await until(() => runs.some(r => r.id === failing));
  gates.get(failing)('failed'); await until(() => blocked.length === 1);
  assert.deepEqual(blocked[0], [downstream, failing]);
  // 续派：已结束的任务带 followup 再跑一轮（先腾出一个 claude 并发位：c、dep 正占满 2 个）
  board.updateTask(a, { result: 'old report' });
  board.updateTask(a, { followup: { message: 'more' } });
  await tick();
  assert.ok(!runs.some(r => r.id === a && r.followup));
  gates.get(dep)();
  await until(() => runs.some(r => r.id === a && r.followup));
  assert.equal(board.task(a).continuations, 1);
  assert.equal(board.task(a).followup.state, 'running');
  assert.equal(board.task(a).result, null);   // 续派清掉旧报告：harvest 只认本轮输出，否则完成事件永远带旧报告
  // 取消：排队中的直接失败；执行中的打 cancelled 标记
  const busy = mk('zcode'), q = mk('zcode');                         // zcode 并发 1：busy 占位，q 排队
  await until(() => runs.some(r => r.id === busy));
  assert.equal(board.task(q).status, 'pending');
  s.cancel(q, 'no longer needed');
  assert.equal(board.task(q).status, 'failed');
  assert.ok(s.cancel(c).ok);
  assert.equal([...s.active.values()].find(x => x.agent === 'claude' && x.handle.cancelled).handle.reason, 'cancelled');
  for (const g of gates.values()) g();
  await s.drain();
});

function gitRepo(t) {
  const dir = tmp(t);
  const git = (...a) => { const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); };
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-qm', 'init');
  return { dir, git };
}

test('workspace: direct mode never sweeps other tasks\' or pre-existing changes into a task commit', t => {
  const { dir, git } = gitRepo(t);
  const runDir = path.join(tmp(t), 'run');
  fs.writeFileSync(path.join(dir, 'manager-wip.txt'), 'wip');                  // 开始前就有的改动（主代理的）
  const ws = new Workspace({ repo: dir, runDir });
  const A = { id: 'T1', title: 'a', assignee: 'claude' }, B = { id: 'T2', title: 'b', assignee: 'zcode' };
  const ea = ws.prepare(A), eb = ws.prepare(B);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
  // A 先结束，B 还在跑：不归属、不提交
  const ha = ws.harvest(A, ea, { text: 'did a' });
  assert.equal(ha.status, 'done'); assert.equal(ha.result, 'did a');
  assert.match(ha.notes.join(), /uncommitted changes left/);
  assert.equal(git('log', '--oneline').split('\n').length, 1);
  // B 结束时已没有其他任务：兜底提交 B 开始后新变脏、且未在 A 收割时被标为"未归属"的路径——只有 b2.txt。
  // （a.txt / b.txt 在 A 收割时无法判断归属，保持未提交，由主代理处理；子代理按提示会自行提交自己的文件）
  fs.writeFileSync(path.join(dir, 'b2.txt'), 'b2');
  const hb = ws.harvest(B, eb, { text: 'did b' });
  assert.match(hb.notes.join(), /committed 1 file/);
  assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'b2.txt');
  assert.match(git('status', '--porcelain'), /manager-wip\.txt/);
  assert.match(git('status', '--porcelain'), /a\.txt/);
  // 子代理自己提交了的情况下，Router 不再重复提交
  const C = { id: 'T3', title: 'c', assignee: 'claude', result: 'explicit report' };
  const ec = ws.prepare(C);
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c'); git('add', 'c.txt'); git('commit', '-qm', 'c by agent');
  const hc = ws.harvest(C, ec, { text: 'ignored because result is set' });
  assert.equal(hc.result, 'explicit report'); assert.deepEqual(hc.notes, []);
});

test('workspace: isolated tasks merge on success, keep the worktree on failure, and allow no-change tasks', t => {
  const { dir, git } = gitRepo(t);
  const ws = new Workspace({ repo: dir, runDir: path.join(tmp(t), 'run') });
  const ok = { id: 'T1', title: 'ok', assignee: 'claude', isolated: true };
  const e1 = ws.prepare(ok);
  assert.ok(e1.iso && fs.existsSync(e1.wtDir));
  fs.writeFileSync(path.join(e1.wtDir, 'feature.txt'), 'f');
  const h1 = ws.harvest(ok, e1, { text: 'added feature' });
  assert.equal(h1.status, 'done'); assert.match(h1.notes.join(), /merged 1 commit/);
  assert.ok(fs.existsSync(path.join(dir, 'feature.txt'))); assert.ok(!fs.existsSync(e1.wtDir));
  const none = { id: 'T2', title: 'read only', assignee: 'claude', isolated: true };
  const e2 = ws.prepare(none);
  const h2 = ws.harvest(none, e2, { text: 'analysis only' });
  assert.equal(h2.status, 'done'); assert.match(h2.notes.join(), /no code changes/);
  const bad = { id: 'T3', title: 'bad', assignee: 'claude', isolated: true, reported: 'failed', result: 'tests fail' };
  const e3 = ws.prepare(bad);
  fs.writeFileSync(path.join(e3.wtDir, 'half.txt'), 'h');
  const h3 = ws.harvest(bad, e3, {});
  assert.equal(h3.status, 'failed'); assert.equal(h3.keep, e3.wtDir);
  assert.match(git('log', '--format=%s', '-1', e3.branch), /kept for inspection/);
  assert.ok(!fs.existsSync(path.join(dir, 'half.txt')));
});

test('router end-to-end with fake agents: dispatch, report injection, follow-up resume, cancel', async t => {
  const dir = tmp(t);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
  const data = path.join(dir, 'data');
  const fake = path.join(ROOT, 'core', 'test-fake-agents.mjs');
  const child = spawn(process.execPath, [path.join(ROOT, 'router.mjs'), 'please build it', '--chat', '--repo', repo, '--agents', 'claude,zcode', '--data', data],
    { env: { ...process.env, AGENT_ROUTER_TEST_AGENTS: fake }, windowsHide: true });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  t.after(() => { try { child.kill(); } catch {} });
  const thread = () => { try { return fs.readFileSync(path.join(data, 'threads', 'manager.jsonl'), 'utf8'); } catch { return ''; } };
  const board = () => { try { return JSON.parse(fs.readFileSync(path.join(data, 'board.json'), 'utf8')); } catch { return { tasks: [] }; } };
  await until(() => /FINAL: T1 done, T2 done/.test(thread()), 15000).catch(e => { throw new Error(`${e.message}\n${out}\n${thread()}`); });
  const b = board();
  assert.equal(b.tasks.length, 2);
  assert.equal(b.tasks[0].result, 'report from claude for T1');             // 最终回复即报告
  assert.equal(b.tasks[1].status, 'done');
  assert.match(thread(), /已完成。\\n\\n报告：\\nreport from claude for T1/);
  // 续派：直通模式 + 可续接 → resume 原会话，提示词只带新指令
  fs.appendFileSync(path.join(data, 'commands.jsonl'), JSON.stringify({ type: 'message', text: 'followup T1' }) + '\n');
  await until(() => /FINAL: followup done/.test(thread()), 15000).catch(e => { throw new Error(`${e.message}\n${out}\n${thread()}`); });
  const t1 = fs.readFileSync(path.join(data, 'threads', 'T1-claude.jsonl'), 'utf8');
  assert.match(t1, /resumed session sess-T1/);
  assert.match(t1, /The manager asks you to continue task T1/);
  // 续用轮的任务板与完成事件必须是本轮报告（回归：harvest 的旧 result 短路曾让事件永远带旧报告）
  assert.equal(board().tasks.find(x => x.id === 'T1')?.result, 'follow-up report from claude for T1');
  assert.match(thread(), /报告：\\nfollow-up report from claude for T1/);
  // 取消：长任务被终止并标记失败
  fs.appendFileSync(path.join(data, 'commands.jsonl'), JSON.stringify({ type: 'message', text: 'slow task' }) + '\n');
  await until(() => board().tasks.some(x => x.id === 'T3' && x.status === 'in_progress'), 15000);
  fs.appendFileSync(path.join(data, 'commands.jsonl'), JSON.stringify({ type: 'cancel', task_id: 'T3' }) + '\n');
  await until(() => board().tasks.find(x => x.id === 'T3')?.status === 'failed', 15000).catch(e => { throw new Error(`${e.message}\n${out}`); });
  await until(() => /已取消/.test(thread()), 5000);
  // 切换主代理：当前回合结束后换成新会话，并收到之前的对话与任务板作为交接
  fs.appendFileSync(path.join(data, 'commands.jsonl'), JSON.stringify({ type: 'switch_main', main: 'zcode' }) + '\n');
  await until(() => /主代理已从 Fake Claude 切换为 Fake ZCode/.test(thread()), 5000).catch(e => { throw new Error(`${e.message}\n${out}`); });
  assert.match(thread(), /<previous_conversation>[\s\S]*User: please build it[\s\S]*<task_board>[\s\S]*T1 \[done\] part one/);
  await until(() => JSON.parse(fs.readFileSync(path.join(data, 'status.json'), 'utf8')).main === 'zcode', 5000);
});

const CODEX_EXE = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const hasCodex = !!process.env.AGENT_ROUTER_CODEX_EXE || fs.existsSync(CODEX_EXE);
test('router with a chat-only model as main agent: Codex drives it through the gateway; subagents can consult it', { skip: !hasCodex && 'Codex CLI not installed', timeout: 120000 }, async t => {
  const dir = tmp(t);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'README.md'), 'HELLO README');
  const data = path.join(dir, 'data');
  const runConfig = path.join(dir, 'run-config.json');
  fs.writeFileSync(runConfig, JSON.stringify({ llm: { brain: { label: 'Fake Brain', module: path.join(ROOT, 'core', 'test-fake-llm.mjs') } }, consult: 'brain' }));
  const child = spawn(process.execPath, [path.join(ROOT, 'router.mjs'), 'design it', '--chat', '--main', 'brain', '--repo', repo, '--agents', 'claude', '--data', data],
    { env: { ...process.env, AGENT_ROUTER_TEST_AGENTS: path.join(ROOT, 'core', 'test-fake-agents.mjs'), AGENT_ROUTER_RUN_CONFIG: runConfig }, windowsHide: true });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  const thread = () => { try { return fs.readFileSync(path.join(data, 'threads', 'manager.jsonl'), 'utf8'); } catch { return ''; } };
  await until(() => /FINAL: chat main got/.test(thread()), 90000).catch(async e => { await killTree(child); throw new Error(`${e.message}\n${out}\n${thread()}`); });
  assert.match(thread(), /FINAL: chat main got the consult answer/);
  // Codex 自己的工具执行了命令，任务经 board MCP 派出
  const entries = thread().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const tools = entries.filter(e => e.kind === 'tool_use').map(e => e.data.name);
  assert.ok(tools.includes('shell') && tools.includes('board.create_task'), tools.join(','));
  const board = JSON.parse(fs.readFileSync(path.join(data, 'board.json'), 'utf8'));
  assert.equal(board.tasks[0].result, 'report from claude for T1; consulted: ADVICE-42');
  const status = JSON.parse(fs.readFileSync(path.join(data, 'status.json'), 'utf8'));
  assert.equal(status.main, 'brain');
  assert.ok(status.sessionId);
  assert.ok(fs.existsSync(path.join(data, 'codex-home', 'catalog.json')));
  await killTree(child); // 先停掉 Router 和它启动的 Codex，临时目录才能删除
});

test('spawnCollect: prompt travels over stdin, well past the Windows 32k argv limit', async t => {
  const big = `${'x'.repeat(120000)}结尾中文`;
  const r = await spawnCollect(process.execPath, ['-e', 'let b="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>process.stdout.write(String(b.length)))'], { input: big, timeoutMs: 15000 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), String(big.length));
});

test('router --resume must not replay consumed commands (offset counts chars, not bytes)', async t => {
  const dir = tmp(t);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  // 历史命令带中文：statSync().size（字节）> 字符数，单位错位会把偏移归零、启动即重放旧消息
  fs.writeFileSync(path.join(data, 'commands.jsonl'), `${JSON.stringify({ type: 'message', text: '旧的中文消息' })}\n`);
  const child = spawn(process.execPath, [path.join(ROOT, 'router.mjs'), '新目标', '--chat', '--repo', repo, '--agents', 'claude', '--data', data, '--resume'],
    { env: { ...process.env, AGENT_ROUTER_TEST_AGENTS: path.join(ROOT, 'core', 'test-fake-agents.mjs') }, windowsHide: true });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  t.after(() => { try { child.kill(); } catch {} });
  const thread = () => { try { return fs.readFileSync(path.join(data, 'threads', 'manager.jsonl'), 'utf8'); } catch { return ''; } };
  await until(() => /新目标/.test(thread()), 15000).catch(e => { throw new Error(`${e.message}\n${out}\n${thread()}`); });
  assert.ok(!/旧的中文消息/.test(thread()), '历史命令被重放了');
  // resume 之后的新命令仍要正常消费
  fs.appendFileSync(path.join(data, 'commands.jsonl'), `${JSON.stringify({ type: 'message', text: '追加的新消息' })}\n`);
  await until(() => /追加的新消息/.test(thread()), 15000).catch(e => { throw new Error(`${e.message}\n${out}\n${thread()}`); });
});
