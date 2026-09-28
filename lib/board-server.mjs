// Agent Router task board — minimal MCP server over stdio (newline-delimited JSON-RPC).
// Storage: one JSON file shared by every agent instance; each agent gets its own
// board-server process with AGENT_NAME identifying the caller.
// Logs go to stderr only — stdout is protocol.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { mutate, read, emptyBoard } from './store.mjs';

const DATA_FILE = process.env.ROUTER_DATA;
const AGENT_NAME = process.env.AGENT_NAME || 'unknown';
const ROSTER = safeJson(process.env.ROSTER || '[]');

if (!DATA_FILE) {
  console.error('[board] ROUTER_DATA env is required');
  process.exit(2);
}
if (!fs.existsSync(DATA_FILE)) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(emptyBoard()));
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return []; }
}
function now() {
  return new Date().toISOString();
}

const TOOL_SCHEMAS = {
  create_task: {
    description: '在共享任务板上创建一个任务。返回任务 ID。assignee 必须是花名册里的成员名。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一句话标题' },
        spec: { type: 'string', description: '给执行者的详细说明：目标、涉及文件、验收标准' },
        assignee: { type: 'string', description: '执行成员名（见 get_roster）' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: '前置任务 ID 列表，可省略' },
        isolated: { type: 'boolean', description: '可选。true 时该任务在独立 git worktree 中执行（做有风险的实验性改动、与其它任务隔离）；默认直通模式直接在主仓库工作区执行，多任务并行' }
      },
      required: ['title', 'spec', 'assignee']
    }
  },
  list_tasks: {
    description: '列出任务板上所有任务及其状态。',
    inputSchema: { type: 'object', properties: {} }
  },
  get_task: {
    description: '按 ID 查看一个任务的详情。',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] }
  },
  update_task: {
    description: '更新任务状态/结果。领取任务时置 in_progress；完成后置 done 并必须填写 result 摘要；无法完成时置 failed 并说明原因。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'failed'] },
        result: { type: 'string', description: '结果摘要：做了什么、改了哪些文件、怎么验证的' },
        artifacts: { type: 'array', items: { type: 'string' }, description: '产出文件路径列表' }
      },
      required: ['task_id']
    }
  },
  send_message: {
    description: '给某个成员（或 "*" 广播全体）发站内信。需要别人配合、交接上下文、反馈问题时用它。',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '收件人名、manager 或 *（广播）' },
        content: { type: 'string' },
        task_id: { type: 'string', description: '相关任务 ID，可省略' }
      },
      required: ['to', 'content']
    }
  },
  read_inbox: {
    description: '读取发给我的未读站内信（读后自动标记已读）。',
    inputSchema: { type: 'object', properties: { mark_read: { type: 'boolean', default: true } } }
  },
  get_roster: {
    description: '查看团队花名册：成员名、可执行角色、一句话能力描述。',
    inputSchema: { type: 'object', properties: {} }
  },
  finish_run: {
    description: '（仅 manager）确认总目标已达成、没有需要跟进的事项时调用，写入结束摘要，Router 收尾退出。',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '本次运行总结：目标达成情况、各任务结果、遗留事项' }
      },
      required: ['summary']
    }
  },
  followup_task: {
    description: '（仅 manager）指定某个已结束任务的原执行子代理继续：把新指令追加到它的会话上下文上（类似 Codex followup_task）。Router 会让同一个子代理在基于最新主分支的新 worktree 里继续，完成后重新走合并流程。适合在上个任务基础上补充、修正或扩展；全新工作请用 create_task。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '要继续的任务 ID' },
        message: { type: 'string', description: '给该子代理的新指令：继续做什么、怎么验收' }
      },
      required: ['task_id', 'message']
    }
  }
};

function nextId(board, kind, prefix) {
  board.seq ??= { task: 0, msg: 0 };
  board.seq[kind] = (board.seq[kind] || 0) + 1;
  return `${prefix}${board.seq[kind]}`;
}

const tools = {
  create_task(args) {
    if (!ROSTER.some(r => r.name === args.assignee)) {
      return { error: `assignee "${args.assignee}" 不在花名册，先 get_roster 查看可用成员` };
    }
    let out;
    mutate(DATA_FILE, b => {
      const id = nextId(b, 'task', 'T');
      b.tasks.push({
        id,
        title: args.title,
        spec: args.spec ?? '',
        assignee: args.assignee,
        blocked_by: args.blocked_by ?? [],
        isolated: !!args.isolated,
        status: 'pending',
        result: null,
        artifacts: [],
        created_by: AGENT_NAME,
        created_at: now(),
        updated_at: now()
      });
      out = { id, title: args.title, assignee: args.assignee, isolated: !!args.isolated };
    });
    return out;
  },
  list_tasks() {
    return read(DATA_FILE).tasks.map(t => ({
      id: t.id, title: t.title, assignee: t.assignee, status: t.status,
      blocked_by: t.blocked_by, result: t.result
    }));
  },
  get_task(args) {
    const t = read(DATA_FILE).tasks.find(x => x.id === args.task_id);
    return t ?? { error: `任务 ${args.task_id} 不存在` };
  },
  update_task(args) {
    let out;
    mutate(DATA_FILE, b => {
      const t = b.tasks.find(x => x.id === args.task_id);
      if (!t) { out = { error: `任务 ${args.task_id} 不存在` }; return; }
      if (args.status !== undefined) {
        t.status = args.status;
        if (args.status === 'in_progress' && !t.started_at) t.started_at = now();
      }
      if (args.result !== undefined) t.result = args.result;
      if (args.artifacts !== undefined) t.artifacts = args.artifacts;
      t.updated_at = now();
      t.updated_by = AGENT_NAME;
      out = { id: t.id, status: t.status, ok: true };
    });
    return out;
  },
  send_message(args) {
    let out;
    mutate(DATA_FILE, b => {
      const id = nextId(b, 'msg', 'M');
      b.messages.push({
        id, from: AGENT_NAME, to: args.to, task_id: args.task_id ?? null,
        content: args.content, read: false, ts: now()
      });
      out = { id, ok: true };
    });
    return out;
  },
  read_inbox(args) {
    const markRead = args.mark_read !== false;
    const msgs = read(DATA_FILE).messages.filter(m => m.to === AGENT_NAME && m.from !== AGENT_NAME);
    if (markRead && msgs.some(m => !m.read)) {
      mutate(DATA_FILE, b => {
        for (const m of b.messages) {
          if (m.to === AGENT_NAME && m.from !== AGENT_NAME) m.read = true;
        }
      });
    }
    return msgs.map(m => ({ id: m.id, from: m.from, task_id: m.task_id, content: m.content, ts: m.ts }));
  },
  get_roster() {
    return { me: AGENT_NAME, roster: ROSTER };
  },
  finish_run(args) {
    if (AGENT_NAME !== 'manager') return { error: '只有 manager 可以结束运行' };
    let out;
    mutate(DATA_FILE, b => {
      b.finished = { summary: args.summary ?? '', at: now(), by: AGENT_NAME };
      out = { ok: true, message: '结束请求已记录，Router 将在收尾后退出' };
    });
    return out;
  },
  followup_task(args) {
    if (AGENT_NAME !== 'manager') return { error: '只有 manager 可以指定子代理继续' };
    let out;
    mutate(DATA_FILE, b => {
      const t = b.tasks.find(x => x.id === args.task_id);
      if (!t) { out = { error: `任务 ${args.task_id} 不存在` }; return; }
      if (t.assignee === 'manager') { out = { error: 'assignee 为 manager 的任务由你自己完成，followup 不适用；直接做即可' }; return; }
      if (t.followup) { out = { error: `任务 ${t.id} 已有待处理的 followup，请等它执行完成后再追加` }; return; }
      t.followup = { message: args.message, requested_at: now(), requested_by: AGENT_NAME };
      t.updated_at = now();
      t.updated_by = AGENT_NAME;
      out = { ok: true, task_id: t.id, assignee: t.assignee, message: `已请求子代理 ${t.assignee} 在原任务 ${t.id} 的上下文上继续，Router 将在新 worktree 中执行并重新合并` };
    });
    return out;
  }
};

// finish_run / followup_task 只对 manager 可见
const MANAGER_ONLY = ['finish_run', 'followup_task'];
const VISIBLE_SCHEMAS = AGENT_NAME === 'manager'
  ? TOOL_SCHEMAS
  : Object.fromEntries(Object.entries(TOOL_SCHEMAS).filter(([k]) => !MANAGER_ONLY.includes(k)));

function resultText(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 1) }];
}

const SERVER_INFO = { name: 'agent-router-board', version: '0.1.0' };

async function handleMessage(msg) {
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return null;
  const isNotification = msg.id === undefined;
  try {
    if (msg.method === 'initialize') {
      return { jsonrpc: '2.0', id: msg.id, result: {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO
      } };
    }
    if (msg.method === 'ping') {
      return { jsonrpc: '2.0', id: msg.id, result: {} };
    }
    if (msg.method === 'tools/list') {
      return { jsonrpc: '2.0', id: msg.id, result: {
        tools: Object.entries(VISIBLE_SCHEMAS).map(([name, def]) => ({ name, ...def }))
      } };
    }
    if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      const fn = tools[name];
      if ((name === 'finish_run' || name === 'followup_task') && AGENT_NAME !== 'manager') {
        return { jsonrpc: '2.0', id: msg.id, result: { content: resultText({ error: `只有 manager 可以调用 ${name}` }), isError: true } };
      }
      if (!fn) {
        return { jsonrpc: '2.0', id: msg.id, result: { content: resultText({ error: `unknown tool ${name}` }), isError: true } };
      }
      console.error(`[board] ${AGENT_NAME} -> ${name} ${JSON.stringify(msg.params?.arguments ?? {}).slice(0, 200)}`);
      let value;
      try {
        value = await fn(msg.params?.arguments ?? {});
      } catch (e) {
        value = { error: String(e.message || e) };
      }
      return { jsonrpc: '2.0', id: msg.id, result: { content: resultText(value) } };
    }
    if (isNotification) return null; // notifications/initialized 等
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
  } catch (e) {
    if (isNotification) return null;
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e.message || e) } };
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { return; }
  handleMessage(msg).then(out => {
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
});
rl.on('close', () => process.exit(0));
