// Git worktree isolation: one worktree + branch per task, merged back on completion.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function git(repo, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} 失败: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  }
  return r;
}

export function isGitRepo(repo) {
  return spawnSync('git', ['-C', repo, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).status === 0;
}

export function createWorktree(repo, wtDir, branch) {
  fs.mkdirSync(wtDir, { recursive: true });
  git(repo, ['worktree', 'add', '-B', branch, wtDir]);
}

/**
 * Merge the task branch back into the repo's current branch.
 * Returns { ok: true } or { ok: false, conflict: true, message }.
 */
export function mergeWorktree(repo, branch, message) {
  const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const r = git(repo, ['merge', '--no-ff', branch, '-m', message], { allowFail: true });
  if (r.status !== 0) {
    git(repo, ['merge', '--abort'], { allowFail: true });
    return { ok: false, conflict: true, message: `合并 ${branch} 到 ${base} 冲突，需要人工介入` };
  }
  return { ok: true, base };
}

export function removeWorktree(repo, wtDir, branch) {
  git(repo, ['worktree', 'remove', '--force', wtDir], { allowFail: true });
  fs.rmSync(wtDir, { recursive: true, force: true });
}

export function dropBranch(repo, branch) {
  git(repo, ['branch', '-D', branch], { allowFail: true });
}

/** worktree 里是否有未提交改动 */
export function hasPendingChanges(dir) {
  return git(dir, ['status', '--porcelain']).stdout.trim().length > 0;
}

/** 无头 agent 常常忘记 commit —— 合并前强制提交所有改动 */
export function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

/** 工作区里有改动的路径集合（git status --porcelain，含未跟踪文件） */
export function dirtyPaths(dir) {
  const out = git(dir, ['status', '--porcelain', '-uall', '-z']).stdout;
  const paths = new Set();
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2), p = parts[i].slice(3);
    paths.add(p);
    if (code[0] === 'R' || code[0] === 'C') i++; // 重命名/复制条目后面跟着原路径
  }
  return paths;
}

/** 只提交指定路径（直通模式按任务归属提交，不卷入别人的改动） */
export function commitPaths(dir, paths, message) {
  if (!paths.length) return false;
  git(dir, ['add', '-A', '--', ...paths]);
  if (git(dir, ['diff', '--cached', '--quiet'], { allowFail: true }).status === 0) return false;
  git(dir, ['commit', '-m', message, '--', ...paths]);
  return true;
}

export function headSha(dir) {
  return git(dir, ['rev-parse', 'HEAD'], { allowFail: true }).stdout.trim() || null;
}

/** branch 相对 base 有几个新提交 */
export function commitCount(repo, base, branch) {
  return parseInt(git(repo, ['rev-list', '--count', `${base}..${branch}`]).stdout.trim() || '0', 10);
}

/** Router 运行时注入的本地配置文件加入 .git/info/exclude（仅本仓库生效、不会被提交），
 *  防止 harvest 兜底提交（git add -A）把 zcode 的 .zcode/config.json、agy 的
 *  .agents/mcp_config.json 卷进任务提交。幂等；仅 git 仓库可调用。 */
export function protectLocalExcludes(repo) {
  try {
    const f = path.join(repo, '.git', 'info', 'exclude');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch {}
    const lines = ['.zcode/', '.agents/mcp_config.json'];
    const missing = lines.filter(l => !txt.split(/\r?\n/).some(x => x.trim() === l));
    if (missing.length) {
      fs.appendFileSync(f, (txt && !txt.endsWith('\n') ? '\n' : '') + '# Agent Router 运行时注入文件\n' + missing.join('\n') + '\n');
    }
  } catch {}
}
