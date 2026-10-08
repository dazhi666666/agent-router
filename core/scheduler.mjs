// 调度器：任务板事件驱动（不轮询）。负责就绪判定（依赖）、每个 agent 的并发上限、续派、取消。
// 真正执行一个任务的逻辑由外部注入的 run() 完成（router.mjs：准备工作区 → 跑会话 → 收割），便于测试。
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';

/**
 * @typedef {{ cancelled: boolean, reason?: string, child?: import('node:child_process').ChildProcess, attach(child): void }} Handle
 * @typedef {(task: object, agent: string, opts: { followup: object|null, handle: Handle }) => Promise<void>} RunFn
 */
export class Scheduler extends EventEmitter {
  /**
   * @param {{ board: import('./board.mjs').Board, agents: string[], concurrency?: Record<string, number>, run: RunFn }} opts
   */
  constructor({ board, agents, concurrency = {}, run }) {
    super();
    this.board = board;
    this.agents = agents;
    this.limit = name => Math.max(1, concurrency[name] ?? 1);
    this.run = run;
    this.active = new Map();   // taskId -> { agent, handle, promise }
    this.queued = new Set();   // 已决定派发但因并发上限在排队的 taskId（含续派）
    this.blockedNotified = new Set();
    this.stopped = false;
    const kick = () => this.kick();
    board.on('task:created', kick);
    board.on('task:updated', kick);
  }

  runningCount(agent) { return [...this.active.values()].filter(a => a.agent === agent).length; }
  idle() { return this.active.size === 0 && this.queued.size === 0; }

  /** 依赖是否全部成功；有依赖失败时返回失败的那个 */
  deps(task) {
    const blockers = (task.blocked_by || []).map(id => this.board.task(id));
    const failed = blockers.find(b => !b || b.status === 'failed');
    const ready = blockers.every(b => b && b.status === 'done' && !this.active.has(b.id));
    return { ready, failed };
  }

  /** 找出所有可以开始的任务并在并发允许时启动（幂等，任何状态变化后都可调用） */
  kick() {
    if (this.stopped || this.kicking) return;
    this.kicking = true;
    try {
      for (const task of this.board.tasks) {
        if (this.active.has(task.id) || !this.agents.includes(task.assignee)) continue;
        const followup = task.followup && !task.followup.state && ['done', 'failed'].includes(task.status) ? task.followup : null;
        if (task.status !== 'pending' && !followup) continue;
        if (!followup) {
          const { ready, failed } = this.deps(task);
          if (failed && !this.blockedNotified.has(task.id)) {
            this.blockedNotified.add(task.id);
            this.emit('blocked', task, failed || { id: '?' });
          }
          if (!ready) continue;
        }
        if (this.runningCount(task.assignee) >= this.limit(task.assignee)) {
          if (!this.queued.has(task.id)) { this.queued.add(task.id); this.emit('queued', task, !!followup); }
          continue;
        }
        this.queued.delete(task.id);
        this.start(task, followup);
      }
    } finally { this.kicking = false; }
  }

  start(task, followup) {
    const handle = {
      cancelled: false,
      child: null,
      attach(child) { this.child = child; if (this.cancelled) killTree(child); }
    };
    const round = followup ? (task.continuations || 0) + 1 : 0;
    this.board.updateTask(task.id, {
      status: 'in_progress',
      // 续派必须清掉上一轮的 result：harvest 里 task.result 优先于会话输出，留着旧报告
      // 会让新一轮的完成事件/任务板永远显示旧报告（previousResult 已快照在 followup 里）
      ...(followup ? { continuations: round, followup: { ...followup, state: 'running' }, result: null } : {}),
      reported: null
    });
    const entry = { agent: task.assignee, handle };
    this.active.set(task.id, entry);
    this.emit('started', task, !!followup);
    entry.promise = Promise.resolve()
      .then(() => this.run(this.board.task(task.id), task.assignee, { followup, round, handle }))
      .catch(e => this.emit('error', e, task))
      .finally(() => {
        this.active.delete(task.id);
        this.kick();
        if (this.idle()) this.emit('idle');
      });
  }

  /** 取消排队中或执行中的任务 */
  cancel(id, reason = 'cancelled') {
    const task = this.board.task(id);
    if (!task) return { error: `task ${id} not found` };
    const entry = this.active.get(id);
    if (entry) {
      entry.handle.cancelled = true;
      entry.handle.reason = reason;
      if (entry.handle.child) killTree(entry.handle.child);
      return { ok: true, id, note: 'the running session is being terminated' };
    }
    if (task.status === 'pending' || task.followup) {
      this.queued.delete(id);
      this.board.updateTask(id, { status: 'failed', result: `Cancelled: ${reason}`, followup: null });
      return { ok: true, id };
    }
    return { error: `task ${id} is already ${task.status}` };
  }

  /** 等所有执行中的任务结束（收尾用） */
  async drain() {
    this.stopped = true;
    while (this.active.size) await Promise.allSettled([...this.active.values()].map(a => a.promise));
  }
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else try { child.kill('SIGKILL'); } catch {}
}
