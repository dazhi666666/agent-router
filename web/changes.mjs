// 改动审查（右侧栏 changes 面板）：把运行工作目录的 git 差异转成 dsh 前端期望的
// /api/changes.summary 与 /api/changes.diff 形状（p61.js 的 isChangesSummary / isChangesDiff）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_DIFF_LINES = 4000; // 超过视为 oversized，前端只显示「文件过大」
const git = (repo, args) => spawnSync('git', ['-C', repo, '--no-pager', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });

function repoOf(repo) {
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  return top.status === 0 ? top.stdout.trim() : repo;
}

/** 当前未提交改动 → { turn, files:[{path, display, added, deleted, binary?, oversized?}], total, added, deleted } */
export function changesSummary(repo, turn = 1) {
  const root = repoOf(repo);
  const numstat = git(root, ['diff', '--numstat', 'HEAD']).stdout;
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean);
  const files = [];
  let added = 0, deleted = 0;
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [a, d, ...rest] = line.split('\t');
    const p = rest.join('\t');
    if (!p) continue;
    const binary = a === '-';
    let fAdded = binary ? 0 : Number(a), fDeleted = binary ? 0 : Number(d);
    const oversized = !binary && (fAdded + fDeleted > MAX_DIFF_LINES);
    if (oversized) { fAdded = 0; fDeleted = 0; }
    files.push({ path: p, display: path.basename(p), added: fAdded, deleted: fDeleted, ...(binary ? { binary: true } : {}), ...(oversized ? { oversized: true } : {}) });
    added += fAdded; deleted += fDeleted;
  }
  for (const p of untracked) {
    let fAdded = 0;
    try { fAdded = Math.min(fs.readFileSync(path.join(root, p), 'utf8').split('\n').length, MAX_DIFF_LINES); } catch { fAdded = 1; }
    files.push({ path: p, display: path.basename(p), added: fAdded, deleted: 0 });
    added += fAdded;
  }
  files.sort((x, y) => x.path.localeCompare(y.path));
  return { turn: Math.max(1, Number(turn) || 1), files, total: files.length, added, deleted };
}

function parseHunks(diffText) {
  const hunks = [];
  let cur = null;
  for (const line of diffText.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      cur = { oldStart: Number(h[1]), oldLines: Number(h[2] ?? 1), newStart: Number(h[3]), newLines: Number(h[4] ?? 1), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur || !/^[+ -]/.test(line)) continue;
    cur.lines.push(line);
  }
  return hunks;
}

/** 汇总里第 index 个文件的差异 → isChangesDiff 形状；文件不存在返回 null（前端按 404 处理） */
export function changesDiff(repo, index, turn = 1) {
  const summary = changesSummary(repo, turn);
  const f = summary.files[Number(index)];
  if (!f) return null;
  const base = { path: f.path, display: f.display };
  if (f.binary) return { ...base, kind: 'binary' };
  if (f.oversized) return { ...base, kind: 'oversized' };
  const root = repoOf(repo);
  const head = git(root, ['cat-file', '-e', `HEAD:${f.path}`]);
  const before = head.status === 0; // HEAD 里就有 → 不是新建
  let diffText, after = true;
  if (!before) {
    // 未跟踪的新文件：git diff 不输出，整文件当作一个新增 hunk
    let text = '';
    try { text = fs.readFileSync(path.join(root, f.path), 'utf8'); } catch { return { ...base, kind: 'binary' }; }
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    diffText = `@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}`;
  } else {
    const r = git(root, ['diff', 'HEAD', '--', f.path]);
    diffText = r.stdout;
    after = fs.existsSync(path.join(root, f.path)); // diff 有输出但文件没了 → 已删除
  }
  return { ...base, kind: 'text', before, after, coarse: false, hunks: parseHunks(diffText) };
}
