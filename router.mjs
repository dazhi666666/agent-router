#!/usr/bin/env node
// Agent Router — 本地多 Agent 协作调度器（主代理 + 子代理）。
//
// 一次运行 = 一个 Router 进程：
//   core/board.mjs      任务板（内存中的唯一状态源，board.json 只是快照）
//   core/rpc.mjs        本地 RPC 端点；各 agent 的 board MCP 代理（lib/board-server.mjs）把工具调用转发到这里
//   core/scheduler.mjs  事件驱动的派发：依赖、每 agent 并发上限、续派、取消
//   core/workspace.mjs  任务工作区：直通 / 独立 worktree 的准备与收割
//   chat-agent/         只能对话的模型（无原生工具调用）：作为主代理（文本工具协议）或 consult 顾问工具
//   本文件              参数、主代理会话、子代理会话执行、事件注入、Web 命令通道
//
// 主代理（--main，默认 claude）常驻：它用 create_task 派活（非阻塞），子代理完成/失败时
// Router 把完整报告作为 [事件] 注入主会话。子代理的生命周期由 Router 掌管：会话启动即 in_progress，
// 正常结束即 done，最终回复即报告。
//
// 用法:
//   node router.mjs "<消息或总目标>" [--chat] [--repo <dir>] [--agents claude,zcode] [--main claude]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Board } from './core/board.mjs';
import { startRpcServer } from './core/rpc.mjs';
import { Scheduler } from './core/scheduler.mjs';
import { Workspace } from './core/workspace.mjs';
import { loadConfig } from './lib/config.mjs';
import { runClaude } from './lib/claude.mjs';
import { runZcode } from './lib/zcode.mjs';
import { runDevin } from './lib/devin.mjs';
import { runCodex } from './lib/codex.mjs';
import { runOpencode } from './lib/opencode.mjs';
import { runAntigravity } from './lib/antigravity.mjs';
import { boardMcpEntry, setBoardEndpoint } from './lib/spawn-util.mjs';
import { MainSession } from './lib/claude-main.mjs';
import { OneShotMainSession } from './lib/oneshot-main.mjs';
import { AcpMainSession } from './lib/acp-main.mjs';
import { AgyMainSession } from './lib/agy-main.mjs';
import { createThreadWriter } from './lib/thread.mjs';
import { managerMainPrompt, managerChatPrompt, goalMessage, handoffMessage, subagentPrompt, subagentFollowupPrompt, subagentResumePrompt } from './lib/prompts.mjs';
import { hasPendingChanges, protectLocalExcludes } from './lib/worktree.mjs';
import { toolsFor, callTool } from './core/tools.mjs';
import { ChatAgentSession, createProvider, createFsTools, createConsult, consultSchema } from './chat-agent/index.mjs';

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHAT_IDLE_EXIT_MIN = 30;   // 对话模式：无任务在跑且主代理空闲这么久后，进程退出休眠（下条消息 --resume 恢复）
const REPORT_LIMIT = 4000;       // 注入主会话的子代理报告上限（完整内容在任务板上）
const C = { dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m` };

// ---------- 参数 ----------
function parseArgs(argv) {
  const args = { agents: 'claude,zcode', main: 'claude', timeout: 900, repo: null, data: null, worktree: false, chat: false, resume: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--agents') args.agents = argv[++i];
    else if (a === '--main') args.main = argv[++i];
    else if (a === '--timeout') args.timeout = parseInt(argv[++i], 10);
    else if (a === '--data') args.data = argv[++i];
    else if (a === '--worktree') args.worktree = true;
    else if (a === '--chat') args.chat = true;
    else if (a === '--resume') args.resume = true;
    else if (a === '--max-rounds') i++; // 已废弃，兼容旧调用
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else positional.push(a);
  }
  args.goal = positional.join(' ').trim();
  return args;
}

function printHelp() {
  console.log(`Agent Router — 本地多 Agent 协作调度器

主代理常驻主线程，和你对话；需要时用 create_task 把工作派给子代理并行执行，
子代理完成后完整报告自动回到主代理。

用法:
  node router.mjs "<消息>" --chat [选项]      对话模式（推荐）：像 Claude Code 一样聊天
  node router.mjs "<总目标>" [选项]           目标模式：拆解目标，完成后 finish_run 结束

选项:
  --repo <dir>        工作目录（默认 ./demo/todo-cli；不要求是 git 仓库，但隔离模式需要 git）
  --agents <list>     子代理，逗号分隔（默认 claude,zcode；可选 devin,codex,opencode,antigravity）
  --main <agent>      主代理（默认 claude；可选 zcode/devin/codex/opencode/antigravity，
                      或 router.config.json 里 llm 下配置的对话模型名）
  --timeout <sec>     单个子代理会话超时（默认 900）
  --data <dir>        运行数据目录（默认 ./data/run-<时间戳>）
  --worktree          所有任务都在独立 git worktree 中执行，完成后合并（默认直通：在工作目录里直接并行，
                      create_task 传 isolated:true 可让单个任务隔离）
  --chat              对话模式：不需要 finish_run，空闲 ${CHAT_IDLE_EXIT_MIN} 分钟后休眠
  --resume            与 --data 搭配：续接该目录里上次的主代理会话
每个 agent 的并发上限见 router.config.json 的 maxConcurrent。`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.goal) {
  printHelp();
  console.error('\n缺少消息。例: node router.mjs "给 todo-cli 加优先级排序功能" --chat');
  process.exit(2);
}

const RUNNERS = {
  claude: { run: runClaude, label: 'Claude Code', resumable: true },
  zcode: { run: runZcode, label: 'ZCode', resumable: true },
  devin: { run: opts => runDevin({ ...opts, boardMcp: boardMcpEntry({ agentName: opts.agentName }) }), label: 'Devin', resumable: false },
  codex: { run: runCodex, label: 'Codex CLI', resumable: true },
  opencode: { run: runOpencode, label: 'OpenCode', resumable: true },
  antigravity: { run: runAntigravity, label: 'Antigravity', resumable: false }
};
// 测试钩子：AGENT_ROUTER_TEST_AGENTS 指向一个模块，用假的子代理 runner / 主代理会话替换真实 CLI（见 core/test-fake-agents.mjs）
let TestMainSession = null;
if (process.env.AGENT_ROUTER_TEST_AGENTS) {
  const fake = (await import(pathToFileURL(process.env.AGENT_ROUTER_TEST_AGENTS).href)).default;
  Object.assign(RUNNERS, fake.runners);
  TestMainSession = fake.MainSession;
}
const CFG = loadConfig();
// 只能对话的模型（chat-agent/）：只能当主代理或 consult 顾问，不能当子代理
const isChatModel = name => !RUNNERS[name] && !!CFG.llm[name];
const isMainAgent = name => !!RUNNERS[name] || isChatModel(name);
const agentLabel = name => RUNNERS[name]?.label || CFG.llm[name]?.label || CFG.llm[name]?.model || name;
const agentNames = [...new Set(args.agents.split(',').map(s => s.trim()).filter(Boolean))];
for (const name of agentNames) {
  if (!RUNNERS[name]) { console.error(`未知子代理: ${name}（可选: ${Object.keys(RUNNERS).join(', ')}）`); process.exit(2); }
}
if (!isMainAgent(args.main)) { console.error(`未知主代理: ${args.main}（可选: ${[...Object.keys(RUNNERS), ...Object.keys(CFG.llm)].join(', ')}）`); process.exit(2); }
const managerDescription = main => isChatModel(main)
  ? `Main agent (${agentLabel(main)}, chat model): talks to the user, plans, delegates and reviews; it cannot edit files or run commands itself.`
  : `Main agent (${agentLabel(main)}): talks to the user, delegates and coordinates tasks, and does tasks assigned to "manager" itself.`;
const ROSTER = [
  { name: 'manager', description: managerDescription(args.main) },
  ...agentNames.map(n => ({ name: n, description: `Subagent (${RUNNERS[n].label}): implements a task spec in the working directory, verifies it, and reports back.` }))
];

const repo = path.resolve(args.repo || path.join(PROJECT_ROOT, 'demo', 'todo-cli'));
if (!fs.existsSync(repo)) { console.error(`工作目录不存在: ${repo}`); process.exit(2); }
const runDir = args.data ? path.resolve(args.data) : path.join(PROJECT_ROOT, 'data', `run-${Date.now()}`);
const logDir = path.join(runDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });

const workspace = new Workspace({ repo, runDir, worktreeAll: args.worktree });
if (args.worktree && !workspace.git) { console.error(`${repo} 不是 git 仓库：--worktree 需要 git`); process.exit(2); }
if (workspace.git) protectLocalExcludes(repo); // 运行时注入的 .zcode/、.agents/mcp_config.json 不进提交

const log = (...m) => console.log(...m);
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const oneLine = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- 运行状态 ----------
const board = new Board(path.join(runDir, 'board.json'));
let mainSession = null;
let shuttingDown = false;
let lastActiveAt = Date.now();
let lastNudgeAt = 0, nudgeCount = 0;
const noteActivity = () => { lastActiveAt = Date.now(); };

// 主代理状态（runDir/status.json，供 Web 展示；sessionId 供 --resume 续接）
const runStatus = { main: args.main, session: 'starting', busy: false, turns: 0, cost: 0, currentTool: null, restarts: 0, sessionId: null, updatedAt: null };
function writeStatus() {
  runStatus.updatedAt = new Date().toISOString();
  if (mainSession?.sessionId) runStatus.sessionId = mainSession.sessionId;
  try {
    const tmp = path.join(runDir, 'status.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(runStatus));
    fs.renameSync(tmp, path.join(runDir, 'status.json'));
  } catch {}
}

/** 给主代理推送事件（[事件]/[信箱] 前缀供主代理与界面识别） */
function pushEvent(text) {
  noteActivity();
  log(C.dim(`  ${oneLine(text, 180)}`));
  mainSession?.send(text);
}

// ---------- 子代理执行 ----------
async function runAgentSession({ agentName, prompt, cwd, taskRef, onChild, resumeSessionId }) {
  const name = `${taskRef.replace(/[^\w.-]/g, '_')}-${agentName}`;
  const thread = createThreadWriter(path.join(runDir, 'threads', `${name}.jsonl`));
  thread.add('user', { text: prompt });
  const started = Date.now();
  let textOut = '';
  try {
    const res = await RUNNERS[agentName].run({
      prompt, cwd, agentName, roster: ROSTER, dataFile: board.file, logDir: runDir,
      timeoutMs: args.timeout * 1000,
      onText: t => { textOut += t; },
      onChild, threadPath: thread.path, resumeSessionId
    });
    fs.writeFileSync(path.join(logDir, `${name}.log`), textOut || '(无文本输出)', 'utf8');
    log(C.dim(`[${stamp()}] ■ ${taskRef} (${agentName}) 会话结束，用时 ${Math.round((Date.now() - started) / 1000)}s`));
    return { ...res, text: res?.text || textOut };
  } catch (e) {
    fs.writeFileSync(path.join(logDir, `${name}.log`), `ERROR: ${e.message}\n\n${textOut}`, 'utf8');
    thread.add('result', { text: `会话异常结束: ${e.message}`, isError: true });
    return { error: e.message, text: textOut };
  }
}

/** 执行一个任务（或一次续派）：准备工作区 → 跑会话 → 收割 → 通知主代理 */
async function runTask(task, agentName, { followup, round, handle }) {
  let env;
  try { env = workspace.prepare(task, { round }); }
  catch (e) {
    board.updateTask(task.id, { status: 'failed', result: `Router could not prepare the workspace: ${e.message}`, followup: null });
    pushEvent(`[事件] 任务 ${task.id}「${task.title}」（${agentName}）失败：无法准备工作区（${e.message}）。`);
    return;
  }
  // 续派：工作目录没变（直通模式）且该 CLI 支持续接时，resume 原会话；否则开新会话并注入原任务上下文
  const resume = followup && !env.iso && RUNNERS[agentName].resumable && task.last_session_id;
  const prompt = !followup
    ? subagentPrompt({ task, agentName, workspace: env.cwd, isWorktree: env.iso, isGit: workspace.git })
    : resume
      ? subagentResumePrompt({ task, message: followup.message })
      : subagentFollowupPrompt({ task, agentName, workspace: env.cwd, message: followup.message, previousResult: task.result, isGit: workspace.git });
  log(C.dim(`[${stamp()}] ▶ ${task.id}「${task.title}」→ ${agentName}${followup ? `（续派 #${round}${resume ? ' · resume' : ''}）` : ''}${env.iso ? ` · worktree ${path.basename(env.wtDir)}` : ''}`));
  const res = await runAgentSession({ agentName, prompt, cwd: env.cwd, taskRef: task.id, onChild: child => handle.attach(child), resumeSessionId: resume ? task.last_session_id : null });

  const latest = board.task(task.id);
  const h = workspace.harvest(latest, env, { error: res.error, cancelled: handle.cancelled, text: res.text });
  board.updateTask(task.id, {
    status: h.status, result: h.result, reported: null, followup: null,
    last_session_id: res.sessionId || latest.last_session_id || null,
    worktree: h.keep || null, branch: h.keep ? env.branch : null, notes: h.notes
  });
  log(h.status === 'done' ? C.green(`  ✔ ${task.id} 完成${h.notes.length ? `（${h.notes.join('；')}）` : ''}`) : C.yellow(`  ✗ ${task.id} 失败：${oneLine(h.result, 120)}`));
  const report = h.result.length > REPORT_LIMIT ? `${h.result.slice(0, REPORT_LIMIT)}\n…（报告已截断，完整内容用 get_task("${task.id}") 查看）` : h.result;
  const notes = h.notes.length ? `\n\n备注：${h.notes.join('；')}` : '';
  if (handle.cancelled) pushEvent(`[事件] 任务 ${task.id}「${task.title}」（${agentName}）已取消（${handle.reason || 'cancelled'}）。${notes}`);
  else if (h.status === 'done') pushEvent(`[事件] 任务 ${task.id}「${task.title}」（${agentName}）已完成。\n\n报告：\n${report}${notes}`);
  else pushEvent(`[事件] 任务 ${task.id}「${task.title}」（${agentName}）失败。\n\n${report}${notes}`);
}

const concurrency = Object.fromEntries(agentNames.map(n => [n, CFG[n]?.maxConcurrent ?? 1]));
const scheduler = new Scheduler({ board, agents: agentNames, concurrency, run: runTask });
scheduler.on('started', (t, f) => { noteActivity(); if (!f) log(`  ↳ ${t.id}「${t.title}」开始执行（${t.assignee}）`); });
scheduler.on('queued', t => log(C.dim(`  … ${t.id} 排队：${t.assignee} 已达并发上限 ${concurrency[t.assignee]}`)));
scheduler.on('blocked', (t, dep) => pushEvent(`[事件] 任务 ${t.id}「${t.title}」无法开始：依赖的任务 ${dep.id} 失败了。请修复依赖后用 followup_task 重做 ${dep.id}，或 cancel_task 取消 ${t.id}。`));
scheduler.on('error', (e, t) => log(C.red(`  调度异常（${t.id}）: ${e.stack || e.message}`)));

// 子代理 → 主代理的消息即时注入
board.on('message', m => {
  if (m.to !== 'manager' && m.to !== '*') return;
  if (m.from === 'manager') return;
  board.inbox('manager'); // 注入即视为已读
  pushEvent(`[信箱] 来自 ${m.from}${m.task_id ? ` · 任务 ${m.task_id}` : ''}：\n${m.content}`);
});

// ---------- Web 命令通道（commands.jsonl：消息 / 取消 / 重试 / 模型切换） ----------
let cmdOffset = 0;
function pumpCommands() {
  const f = path.join(runDir, 'commands.jsonl');
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return; }
  if (txt.length < cmdOffset) cmdOffset = 0;
  let rest = txt.slice(cmdOffset);
  const cut = rest.lastIndexOf('\n');
  if (cut === -1) return;
  rest = rest.slice(0, cut + 1);
  cmdOffset += rest.length;
  for (const line of rest.split('\n')) {
    if (!line.trim()) continue;
    try { handleCommand(JSON.parse(line)); } catch {}
  }
}
function handleCommand(cmd) {
  if (shuttingDown) return;
  if (cmd.type === 'models_changed') return mainSession.requestModelReload();
  if (cmd.type === 'switch_main' && isMainAgent(cmd.main)) { pendingMain = cmd.main; return trySwitchMain(); }
  if (cmd.type === 'message' && cmd.text) {
    if (cmd.to && cmd.to !== 'manager') {           // 给某个子代理留言
      board.sendMessage({ from: 'user', to: cmd.to, content: String(cmd.text), task_id: cmd.task_id ?? null });
      return;
    }
    log(C.cyan(`[用户 → manager] ${oneLine(cmd.text, 200)}`));
    noteActivity();
    mainSession.send(args.chat ? String(cmd.text) : `[用户] ${cmd.text}`);
  } else if (cmd.type === 'cancel' && cmd.task_id) {
    const r = scheduler.cancel(cmd.task_id, 'cancelled by the user');
    log(C.yellow(`  ⚡ 用户取消 ${cmd.task_id}: ${r.error || 'ok'}`));
  } else if (cmd.type === 'retry' && cmd.task_id) {
    const t = board.task(cmd.task_id);
    if (t?.status !== 'failed' || scheduler.active.has(t.id)) return;
    board.updateTask(t.id, { status: 'pending', result: null, notes: [] });
    pushEvent(`[事件] 任务 ${t.id}「${t.title}」已由用户要求重试，重新派给 ${t.assignee}。`);
  }
}

// ---------- 目标模式：空闲提醒；对话模式：空闲休眠 ----------
function idleCheck() {
  if (shuttingDown || !mainSession || mainSession.busy || !scheduler.idle()) { if (!scheduler.idle()) noteActivity(); return; }
  const idleMs = Date.now() - lastActiveAt;
  if (args.chat) {
    if (idleMs < CHAT_IDLE_EXIT_MIN * 60 * 1000) return;
    log(C.dim(`[${stamp()}] 对话空闲 ${CHAT_IDLE_EXIT_MIN} 分钟，进入休眠（发送新消息会自动恢复会话）`));
    runStatus.session = 'sleeping'; writeStatus();
    return shutdown(0);
  }
  if (board.finished || idleMs < 3 * 60 * 1000 || Date.now() - lastNudgeAt < 3 * 60 * 1000 || nudgeCount >= 6) return;
  lastNudgeAt = Date.now(); nudgeCount++;
  const lines = board.tasks.map(t => `${t.id}[${t.status}] ${t.title}`).join('；') || '（任务板为空）';
  pushEvent(`[事件] 会话已空闲 ${Math.round(idleMs / 60000)} 分钟且没有正在执行的任务。当前任务板：${lines}。若总目标已达成，请调用 finish_run 结束；否则继续推进。`);
}

// ---------- 收尾 ----------
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  await scheduler.drain();                       // 等在跑的任务结束并收割
  while (mainSession?.busy) await new Promise(r => setTimeout(r, 500));
  try { mainSession?.stop(); } catch {}
  printSummary();
  process.exit(code);
}
board.on('finished', () => {
  if (args.chat) return;
  log(C.cyan(`\n[${stamp()}] manager 调用 finish_run，等待 ${scheduler.active.size} 个在跑任务后收尾…`));
  shutdown(0);
});

function printSummary() {
  if (board.finished?.summary) { log('\n' + C.b('══ manager 结束总结 ══')); log(board.finished.summary); }
  if (!board.tasks.length) return;
  log('\n' + C.b('════════ 任务汇总 ════════'));
  for (const t of board.tasks) {
    const icon = t.status === 'done' ? C.green('✔') : t.status === 'failed' ? C.red('✗') : C.yellow('•');
    log(`${icon} [${t.status}] ${C.b(t.id)} ${t.title} → ${t.assignee}`);
    if (t.result) log(C.dim(`    ${t.result.slice(0, 220).replace(/\n/g, '\n    ')}`));
  }
  log(C.dim(`\n运行数据: ${runDir}`));
}

// ---------- 主代理 ----------
const managerThread = path.join(runDir, 'threads', 'manager.jsonl');
let rpcCtx = null; // 任务板工具上下文（main() 里建立）：RPC 端点与对话模型主代理共用

/** 对话模型主代理：Router 代它执行文本协议里的工具调用（任务板工具 + 只读文件工具） */
function createChatMain(opts) {
  const name = args.main;
  const fsTools = createFsTools(repo);
  const thread = createThreadWriter(managerThread);
  return new ChatAgentSession({
    provider: () => createProvider(loadConfig().llm[name], { baseDir: PROJECT_ROOT }), // 每回合重读配置
    systemPrompt: opts.systemPrompt,
    tools: [...toolsFor('manager', rpcCtx), ...fsTools.tools],
    invoke: (tool, input) => {
      rpcCtx.onCall('manager', tool, input);
      return fsTools.has(tool) ? fsTools.invoke(tool, input) : callTool(board, 'manager', tool, input, rpcCtx);
    },
    stateDir: path.join(runDir, 'chat-sessions'),
    resumeId: opts.resumeId,
    onEntry: (kind, data) => thread.add(kind, data),
    onText: opts.onText, onTool: opts.onTool, onTurnEnd: opts.onTurnEnd, onNotice: opts.onNotice
  });
}

function createMainSession(resumeId = null) {
  const opts = {
    resumeId, cwd: repo, agentName: 'manager', roster: ROSTER, dataFile: board.file, logDir, threadPath: managerThread,
    systemPrompt: (args.chat ? managerChatPrompt : managerMainPrompt)({ roster: ROSTER, repo, directMode: !args.worktree, gitMode: workspace.git, readOnly: isChatModel(args.main) }),
    onText: t => { noteActivity(); runStatus.session = 'online'; runStatus.busy = true; writeStatus(); log(C.cyan(`[manager] ${oneLine(t, 400)}`)); },
    onTool: name => { noteActivity(); runStatus.busy = true; runStatus.currentTool = name; writeStatus(); },
    onTurnEnd: ev => {
      noteActivity();
      Object.assign(runStatus, { session: 'online', busy: false, currentTool: null, turns: runStatus.turns + 1 });
      if (ev?.total_cost_usd != null) runStatus.cost = ev.total_cost_usd;
      writeStatus();
      trySwitchMain();
    },
    onNotice: m => {
      log(C.yellow(`[manager] ${m}`));
      if (/续命重启|无输出|重建|回合失败/.test(m)) { runStatus.session = 'restarting'; runStatus.restarts++; }
      else if (/放弃重启|未登录|未找到/.test(m)) runStatus.session = 'dead';
      else if (/已重建|已重启|已启动/.test(m)) runStatus.session = 'online';
      writeStatus();
    }
  };
  if (isChatModel(args.main)) return createChatMain(opts);
  if (TestMainSession) return new TestMainSession(opts);
  if (args.main === 'claude') return new MainSession(opts);
  if (args.main === 'devin') return new AcpMainSession(opts);
  if (args.main === 'antigravity') return new AgyMainSession(opts);
  return new OneShotMainSession({ kind: args.main, ...opts });
}

/** 读主代理线程，供换主代理时交接 */
function readManagerThread() {
  try { return fs.readFileSync(managerThread, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}

/** 换主代理：不同 CLI 的会话不能互相续接，新主代理开新会话，并收到之前的对话记录与任务板作为交接 */
function startHandoffSession(from, extra = '') {
  ROSTER[0].description = managerDescription(args.main);
  runStatus.main = args.main; runStatus.sessionId = null; runStatus.session = 'starting';
  mainSession = createMainSession(null);
  mainSession.start();
  mainSession.send(handoffMessage({ from: agentLabel(from), to: agentLabel(args.main), entries: readManagerThread(), tasks: board.tasks, next: extra }));
  writeStatus();
}

// 用户在运行中切换主代理：等当前回合结束再换，子代理任务不受影响
let pendingMain = null;
function trySwitchMain() {
  if (!pendingMain || !mainSession || mainSession.busy) return;
  const next = pendingMain, from = args.main;
  pendingMain = null;
  if (next === from) return;
  log(C.cyan(`[${stamp()}] 主代理切换：${agentLabel(from)} → ${agentLabel(next)}`));
  try { mainSession.stop(); } catch {}
  args.main = next;
  startHandoffSession(from);
}

async function main() {
  log(C.b(`Agent Router（${args.chat ? '对话模式' : '目标模式'}）`), C.dim(`${args.chat ? '消息' : '目标'}: ${oneLine(args.goal, 200)}`));
  log(C.dim(`工作目录: ${repo} · 主代理: ${agentLabel(args.main)} · 子代理: ${agentNames.map(n => `${n}×${concurrency[n]}`).join(', ') || '(无)'} · ${args.worktree ? '全部隔离（worktree）' : `直通${workspace.git ? '（git）' : '（非 git 目录）'}`} · 数据: ${runDir}`));
  if (workspace.git && hasPendingChanges(repo)) log(C.yellow('  ⚠ 工作目录有未提交改动：子代理只提交自己改的文件，这些改动会保留原样。'));

  // consult：所有 agent 都能向配置的对话模型请教（主代理就是该模型时不提供给主代理）
  const extra = {};
  if (CFG.consult && CFG.llm[CFG.consult]) {
    const consult = createConsult({ provider: () => createProvider(loadConfig().llm[CFG.consult], { baseDir: PROJECT_ROOT }), root: repo });
    extra.consult = { ...consultSchema(agentLabel(CFG.consult)), for: caller => !(caller === 'manager' && args.main === CFG.consult), call: (caller, input) => consult(input, caller) };
    log(C.dim(`consult 顾问: ${agentLabel(CFG.consult)}`));
  } else if (CFG.consult) log(C.yellow(`  ⚠ consult 指向的对话模型 "${CFG.consult}" 未在 llm 中配置，已忽略`));
  rpcCtx = {
    board, roster: ROSTER, chat: args.chat, extra,
    cancel: (id, reason) => scheduler.cancel(id, reason),
    onCall: (caller, name, input) => { noteActivity(); log(C.dim(`  [${caller}] ⚙ ${name} ${oneLine(JSON.stringify(input), 120)}`)); }
  };
  const rpc = await startRpcServer(rpcCtx);
  setBoardEndpoint(rpc);

  // 续接：进程内的执行状态不持久，上次中断时"执行中"的任务标记失败，未开始的续派请求重新排队
  for (const t of board.tasks) {
    if (t.status === 'in_progress' && t.assignee !== 'manager') board.updateTask(t.id, { status: 'failed', result: `${t.result ? `${t.result}\n\n` : ''}Interrupted: the router stopped while this task was running.`, followup: null });
    else if (t.followup?.state === 'running') board.updateTask(t.id, { followup: { ...t.followup, state: undefined } });
  }

  // --resume：同一个主代理 CLI 则续接原会话；用户在休眠期间换了主代理则交接给新会话
  let prev = null;
  if (args.resume) { try { prev = JSON.parse(fs.readFileSync(path.join(runDir, 'status.json'), 'utf8')); } catch {} }
  const prevMain = prev?.main || args.main;
  if (args.resume && prevMain !== args.main) {
    log(C.dim(`主代理已从 ${prevMain} 换成 ${args.main}：开新会话并交接之前的对话`));
    startHandoffSession(prevMain, args.goal);
  } else {
    const resumeId = args.resume ? prev?.sessionId || null : null;
    if (args.resume) log(C.dim(resumeId ? `续接主代理会话 ${resumeId}` : '没有可续接的会话 id，开启新会话'));
    mainSession = createMainSession(resumeId);
    mainSession.start();
    mainSession.send(args.chat ? args.goal : goalMessage({ goal: args.goal, roster: ROSTER }));
    writeStatus();
  }
  scheduler.kick();

  setInterval(() => { try { pumpCommands(); idleCheck(); } catch (e) { log(C.red(`tick 异常: ${e.message}`)); } }, 500);

  let sigints = 0;
  process.on('SIGINT', () => {
    if (++sigints > 1) process.exit(1);
    log('\n收到中断，正在停止（再按一次强制退出）…');
    for (const id of scheduler.active.keys()) scheduler.cancel(id, 'router interrupted');
    try { mainSession?.stop(); } catch {}
    setTimeout(() => process.exit(1), 3000).unref();
  });
}

main().catch(e => {
  console.error(C.red(`Router 异常退出: ${e.stack || e.message}`));
  process.exit(1);
});
