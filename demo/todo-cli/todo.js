#!/usr/bin/env node
// 微型 todo CLI — Agent Router 的演示目标仓库
const FILE = process.env.TODO_FILE || 'todos.json';

function load() {
  try { return JSON.parse(require('fs').readFileSync(FILE, 'utf8')); } catch { return []; }
}
function save(todos) {
  require('fs').writeFileSync(FILE, JSON.stringify(todos, null, 1));
}

const [cmd, ...rest] = process.argv.slice(2);
const todos = load();

const PRIORITIES = ['高', '中', '低'];

if (cmd === 'add') {
  const words = [];
  let priority = '中';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--priority') priority = rest[++i] ?? '';
    else if (rest[i].startsWith('--priority=')) priority = rest[i].slice('--priority='.length);
    else words.push(rest[i]);
  }
  if (!PRIORITIES.includes(priority)) {
    process.exitCode = 1;
    return console.log(`无效优先级: ${priority}（可选: 高|中|低）`);
  }
  const text = words.join(' ');
  todos.push({ id: todos.length + 1, text, done: false, priority });
  save(todos);
  console.log(`已添加: ${text}`);
} else if (cmd === 'list') {
  if (!todos.length) return console.log('(空)');
  console.log(`共 ${todos.length} 条待办，已完成 ${todos.filter(t => t.done).length} 条`);
  const rank = t => PRIORITIES.indexOf(t.priority || '中');
  const sorted = [...todos].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  for (const t of sorted) console.log(`${t.done ? '[x]' : '[ ]'} #${t.id} ${t.text} (${t.priority || '中'})`);
} else if (cmd === 'done') {
  const t = todos.find(x => x.id === Number(rest[0]));
  if (!t) return console.log(`没有 #${rest[0]}`);
  t.done = true;
  save(todos);
  console.log(`完成: ${t.text}`);
} else {
  console.log('用法: node todo.js add <文本> [--priority 高|中|低] | list | done <编号>');
}
