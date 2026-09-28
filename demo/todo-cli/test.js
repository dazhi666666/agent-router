#!/usr/bin/env node
// todo.js 的自动化测试 — 仅用 Node 内置模块（assert/child_process/fs/os/path），无 npm 依赖
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TODO = path.join(__dirname, 'todo.js');
const tmpDirs = [];

// 每个用例独立的临时数据文件：用例互不影响，也不在仓库目录留文件
function newFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-'));
  tmpDirs.push(dir);
  return path.join(dir, 'todos.json');
}

function run(file, ...args) {
  const r = spawnSync(process.execPath, [TODO, ...args], {
    env: { ...process.env, TODO_FILE: file },
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return r;
}

const lines = r => r.stdout.trim().split(/\r?\n/);
const readTodos = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('list：空列表输出 (空)', () => {
  const file = newFile();
  const r = run(file, 'list');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '(空)');
});

test('add：默认优先级为 中', () => {
  const file = newFile();
  const r = run(file, 'add', '买牛奶');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '已添加: 买牛奶');
  assert.deepStrictEqual(readTodos(file), [
    { id: 1, text: '买牛奶', done: false, priority: '中' },
  ]);
});

test('add：--priority 高 与 --priority=低（在文本后）', () => {
  const file = newFile();
  let r = run(file, 'add', '写报告', '--priority', '高');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '已添加: 写报告');
  r = run(file, 'add', '散步', '--priority=低');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '已添加: 散步');
  assert.deepStrictEqual(readTodos(file), [
    { id: 1, text: '写报告', done: false, priority: '高' },
    { id: 2, text: '散步', done: false, priority: '低' },
  ]);
});

test('add：--priority 在文本前，不混入文本', () => {
  const file = newFile();
  const r = run(file, 'add', '--priority', '高', '复习功课');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '已添加: 复习功课');
  assert.deepStrictEqual(readTodos(file), [
    { id: 1, text: '复习功课', done: false, priority: '高' },
  ]);
});

test('add：非法优先级退出码 1、提示文案、不写文件', () => {
  const file = newFile();
  const r = run(file, 'add', '坏任务', '--priority', '急');
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.stdout.trim(), '无效优先级: 急（可选: 高|中|低）');
  assert.strictEqual(fs.existsSync(file), false);
});

test('list：混合优先级按 高>中>低 排序，同级按 id 升序', () => {
  const file = newFile();
  run(file, 'add', '任务A');                      // #1 中
  run(file, 'add', '任务B', '--priority', '高');  // #2 高
  run(file, 'add', '任务C', '--priority=低');     // #3 低
  run(file, 'add', '--priority', '高', '任务D');  // #4 高
  const r = run(file, 'list');
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(lines(r), [
    '共 4 条待办，已完成 0 条',
    '[ ] #2 任务B (高)',
    '[ ] #4 任务D (高)',
    '[ ] #1 任务A (中)',
    '[ ] #3 任务C (低)',
  ]);
});

test('list：无 priority 字段的旧数据显示为 (中)', () => {
  const file = newFile();
  fs.writeFileSync(file, JSON.stringify([
    { id: 1, text: '旧任务', done: false },
  ]));
  const r = run(file, 'list');
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(lines(r), ['共 1 条待办，已完成 0 条', '[ ] #1 旧任务 (中)']);
});

test('done：完成后 list 显示 [x]，文件中 done 为 true', () => {
  const file = newFile();
  run(file, 'add', '买菜');
  run(file, 'add', '看书', '--priority', '高');
  const r = run(file, 'done', '1');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '完成: 买菜');
  assert.deepStrictEqual(readTodos(file), [
    { id: 1, text: '买菜', done: true, priority: '中' },
    { id: 2, text: '看书', done: false, priority: '高' },
  ]);
  assert.deepStrictEqual(lines(run(file, 'list')), [
    '共 2 条待办，已完成 1 条',
    '[ ] #2 看书 (高)',
    '[x] #1 买菜 (中)',
  ]);
});

test('list：首行为统计行 共 N 条待办，已完成 M 条', () => {
  const file = newFile();
  run(file, 'add', '一');
  run(file, 'add', '二');
  run(file, 'add', '三');
  run(file, 'done', '1');
  run(file, 'done', '3');
  assert.strictEqual(lines(run(file, 'list'))[0], '共 3 条待办，已完成 2 条');
});

test('done：不存在的编号输出 没有 #99', () => {
  const file = newFile();
  run(file, 'add', '唯一任务');
  const r = run(file, 'done', '99');
  assert.strictEqual(r.stdout.trim(), '没有 #99');
  assert.strictEqual(readTodos(file)[0].done, false);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`    ${err.message.replace(/\n/g, '\n    ')}`);
  }
}
for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${tests.length - failed}/${tests.length} 通过`);
if (failed) process.exitCode = 1;
