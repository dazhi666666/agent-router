#!/usr/bin/env node
// Agent Router — 事件驱动的多 Agent 协作调度器（主代理模式）。
//
// 主代理（--main 指定，默认 claude）以「主线程」身份常驻（lib/claude-main.mjs /
// lib/acp-main.mjs / lib/oneshot-main.mjs）：
//   - 它在任务板上 create_task 派活，Router 自动把任务派给子代理（独立 worktree）；
//   - 派活非阻塞，主代理派完继续干自己的事；
//   - 子代理的动向（完成/失败/留言）由 Router 实时注入主会话，主代理随时响应；
//   - 主代理可用 followup_task 指定某个子代理带着原任务上下文继续，也可以确认目标
//     达成后调用 finish_run，Router 收尾退出。
//
// 通信方式（方式一）: 所有 agent 以 MCP client 身份挂同一个本地任务板 server，
// 任务与消息都落在同一份 JSON 文件里；agent 之间不直连，全部经任务板中转。
//
// 用法:
//   node router.mjs "<总目标>" [--repo <dir>] [--agents claude,zcode] [--timeout 900]
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { read, mutate } from './lib/store.mjs';
import { runClaude } from './lib/claude.mjs';
import { runZcode } from './lib/zcode.mjs';
import { runDevin } from './lib/devin.mjs';
import { runCodex } from './lib/codex.mjs';
import { runOpencode } from './lib/opencode.mjs';
import { runAntigravity } from './lib/antigravity.mjs';
import { boardMcpEntry } from './lib/spawn-util.mjs';
import { MainSession } from './lib/claude-main.mjs';
import { OneShotMainSession } from './lib/oneshot-main.mjs';
import { AcpMainSession } from './lib/acp-main.mjs';
import { AgyMainSession } from './lib/agy-main.mjs';
import { createThreadWriter } from './lib/thread.mjs';
import { managerMainPrompt, goalMessage, subagentPrompt, subagentFollowupPrompt } from './lib/prompts.mjs';
import { isGitRepo, createWorktree, mergeWorktree, removeWorktree, dropBranch, hasPendingChanges, commitAll, commitCount, protectLocalExcludes } from './lib/worktree.mjs';

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const C = { dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m` };

// ---------- args ----------
function parseArgs(argv) {
  const args = { agents: 'claude,zcode', main: 'claude', 'max-rounds': 3, timeout: 900, repo: null, data: null, worktree: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--agents') args.agents = argv[++i];
    else if (a === '--main') args.main = argv[++i];
    else if (a === '--max-rounds') args['max-rounds'] = parseInt(argv[++i], 10); // 兼容保留，事件驱动模式下不再使用
    else if (a === '--timeout') args.timeout = parseInt(argv[++i], 10);
    else if (a === '--data') args.data = argv[++i];
    else if (a === '--worktree') args.worktree = true; // 旧隔离并行模式：每任务一个 worktree
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else positional.push(a);
  }
  args.goal = positional.join(' ').trim();
  return args;
}

function printHelp() {
  console.log(`Agent Router — 本地多 Agent 协作调度器（主代理模式）

Claude Code 作为主代理常驻主线程：拆解目标、派发任务、处理子代理留言、也可亲自写代码；
子代理（subagent，claude / zcode / devin）在独立 worktree 中执行任务，主代理可用
followup_task 指定某个子代理带着原任务上下文继续。
派活非阻塞、事件实时推送、主代理调用 finish_run 结束运行。

用法:
  node router.mjs "<总目标>" [选项]

选项:
  --repo <dir>        目标工作目录（默认 ./demo/todo-cli；直通模式不要求是 git 仓库，
                      非 git 目录无提交/合并/回滚；--worktree 隔离模式需要 git）
  --agents <list>     参与的子代理，逗号分隔（默认 claude,zcode；可选 devin,codex,opencode,antigravity）
  --main <agent>      主代理使用的 CLI（默认 claude；可选 zcode/devin/codex/opencode/antigravity）。
                      claude: stream-json 常驻主线程（事件即时注入，体验最佳）；
                      antigravity: agy stream-json 常驻主线程（需已登录，生成接口走本地代理）；
                      devin: ACP 常驻子进程（需已 devin auth login）；
                      zcode/codex/opencode: 回合串联——每条注入消息触发一次 headless 运行，
                      用 sessionId 续链上下文，事件在回合间注入
  --timeout <sec>     单个子代理会话超时（默认 900）
  --data <dir>        运行数据目录（默认 ./data/<时间戳>）
  --worktree          隔离并行模式：每任务一个 git worktree，完成后合并（默认直通模式：
                      任务直接在主仓库工作区执行，多任务并行；create_task 传 isolated:true
                      可对单个任务强制隔离）
  --max-rounds <n>    （已废弃）事件驱动模式下不再使用，仅为兼容保留

通信方式: 共享任务板（本地 MCP server + JSON 文件），所有 agent 经它派发任务、互发消息。`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.goal) {
  printHelp();
  console.error('\n缺少总目标。例: node router.mjs "给 todo-cli 加优先级排序功能"');
  process.exit(2);
}

const AGENTS = {
  claude: { run: opts => runClaude(opts), label: 'Claude Code' },
  zcode: { run: opts => runZcode(opts), label: 'ZCode' },
  devin: { run: opts => runDevin({ ...opts, boardMcp: boardMcpEntry({ agentName: 'devin', dataFile: opts.dataFile, roster: opts.roster }) }), label: 'Devin' }
  ,codex: { run: opts => runCodex(opts), label: 'Codex CLI' }
  ,opencode: { run: opts => runOpencode(opts), label: 'OpenCode' }
  ,antigravity: { run: opts => runAntigravity(opts), label: 'Antigravity' }
};
const agentNames = args.agents.split(',').map(s => s.trim()).filter(Boolean);
for (const name of agentNames) {
  if (!AGENTS[name]) { console.error(`未知成员: ${name}（可选: ${Object.keys(AGENTS).join(', ')}）`); process.exit(2); }
}
if (!AGENTS[args.main]) { console.error(`未知主代理: ${args.main}（可选: ${Object.keys(AGENTS).join(', ')}）`); process.exit(2); }
const ROSTER = [
  { name: 'manager', description: `主代理（${AGENTS[args.main].label}）：拆解目标、派发协调、处理留言，也亲自完成 assignee=manager 的任务。` },
  ...agentNames.map(n => ({ name: n, description: `子代理（subagent，${AGENTS[n].label}）：按任务 spec 在工作目录里写代码、跑验证，通过任务板汇报。` }))
];

// 主会话工厂：claude / antigravity 用 stream-json 双向流常驻；devin 用 ACP 常驻；
// zcode/codex/opencode 没有常驻双向流，用「回合串联」（每条注入消息一次 headless 运行 + sessionId 续链）
function createMainSession(opts) {
  if (args.main === 'claude') return new MainSession(opts);
  if (args.main === 'devin') return new AcpMainSession(opts);
  if (args.main === 'antigravity') return new AgyMainSession(opts);
  return new OneShotMainSession({ kind: args.main, ...opts });
}

const repo = path.resolve(args.repo || path.join(PROJECT_ROOT, 'demo', 'todo-cli'));
if (!fs.existsSync(repo)) { console.error(`仓库不存在: ${repo}`); process.exit(2); }
const gitMode = isGitRepo(repo); // 非 git 目录也能跑：直通模式无提交/合并/回滚，worktree 隔离不可用
if (!gitMode && args.worktree) {
  console.error(`${repo} 不是 git 仓库：--worktree 隔离模式需要 git`);
  process.exit(2);
}
if (gitMode) protectLocalExcludes(repo); // 运行时注入文件（.zcode/、.agents/mcp_config.json）不进任务提交

const runDir = args.data ? path.resolve(args.data) : path.join(PROJECT_ROOT, 'data', `run-${Date.now()}`);
const dataFile = path.join(runDir, 'board.json');
const logDir = path.join(runDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });

const log = (...m) => console.log(...m);
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const board = () => read(dataFile);

// ---------- 调度器状态 ----------
const queues = new Map(agentNames.map(n => [n, []]));  // 每个 agent 一条 FIFO 队列（并发 1），元素 { task, followup|null }
const busyAgent = new Map();                           // agentName -> 正在执行的任务 id
const activeTasks = new Map();                         // taskId -> { agentName, wtDir, branch }（含合并期间）
const dispatched = new Set();                          // 本次进程内已入队的任务 id
let mainSession = null;
let shuttingDown = false;
let finishing = false;
let exitCode = 0;
let finishInfo = null;
let finishWaiter = null;
let lastActiveAt = Date.now();
let lastNudgeAt = 0;
let nudgeCount = 0;
let cmdOffset = 0; // commands.jsonl 已读偏移（Web 控制台的插话/取消/重试入口）

// 主代理状态（写入 runDir/status.json 供 Web 控制台展示）
const runStatus = { session: 'starting', busy: false, turns: 0, cost: 0, currentTool: null, restarts: 0, updatedAt: null };
function writeStatus() {
  runStatus.updatedAt = new Date().toISOString();
  const tmp = path.join(runDir, 'status.json.tmp');
  try {
    fs.writeFileSync(tmp, JSON.stringify(runStatus));
    fs.renameSync(tmp, path.join(runDir, 'status.json'));
  } catch {}
}

const noteActivity = () => { lastActiveAt = Date.now(); };

/** 给主代理推送事件，同时在控制台留痕（前缀 [事件]/[信箱] 供控制台分类过滤） */
function pushEvent(text) {
  log(C.dim(`  ${String(text).replace(/\s+/g, ' ').slice(0, 180)}`));
  mainSession.send(text);
}

function markTask(taskId, patch) {
  mutate(dataFile, b => {
    const t = b.tasks.find(x => x.id === taskId);
    if (!t) return;
    Object.assign(t, patch, { updated_at: new Date().toISOString(), updated_by: 'router' });
  });
}

function spawnSyncGitSha(repoDir) {
  const r = childProcess.spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.stdout.trim();
}

async function runAgentSession({ agentName, prompt, cwd, label, taskRef, onChild, resumeSessionId }) {
  const logFile = path.join(logDir, `${(taskRef || agentName).replace(/[^\w.-]/g, '_')}-${agentName}.log`);
  const thread = createThreadWriter(path.join(runDir, 'threads', `${(taskRef || agentName).replace(/[^\w.-]/g, '_')}-${agentName}.jsonl`));
  thread.add('user', { text: prompt });
  const started = Date.now();
  log(C.dim(`[${stamp()}] ▶ ${label} (${agentName}) 开始${taskRef ? ` · ${taskRef}` : ''}`));
  let textOut = '';
  try {
    const res = await AGENTS[agentName].run({
      prompt,
      cwd,
      agentName,
      roster: ROSTER,
      dataFile,
      logDir: runDir,
      timeoutMs: args.timeout * 1000,
      onText: t => { textOut += t; },
      onChild,
      threadPath: thread.path,
      resumeSessionId
    });
    fs.writeFileSync(logFile, textOut || '(无文本输出)', 'utf8');
    log(C.dim(`[${stamp()}] ■ ${label} (${agentName}) 会话结束，用时 ${Math.round((Date.now() - started) / 1000)}s，输出见 ${path.relative(PROJECT_ROOT, logFile)}`));
    return res;
  } catch (e) {
    fs.writeFileSync(logFile, `ERROR: ${e.message}\n\n${textOut}`, 'utf8');
    thread.add('result', { text: `会话异常结束: ${e.message}`, isError: true });
    log(C.red(`[${stamp()}] ✗ ${label} (${agentName}) 失败: ${e.message.slice(0, 160)}`));
    throw e;
  }
}

// ---------- 派发：任务板 pending 任务 → agent 队列 → worktree 执行 ----------
function enqueueReadyTasks(b) {
  for (const t of b.tasks) {
    if (t.status !== 'pending' || dispatched.has(t.id)) continue;
    if (t.assignee === 'manager') continue;               // 主代理自己的活，它亲自处理
    if (!agentNames.includes(t.assignee)) continue;
    const blockers = (t.blocked_by ?? []).map(id => b.tasks.find(x => x.id === id));
    const blockersDone = blockers.every(x => x && x.status === 'done');
    const blockersSettled = blockers.every(x => !activeTasks.has(x.id)); // 等合并落库后再放行依赖者
    if (!blockersDone || !blockersSettled) continue;
    dispatched.add(t.id);
    queues.get(t.assignee).push({ task: t, followup: null });
    log(`  ↳ ${t.id}「${t.title}」进入 ${t.assignee} 队列`);
    noteActivity();
    pushEvent(`[事件] 任务 ${t.id}「${t.title}」已派给 ${t.assignee}。`);
  }
}

// ---------- 续派：主代理 followup_task 请求 → 原 agent 队列（带原任务上下文） ----------
function pumpFollowups(b) {
  for (const t of b.tasks) {
    if (!t.followup || t.followup.state) continue;        // 只处理新请求（state 未见 = queued 之前）
    if (t.assignee === 'manager' || !agentNames.includes(t.assignee)) {
      markTask(t.id, { followup: { ...t.followup, state: 'rejected', reason: `assignee ${t.assignee} 不可用` } });
      pushEvent(`[事件] 任务 ${t.id} 的 followup 被拒绝：${t.assignee} 不在可用子代理之列。`);
      continue;
    }
    if (activeTasks.has(t.id)) continue;                  // 上一次执行还没收尾（含合并期间）
    if (busyAgent.has(t.assignee)) continue;              // 子代理忙，等下个 tick
    markTask(t.id, { followup: { ...t.followup, state: 'queued' } });
    queues.get(t.assignee).push({ task: t, followup: { message: t.followup.message, requested_at: t.followup.requested_at } });
    log(`  ↳ ${t.id} 的续派请求进入 ${t.assignee} 队列（followup）`);
    noteActivity();
    pushEvent(`[事件] 你对任务 ${t.id}「${t.title}」的继续请求已受理，将派给 ${t.assignee} 在原任务上下文上继续。`);
  }
}

function pump() {
  if (shuttingDown) return;
  // 直通模式（默认）下多任务并行（Codex 式共享主仓库工作区）；并发约束只有每个 agent 的队列并发 1
  for (const name of agentNames) {
    if (busyAgent.has(name)) continue;                    // 每个 agent 同时只跑一个任务
    const q = queues.get(name);
    while (q.length) {
      const item = q.shift();
      const cur = board().tasks.find(t => t.id === item.task.id);
      if (item.followup) {
        if (!cur || cur.followup?.state !== 'queued') {   // followup 已被撤销或处理过，跳过
          log(C.dim(`  (跳过 ${item.task.id} 的 followup: 当前无待处理请求)`));
          continue;
        }
        busyAgent.set(name, cur.id);
        startTask(cur, name, item.followup);
        break;
      }
      if (!cur || cur.status !== 'pending') {             // 任务在排队期间被 manager 改判，跳过
        log(C.dim(`  (跳过 ${item.task.id}: 当前状态 ${cur?.status ?? '不存在'})`));
        continue;
      }
      busyAgent.set(name, cur.id);
      startTask(cur, name);
      break;
    }
  }
}

async function startTask(task, agentName, followup = null) {
  // 隔离判定：运行级 --worktree 让全部任务走 worktree；直通模式下任务级 isolated:true 强制隔离。
  // 非 git 目录 gitMode=false，隔离不可用，一律直通
  const iso = gitMode && (args.worktree || !!task.isolated);
  if (!gitMode && task.isolated) log(C.yellow(`  (任务 ${task.id} 要求 isolated，但目录未用 git 管理，按直通执行)`));
  const cn = followup ? (task.continuations || 0) + 1 : 0;
  let branch = null, wtDir = repo;
  if (iso) {
    // 分支名带 run 标签，避免上一次运行残留的 worktree 分支造成跨 run 撞名；续派再带 -cN 计数
    const runTag = path.basename(runDir).replace(/[^a-z0-9]/gi, '').slice(-6) || 'r0';
    const suffix = followup ? `-c${cn}` : '';
    branch = `task/${task.id.toLowerCase()}-${runTag}${suffix}`;
    wtDir = path.join(runDir, 'worktrees', `${task.id}${suffix}`);
  }
  const baseSha = gitMode ? spawnSyncGitSha(repo) : null;
  activeTasks.set(task.id, { agentName, wtDir, branch, direct: !iso });
  if (iso) {
    try {
      createWorktree(repo, wtDir, branch);
    } catch (e) {
      log(C.red(`  worktree 创建失败: ${e.message}`));
      markTask(task.id, { status: 'failed', result: `Router 无法创建 worktree: ${e.message}` });
      activeTasks.delete(task.id);
      busyAgent.delete(agentName);
      noteActivity();
      pushEvent(`[事件] 任务 ${task.id} 失败：Router 无法创建 worktree（${e.message}）。`);
      pump();
      return;
    }
  }
  if (followup) {
    // 续派：记录轮次、置为 in_progress 让任务板反映"重新执行中"，并清掉队列里的请求标记
    markTask(task.id, { continuations: cn, status: 'in_progress' });
  }
  // 续派统一用"上下文注入的全新会话"：claude/zcode 的 shell 快照锚定原会话目录，
  // resume 到新 worktree 会导致 Bash 工具失效（已实测）
  const prompt = followup
    ? subagentFollowupPrompt({ task, agentName, workspace: wtDir, message: followup.message, previousResult: task.result, isGit: gitMode })
    : subagentPrompt({ task, agentName, workspace: wtDir, isWorktree: iso, isGit: gitMode });
  log(C.dim(`[${stamp()}] ▶ ${task.id}「${task.title}」→ ${agentName}${followup ? `（续派 #${followup.cn} · 上下文注入）` : ''}（${iso ? `worktree ${path.basename(wtDir)}` : '直通 · 主仓库工作区'}）`));
  const res = await runAgentSession({
    agentName,
    label: `任务 ${task.id}`,
    taskRef: task.id,
    cwd: wtDir,
    prompt,
    onChild: child => { const e = activeTasks.get(task.id); if (e) e.pid = child.pid; }
  }).catch(e => ({ sessionError: e.message }));
  harvest(task, agentName, { wtDir, branch, baseSha, res, followup: !!followup, direct: !iso });
}

/** 子代理会话结束后的收割：强制提交 → 校验提交数 → 合并 → 清理 → 事件通知主代理 */
function harvest(task, agentName, ctx) {
  const { wtDir, branch, baseSha, res, followup, direct } = ctx;
  if (res?.sessionId) markTask(task.id, { last_session_id: res.sessionId });
  const after = board().tasks.find(t => t.id === task.id);
  const status = after?.status;
  let evText = null;

  if (res?.sessionError) {
    markTask(task.id, { status: 'failed', result: `会话异常结束: ${res.sessionError}` });
    evText = `[事件] 任务 ${task.id}（${agentName}）会话异常结束，已标记 failed：${res.sessionError}。${direct ? '工作区可能残留未提交改动，请检查。' : `worktree 保留在 ${wtDir} 供检查。`}请创建修正任务或自行处理。`;
  } else if (status === 'done') {
    if (direct && !gitMode) {
      // 直通 + 非 git 目录：没有任何 git 动作，直接认可结果
      if (!after.result) markTask(task.id, { result: '(agent 未填 result)' });
      evText = `[事件] 任务 ${task.id}（${agentName}）已完成。result 摘要：${String(after.result || '(未填写)').slice(0, 300)}`;
    } else if (direct) {
      // 直通模式：没有合并动作，只兜底提交子代理忘记提交的改动；无代码改动的任务是合法的
      let commitErr = null;
      try {
        if (hasPendingChanges(repo)) commitAll(repo, `Agent Router: ${task.id} ${task.title} (${agentName})`);
      } catch (e) { commitErr = e; }
      if (commitErr) {
        markTask(task.id, { status: 'failed', result: `Router 提交改动失败: ${commitErr.message}` });
        evText = `[事件] 任务 ${task.id}（${agentName}）标记 done，但 Router 提交改动失败：${commitErr.message}。主仓库工作区可能残留未提交改动，请检查。`;
      } else {
        const commits = baseSha ? commitCount(repo, baseSha, 'HEAD') : 0;
        if (!after.result) markTask(task.id, { result: '(agent 未填 result)' });
        evText = `[事件] 任务 ${task.id}（${agentName}）已完成${commits > 0 ? `，新增 ${commits} 个提交` : ''}。result 摘要：${String(after.result || '(未填写)').slice(0, 300)}`;
      }
    } else {
      let commits = 0, commitErr = null;
      try {
        if (hasPendingChanges(wtDir)) commitAll(wtDir, `Agent Router: ${task.id} ${task.title} (${agentName})`);
        commits = commitCount(repo, baseSha, branch);
      } catch (e) { commitErr = e; }
      if (commitErr) {
        markTask(task.id, { status: 'failed', result: `Router 提交改动失败: ${commitErr.message}` });
        evText = `[事件] 任务 ${task.id}（${agentName}）标记 done，但 Router 提交改动失败：${commitErr.message}。worktree 保留在 ${wtDir}。`;
      } else if (commits === 0) {
        markTask(task.id, { status: 'failed', result: 'agent 标记 done 但没有产生任何代码改动' });
        removeWorktree(repo, wtDir, branch);
        dropBranch(repo, branch);
        evText = `[事件] 任务 ${task.id}（${agentName}）被标记 done 但 worktree 里没有任何改动，已标记 failed 并清理。请重新创建该任务。`;
      } else {
        const merged = mergeWorktree(repo, branch, `Agent Router: ${task.id} ${task.title} (${agentName})`);
        if (merged.ok) {
          removeWorktree(repo, wtDir, branch);
          dropBranch(repo, branch);
          log(C.green(`  ✔ ${task.id} 已合入 ${merged.base}`));
          if (!after.result) markTask(task.id, { result: '(agent 未填 result，改动已合入)' });
          evText = `[事件] 任务 ${task.id}（${agentName}）已完成并合入主分支（新增 ${commits} 个提交）。result 摘要：${String(after.result || '(未填写)').slice(0, 300)}`;
        } else {
          log(C.yellow(`  ⚠ ${task.id} ${merged.message}`));
          markTask(task.id, { status: 'failed', result: merged.message });
          evText = `[事件] 任务 ${task.id}（${agentName}）的改动合并冲突：${merged.message}。worktree 保留在 ${wtDir}，分支 ${branch}。请创建修正任务或自行处理。`;
        }
      }
    }
  } else if (status === 'in_progress' || status === 'pending') {
    markTask(task.id, { status: 'failed', result: '会话结束但任务未标记 done（agent 未正确收尾）' });
    evText = `[事件] 任务 ${task.id}（${agentName}）会话结束但未标记 done，已标记 failed。请创建修正任务或自行处理。`;
  } else { // agent 自行标记 failed
    evText = `[事件] 任务 ${task.id}（${agentName}）报告失败：${String(after?.result || '(未说明原因)').slice(0, 300)}`;
  }

  activeTasks.delete(task.id);
  busyAgent.delete(agentName);
  // 续派轮次已收割，清掉 followup 标记（执行期间 manager 新提的 followup 没有 state，不受影响）
  if (followup && after?.followup?.state === 'queued') markTask(task.id, { followup: null });
  // 现场保留：未合并的任务也把未提交改动强制提交到任务分支（不合入主分支），worktree 被清理后改动仍在
  if (!direct && fs.existsSync(wtDir) && status !== 'done') {
    try {
      if (hasPendingChanges(wtDir)) commitAll(wtDir, `Agent Router: ${task.id} 现场保留（${status}）`);
    } catch {}
  }
  // worktree 还在 = 现场保留，记录到任务上供控制台展示（直通模式没有 worktree）
  if (!direct && fs.existsSync(wtDir)) markTask(task.id, { worktree: wtDir, branch });
  else markTask(task.id, { worktree: null, branch: null });
  log(C.dim(`[${stamp()}] ● ${task.id} 收割完成（${after?.status ?? '?'}）`));
  if (evText) { noteActivity(); pushEvent(evText); }
  pump();
}

// ---------- Web 控制台命令通道（commands.jsonl：插话 / 取消 / 重试） ----------
function pumpCommands() {
  const f = path.join(runDir, 'commands.jsonl');
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return; }
  if (txt.length < cmdOffset) cmdOffset = 0;
  let rest = txt.slice(cmdOffset);
  if (!rest) return;
  if (!rest.endsWith('\n')) {
    const cut = rest.lastIndexOf('\n');
    if (cut === -1) return; // 最后一行未写完整，等下个 tick
    rest = rest.slice(0, cut + 1);
  }
  cmdOffset += rest.length;
  for (const line of rest.split('\n')) {
    if (!line.trim()) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    handleCommand(cmd);
  }
}

function handleCommand(cmd) {
  if (shuttingDown) return;
  if (cmd.type === 'models_changed') {
    mainSession.requestModelReload();
    return;
  }
  if (cmd.type === 'message' && cmd.text) {
    log(C.cyan(`[用户 → manager] ${String(cmd.text).replace(/\s+/g, ' ').slice(0, 200)}`));
    noteActivity();
    mainSession.send(`[用户] ${cmd.text}`);
  } else if (cmd.type === 'cancel' && cmd.task_id) {
    cancelTask(cmd.task_id);
  } else if (cmd.type === 'retry' && cmd.task_id) {
    retryTask(cmd.task_id);
  }
}

function cancelTask(taskId) {
  const info = activeTasks.get(taskId);
  if (!info) { log(C.yellow(`  (取消请求：任务 ${taskId} 不在执行中)`)); return; }
  log(C.yellow(`  ⚡ 用户取消任务 ${taskId}，终止 ${info.agentName} 会话…`));
  markTask(taskId, { status: 'failed', result: '用户取消（现场保留供检查）' });
  if (info.pid) {
    try { childProcess.spawnSync('taskkill', ['/PID', String(info.pid), '/T', '/F'], { encoding: 'utf8' }); } catch {}
  }
  // 进程结束后 harvest 收尾；status 已是 failed，不会尝试合并
}

function retryTask(taskId) {
  const t = board().tasks.find(x => x.id === taskId);
  if (!t) return;
  if (t.status !== 'failed') { log(C.yellow(`  (重试请求：任务 ${taskId} 状态为 ${t.status}，仅 failed 任务可重试)`)); return; }
  if (activeTasks.has(taskId)) { log(C.yellow(`  (重试请求：任务 ${taskId} 正在执行，忽略)`)); return; }
  dispatched.delete(taskId);
  markTask(taskId, { status: 'pending', result: null });
  log(C.cyan(`  ↻ 用户要求重试 ${taskId}，重新入队`));
  noteActivity();
  pushEvent(`[事件] 任务 ${taskId}「${t.title}」已由用户要求重试，将重新派发给 ${t.assignee}。`);
}

// ---------- 信箱：成员 → manager 的未读留言实时注入主会话 ----------
function pumpMailbox(b) {
  const unread = b.messages.filter(m => m.to === 'manager' && m.from !== 'manager' && !m.read);
  if (!unread.length) return;
  mutate(dataFile, bb => {
    for (const m of bb.messages) {
      if (m.to === 'manager' && m.from !== 'manager' && unread.some(u => u.id === m.id)) m.read = true;
    }
  });
  const text = unread.map(m => `[信箱] 来自 ${m.from}${m.task_id ? ` · 任务 ${m.task_id}` : ''}：\n${m.content}`).join('\n\n');
  log(C.dim(`  ${String(unread[0]?.content || '').replace(/\s+/g, ' ').slice(0, 120)}`));
  noteActivity();
  mainSession.send(text);
}

// ---------- 空闲提醒：没有在跑的任务且会话空闲时，提醒主代理推进或收尾 ----------
function isStuck(t, b) {
  if (t.status !== 'pending') return false;
  if (t.assignee === 'manager') return true;              // 主代理自己的待办
  if (dispatched.has(t.id)) return false;                 // 已排队/在跑
  const blockers = (t.blocked_by ?? []).map(id => b.tasks.find(x => x.id === id));
  if (blockers.length === 0) return false;
  if (blockers.every(x => x && x.status === 'done') && blockers.every(x => !activeTasks.has(x.id))) return false;
  return blockers.some(x => x && x.status === 'failed');  // 前置失败导致卡死
}

function nudgeCheck(b) {
  if (finishing || shuttingDown || !mainSession || mainSession.busy) return;
  if (activeTasks.size > 0 || [...queues.values()].some(q => q.length)) { noteActivity(); return; }
  if (b.finished) return;
  const needsAttention = b.tasks.length === 0
    || b.tasks.some(t => isStuck(t, b))
    || b.tasks.every(t => t.status === 'done' || t.status === 'failed');
  if (!needsAttention) return;
  const idleMs = Date.now() - lastActiveAt;
  if (idleMs < 3 * 60 * 1000 || Date.now() - lastNudgeAt < 3 * 60 * 1000) return;
  lastNudgeAt = Date.now();
  nudgeCount++;
  if (nudgeCount > 6) {
    if (nudgeCount === 7) log(C.yellow('  (多次提醒后主代理仍未收尾，继续等待；可 Ctrl+C 或从 Web 控制台停止)'));
    return;
  }
  const lines = b.tasks.map(t => `${t.id}[${t.status}] ${t.title}`).join('；') || '（任务板为空）';
  pushEvent(`[事件] 会话已空闲 ${Math.round(idleMs / 60000)} 分钟且没有正在执行的任务。当前任务板：${lines}。若总目标已达成，请调用 finish_run 结束；若还有工作要做，请继续推进（create_task 或自己动手）。`);
}

// ---------- 收尾 ----------
function beginShutdown({ code = 0, info = null } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  finishInfo = info;
  for (const [name, q] of queues) {
    if (q.length) log(C.dim(`  (丢弃 ${name} 队列中未开始的任务: ${q.map(t => t.id).join(', ')})`));
    q.length = 0;
  }
  finishWaiter = setInterval(checkShutdownDone, 1000);
  checkShutdownDone();
}

function checkShutdownDone() {
  if (activeTasks.size > 0) return;          // 在跑的任务等它跑完并收割
  if (mainSession?.busy) return;             // 等主代理当前回合自然结束
  clearInterval(finishWaiter);
  finishWaiter = null;
  try { mainSession?.stop(); } catch {}
  printSummary();
  process.exit(exitCode);
}

// ---------- 主循环 ----------
function toolArgsSummary(name, input) {
  try {
    if (name === 'create_task') return `「${input.title}」→ ${input.assignee}`;
    if (name === 'followup_task') return `${input.task_id} 继续指令: ${String(input.message || '').replace(/\s+/g, ' ').slice(0, 80)}`;
    if (name === 'update_task') return `${input.task_id} → ${input.status ?? ''}${input.result ? '（result 更新）' : ''}`;
    if (name === 'send_message') return `to ${input.to}: ${String(input.content || '').replace(/\s+/g, ' ').slice(0, 100)}`;
    if (name === 'finish_run') return '结束请求';
    if (name === 'get_task') return input.task_id;
    const s = JSON.stringify(input);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch { return ''; }
}

function tick() {
  if (shuttingDown || !mainSession) return;
  pumpCommands();
  const b = board();
  enqueueReadyTasks(b);
  pumpFollowups(b);
  pump();
  pumpMailbox(b);
  if (b.finished && !finishing) {
    finishing = true;
    log(C.cyan(`\n[${stamp()}] manager 调用 finish_run，开始收尾：等待 ${activeTasks.size} 个在跑任务…`));
    beginShutdown({ code: 0, info: b.finished });
    return;
  }
  nudgeCheck(b);
}

function printSummary() {
  const b = board();
  if (finishInfo?.summary) {
    log('\n' + C.b('══ manager 结束总结 ══'));
    log(finishInfo.summary);
  }
  log('\n' + C.b('════════ 最终汇总 ════════'));
  for (const t of b.tasks) {
    const icon = t.status === 'done' ? C.green('✔') : t.status === 'failed' ? C.red('✗') : C.yellow('•');
    log(`${icon} [${t.status}] ${C.b(t.id)} ${t.title} → ${t.assignee}`);
    if (t.result) log(C.dim(`    ${t.result.slice(0, 220).replace(/\n/g, '\n    ')}`));
  }
  const msgs = b.messages.filter(m => m.from !== 'router');
  if (msgs.length) {
    log('\n' + C.b('── 信箱消息记录 ──'));
    for (const m of msgs) log(C.dim(`  ${m.ts.slice(11, 19)} ${m.from} → ${m.to}${m.task_id ? ` [${m.task_id}]` : ''}: ${m.content.slice(0, 160)}`));
  }
  log(C.dim(`\n运行数据: ${runDir}\n合并后的仓库: ${repo}`));
}

async function main() {
  log(C.b('Agent Router 启动（事件驱动 · 主代理模式）'), C.dim(`目标: ${args.goal}`));
  log(C.dim(`仓库: ${repo} · 主代理: manager(${args.main} · ${AGENTS[args.main].label}) · 子代理: ${agentNames.join(', ') || '(无)'} · 派发模式: ${args.worktree ? 'worktree（隔离并行）' : `直通（${gitMode ? 'git 仓库' : '普通目录'}执行，多任务并行）`} · 数据: ${runDir}`));
  if (gitMode && hasPendingChanges(repo)) log(C.yellow('  ⚠ 主仓库工作区有未提交改动：直通模式下任务的兜底提交会把它们一并卷入，建议先清理。'));
  if (process.argv.includes('--max-rounds')) log(C.dim('提示: --max-rounds 在事件驱动模式下已不再使用。'));

  // 任务板文件只在首次创建；复用 data 目录重启时保留原状态（配合下方 followup 自愈重置）
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ seq: { task: 0, msg: 0 }, tasks: [], messages: [] }));
  }

  mainSession = createMainSession({
    cwd: repo,
    agentName: 'manager',
    roster: ROSTER,
    dataFile,
    logDir,
    threadPath: path.join(runDir, 'threads', 'manager.jsonl'),
    systemPrompt: managerMainPrompt({ roster: ROSTER, repo, directMode: !args.worktree, gitMode }),
    onText: t => { noteActivity(); if (runStatus.session !== 'online') { runStatus.session = 'online'; } runStatus.busy = true; writeStatus(); log(C.cyan(`[manager] ${String(t).replace(/\s+/g, ' ').trim().slice(0, 400)}`)); },
    onTool: (name, input) => { noteActivity(); runStatus.busy = true; runStatus.currentTool = name; writeStatus(); log(C.dim(`[manager] ⚙ ${name} ${toolArgsSummary(name, input)}`)); },
    onTurnEnd: ev => {
      noteActivity();
      runStatus.session = 'online';
      runStatus.busy = false;
      runStatus.currentTool = null;
      runStatus.turns++;
      if (ev?.total_cost_usd != null) runStatus.cost = ev.total_cost_usd;
      writeStatus();
    },
    onNotice: m => {
      log(C.yellow(`[manager] ${m}`));
      if (/续命重启|无输出|重建|回合失败/.test(m)) { runStatus.session = 'restarting'; runStatus.restarts++; }
      else if (/放弃重启|未登录|未找到/.test(m)) runStatus.session = 'dead';
      else if (/已重建|已重启|已启动/.test(m)) runStatus.session = 'online';
      writeStatus();
    }
  });
  mainSession.start();
  mainSession.send(goalMessage({ goal: args.goal, roster: ROSTER }));
  writeStatus();

  // 重启自愈：进程内队列不持久，把上次运行遗留的"已入队"followup 重置为新请求，由 pumpFollowups 重新派发
  try {
    mutate(dataFile, b => {
      for (const t of b.tasks) {
        if (t.followup && t.followup.state === 'queued') delete t.followup.state;
      }
    });
  } catch {}

  setInterval(() => { try { tick(); } catch (e) { log(C.red(`tick 异常: ${e.message}`)); } }, 1000);

  let sigints = 0;
  process.on('SIGINT', () => {
    sigints++;
    if (sigints === 1) {
      log('\n收到中断，正在停止（再按一次强制退出）…');
      try { mainSession?.stop(); } catch {}
      setTimeout(() => process.exit(1), 3000).unref();
    } else {
      process.exit(1);
    }
  });
}

main().catch(e => {
  console.error(C.red(`Router 异常退出: ${e.stack || e.message}`));
  process.exit(1);
});
