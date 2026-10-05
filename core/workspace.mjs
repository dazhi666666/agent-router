// 任务的工作区：执行前准备（直通 / 独立 worktree），会话结束后收割（定状态、提交、合并、清理）。
//
// 直通模式下多个任务共享主仓库工作区：子代理自行提交自己的文件；Router 只在没有其他任务并行时兜底提交，
// 不再 `git add -A` 把别的任务的半成品和主代理未提交的改动卷进本任务的提交。
import fs from 'node:fs';
import path from 'node:path';
import {
  isGitRepo, createWorktree, mergeWorktree, removeWorktree, dropBranch,
  hasPendingChanges, commitAll, commitCount, dirtyPaths, commitPaths, headSha
} from '../lib/worktree.mjs';

export class Workspace {
  /**
   * @param {{ repo: string, runDir: string, worktreeAll?: boolean }} opts
   *   worktreeAll: 所有任务都在独立 worktree 中执行（--worktree）
   */
  constructor({ repo, runDir, worktreeAll = false }) {
    this.repo = repo;
    this.runDir = runDir;
    this.git = isGitRepo(repo);
    this.worktreeAll = worktreeAll && this.git;
    this.runTag = path.basename(runDir).replace(/[^a-z0-9]/gi, '').slice(-6) || 'r0';
    /** 进行中的直通任务：taskId -> { before: Set<path> } */
    this.direct = new Map();
    /** 之前的任务收割时因并行而未归属、留在工作区的路径（之后的任务不再把它们算作自己的） */
    this.unclaimed = new Set();
  }

  /** 任务是否在独立 worktree 中执行 */
  isolated(task) { return this.git && (this.worktreeAll || !!task.isolated); }

  /**
   * 准备执行环境。
   * @returns {{ cwd: string, iso: boolean, branch: string|null, wtDir: string|null, baseSha: string|null }}
   */
  prepare(task, { round = 0 } = {}) {
    const iso = this.isolated(task);
    const baseSha = this.git ? headSha(this.repo) : null;
    if (!iso) {
      this.direct.set(task.id, { before: this.git ? dirtyPaths(this.repo) : new Set() });
      return { cwd: this.repo, iso, branch: null, wtDir: null, baseSha };
    }
    const suffix = round ? `-c${round}` : '';
    const branch = `task/${task.id.toLowerCase()}-${this.runTag}${suffix}`;
    const wtDir = path.join(this.runDir, 'worktrees', `${task.id}${suffix}`);
    createWorktree(this.repo, wtDir, branch);
    return { cwd: wtDir, iso, branch, wtDir, baseSha };
  }

  /**
   * 会话结束后的收割。task 是任务板上的最新状态。
   * @param {object} task
   * @param {{ cwd, iso, branch, wtDir, baseSha }} env  prepare() 的返回值
   * @param {{ error?: string, cancelled?: boolean, text?: string }} outcome
   * @returns {{ status: 'done'|'failed', result: string, notes: string[], keep?: string }}
   */
  harvest(task, env, outcome) {
    const notes = [];
    const report = task.result || outcome.text?.trim() || '';
    let status, result;
    if (outcome.cancelled) { status = 'failed'; result = task.result || 'Cancelled.'; }
    else if (outcome.error) { status = 'failed'; result = `Session ended abnormally: ${outcome.error}${report ? `\n\n${report}` : ''}`; }
    else if (task.reported === 'failed') { status = 'failed'; result = report || '(no reason given)'; }
    else { status = 'done'; result = report || '(the subagent ended without a report)'; }

    const message = `Agent Router: ${task.id} ${task.title} (${task.assignee})`;
    if (!env.iso) {
      const own = this.direct.get(task.id);
      this.direct.delete(task.id);
      if (!this.git) return { status, result, notes };
      // 共享工作区里无法可靠判断哪个文件是谁改的：子代理按提示自行提交自己的文件；
      // Router 只在没有其他直通任务进行时兜底提交"本任务开始后新变脏"的路径，否则原样保留并告知主代理。
      const now = dirtyPaths(this.repo);
      for (const p of this.unclaimed) if (!now.has(p)) this.unclaimed.delete(p);
      const candidates = [...now].filter(p => !own?.before.has(p) && !this.unclaimed.has(p));
      if (candidates.length && this.direct.size === 0) {
        try {
          if (commitPaths(this.repo, candidates, status === 'done' ? message : `${message} [${status}]`)) notes.push(`router committed ${candidates.length} file(s) the subagent left uncommitted`);
        } catch (e) { notes.push(`could not commit changes: ${e.message}`); }
      } else if (candidates.length) {
        for (const p of candidates) this.unclaimed.add(p);
        notes.push(`uncommitted changes left in the working tree (other tasks are still running there, so they were not attributed to this task): ${candidates.slice(0, 12).join(', ')}${candidates.length > 12 ? ', …' : ''}`);
      }
      return { status, result, notes };
    }

    // 独立 worktree：失败保留现场（改动提交到任务分支），成功则合并回主分支
    try { if (hasPendingChanges(env.wtDir)) commitAll(env.wtDir, status === 'done' ? message : `${message} [${status}, kept for inspection]`); }
    catch (e) { notes.push(`could not commit worktree changes: ${e.message}`); }
    if (status !== 'done') {
      notes.push(`worktree kept at ${env.wtDir} (branch ${env.branch})`);
      return { status, result, notes, keep: env.wtDir };
    }
    const commits = commitCount(this.repo, env.baseSha, env.branch);
    if (commits === 0) {
      this.cleanup(env);
      notes.push('no code changes');
      return { status, result, notes };
    }
    const merged = mergeWorktree(this.repo, env.branch, message);
    if (!merged.ok) {
      notes.push(`merge conflict; worktree kept at ${env.wtDir} (branch ${env.branch})`);
      return { status: 'failed', result: `${result}\n\nMerge failed: ${merged.message}`, notes, keep: env.wtDir };
    }
    this.cleanup(env);
    notes.push(`merged ${commits} commit(s) into ${merged.base}`);
    return { status, result, notes };
  }

  cleanup(env) {
    if (!env.iso) return;
    removeWorktree(this.repo, env.wtDir, env.branch);
    dropBranch(this.repo, env.branch);
  }

  /** worktree 是否还在（续派时判断能否在原目录里 resume） */
  exists(dir) { return !!dir && fs.existsSync(dir); }
}
