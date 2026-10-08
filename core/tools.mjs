// 任务板工具：定义 + 权限 + 实现。所有 agent 经 RPC 调用到这里，caller 由 Router 鉴别（不信任参数里的身份）。
// 生命周期由 Router 掌管：子代理会话启动即 in_progress，会话正常结束即 done（最终回复作为报告）；
// 子代理只在需要主动报告失败、或补充结构化结果时才调用 update_task。

const MANAGER_ONLY = new Set(['create_task', 'followup_task', 'cancel_task', 'finish_run']);

export const TOOL_SCHEMAS = {
  create_task: {
    description: `(manager only) Launch a subagent on a self-contained task. The task is dispatched to the assignee automatically and runs in a fresh session that does not share your context. Returns the task ID immediately; you get a [事件] message with the subagent's full report when it finishes or fails.

When to use: the work is large enough to split into independent parts that can run in parallel, or the user asks for a specific agent.
When NOT to use: small changes or anything you can finish in a few tool calls (do it yourself); work that needs back-and-forth with the user; parts that would edit the same files as another running task.

Usage notes:
- Write the spec like a brief for a capable colleague with no context: goal, relevant files, constraints, and how to verify.
- Launch independent tasks together so they run concurrently; use blocked_by to order dependent ones.
- The result is not shown to the user. Summarize it for them when it arrives.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short (3-10 word) title for the task' },
        spec: { type: 'string', description: 'Complete instructions for the subagent: goal, relevant files and context, constraints, and how to verify the result' },
        assignee: { type: 'string', description: 'Roster member to run the task (see get_roster); "manager" means you will do it yourself' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Optional. IDs of tasks that must finish successfully before this one starts' },
        isolated: { type: 'boolean', description: 'Optional. Run the task in its own git worktree and merge it back when done. Use for risky or experimental changes; by default tasks run directly in the shared working directory' }
      },
      required: ['title', 'spec', 'assignee']
    }
  },
  followup_task: {
    description: '(manager only) Ask the subagent that ran a finished task to continue it. When possible the subagent\'s original session is resumed; otherwise the original spec and previous report are injected into a new session. Use this to extend or correct a task; use create_task for unrelated new work.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the task to continue' },
        message: { type: 'string', description: 'New instructions only: what to do next and how to verify it' }
      },
      required: ['task_id', 'message']
    }
  },
  cancel_task: {
    description: '(manager only) Cancel a pending or running task. A running subagent session is terminated and the task is marked failed; changes it already made are left in place for you to inspect.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        reason: { type: 'string', description: 'Optional. Why the task is cancelled' }
      },
      required: ['task_id']
    }
  },
  list_tasks: {
    description: 'List every task on the board with its status and assignee.',
    inputSchema: { type: 'object', properties: {} }
  },
  get_task: {
    description: 'Get the full details of one task: spec, status, report, and artifacts.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] }
  },
  update_task: {
    description: 'Report on a task. Subagents: your task is marked done automatically when your session ends and your final reply becomes the report, so you only need this to report failure (status="failed" with the reason) or to attach a structured result and artifacts. The manager uses it to complete tasks assigned to "manager".',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string', enum: ['done', 'failed'] },
        result: { type: 'string', description: 'What changed, which files, and how it was verified (or why it failed)' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Paths of key files produced or changed' }
      },
      required: ['task_id']
    }
  },
  send_message: {
    description: 'Send a message to a team member, "manager", or "*" (everyone). Use it to ask a question, report a blocker, or hand over context. Messages to the manager are delivered immediately; subagents see theirs when they call read_inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient: a member name, "manager", or "*"' },
        content: { type: 'string' },
        task_id: { type: 'string', description: 'Optional. Related task ID' }
      },
      required: ['to', 'content']
    }
  },
  read_inbox: {
    description: 'Read your unread messages. Messages are marked as read after this call.',
    inputSchema: { type: 'object', properties: {} }
  },
  get_roster: {
    description: 'List the team: member names, roles, and what each is good at.',
    inputSchema: { type: 'object', properties: {} }
  },
  finish_run: {
    description: '(manager only, goal mode) End the whole run once the overall goal is achieved and nothing needs follow-up. Writes the closing summary; the router then shuts down.',
    inputSchema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Closing summary: whether the goal was met, each task\'s outcome, and anything left open' } },
      required: ['summary']
    }
  }
};

/**
 * 某个 agent 可见的工具定义。
 * @param {string} caller  agent 名（manager / claude / zcode …）
 * @param {{chat?: boolean, extra?: object}} opts  对话模式下不提供 finish_run；extra 是 Router 挂上的附加工具
 *        （名字 → { description, inputSchema, call(caller, args), for?(caller) }，如 consult）
 */
export function toolsFor(caller, { chat = false, extra = {} } = {}) {
  const board = Object.entries(TOOL_SCHEMAS)
    .filter(([name]) => caller === 'manager' || !MANAGER_ONLY.has(name))
    .filter(([name]) => !(chat && name === 'finish_run'))
    .map(([name, def]) => ({ name, ...def }));
  const more = Object.entries(extra)
    .filter(([, def]) => !def.for || def.for(caller))
    .map(([name, def]) => ({ name, description: def.description, inputSchema: def.inputSchema }));
  return [...board, ...more];
}

/**
 * 执行一次工具调用。
 * @param {import('./board.mjs').Board} board
 * @param {string} caller
 * @param {string} name
 * @param {object} args
 * @param {{ roster: {name:string,description:string}[], chat?: boolean, cancel?: (id:string, reason:string)=>object, extra?: object }} ctx
 * @returns {object | Promise<object>}  附加工具可能是异步的
 */
export function callTool(board, caller, name, args = {}, ctx) {
  const extra = ctx.extra?.[name];
  if (extra && !TOOL_SCHEMAS[name]) {
    if (extra.for && !extra.for(caller)) return { error: `tool ${name} is not available to ${caller}` };
    return Promise.resolve().then(() => extra.call(caller, args)).catch(e => ({ error: String(e.message || e) }));
  }
  if (!TOOL_SCHEMAS[name] || (ctx.chat && name === 'finish_run')) return { error: `unknown tool ${name}` };
  if (MANAGER_ONLY.has(name) && caller !== 'manager') return { error: `only the manager can call ${name}` };
  const members = ctx.roster.map(r => r.name);
  switch (name) {
    case 'create_task': {
      if (!args.title || !args.assignee) return { error: 'title and assignee are required' };
      if (!members.includes(args.assignee)) return { error: `assignee "${args.assignee}" is not on the roster (${members.join(', ')})` };
      const missing = (args.blocked_by || []).filter(id => !board.task(id));
      if (missing.length) return { error: `unknown blocked_by task(s): ${missing.join(', ')}` };
      const t = board.createTask(args, caller);
      return { id: t.id, title: t.title, assignee: t.assignee, status: t.status };
    }
    case 'followup_task': {
      const t = board.task(args.task_id);
      if (!t) return { error: `task ${args.task_id} not found` };
      if (t.assignee === 'manager') return { error: 'tasks assigned to manager are yours; just continue the work yourself' };
      if (!['done', 'failed'].includes(t.status)) return { error: `task ${t.id} is still ${t.status}; wait for it to finish` };
      if (t.followup) return { error: `task ${t.id} already has a pending follow-up` };
      if (!args.message) return { error: 'message is required' };
      // 快照当时的报告：续派会清掉 task.result（让新一轮的最终回复生效），非 resume 续用模板用快照注入旧报告
      board.updateTask(t.id, { followup: { message: args.message, previousResult: t.result ?? null, requested_at: new Date().toISOString() } }, caller);
      return { ok: true, task_id: t.id, assignee: t.assignee };
    }
    case 'cancel_task': {
      const t = board.task(args.task_id);
      if (!t) return { error: `task ${args.task_id} not found` };
      return ctx.cancel ? ctx.cancel(t.id, args.reason || 'cancelled by manager') : { error: 'cancel is not available' };
    }
    case 'list_tasks':
      return board.tasks.map(t => ({ id: t.id, title: t.title, assignee: t.assignee, status: t.status, blocked_by: t.blocked_by, result: t.result ? String(t.result).slice(0, 500) : null }));
    case 'get_task':
      return board.task(args.task_id) || { error: `task ${args.task_id} not found` };
    case 'update_task': {
      const t = board.task(args.task_id);
      if (!t) return { error: `task ${args.task_id} not found` };
      if (caller !== 'manager' && t.assignee !== caller) return { error: `task ${t.id} is assigned to ${t.assignee}, not you` };
      if (args.status && !['done', 'failed'].includes(args.status)) return { error: 'status must be "done" or "failed"' };
      const patch = {};
      if (args.status) patch.status = args.status;
      if (args.result !== undefined) patch.result = args.result;
      if (args.artifacts !== undefined) patch.artifacts = args.artifacts;
      // 子代理在会话中途报 done 只记录意向，真正结束以会话退出为准（由 Router 收尾）
      if (caller !== 'manager' && patch.status === 'done' && t.status === 'in_progress') { delete patch.status; patch.reported = 'done'; }
      if (caller !== 'manager' && patch.status === 'failed' && t.status === 'in_progress') { delete patch.status; patch.reported = 'failed'; }
      board.updateTask(t.id, patch, caller);
      return { ok: true, id: t.id, status: board.task(t.id).status, ...(patch.reported ? { note: `recorded as ${patch.reported}; the router finalizes the task when your session ends` } : {}) };
    }
    case 'send_message': {
      if (!args.to || !args.content) return { error: 'to and content are required' };
      if (args.to !== '*' && args.to !== 'manager' && !members.includes(args.to)) return { error: `unknown recipient "${args.to}"` };
      const m = board.sendMessage({ from: caller, to: args.to, content: args.content, task_id: args.task_id ?? null });
      return { ok: true, id: m.id };
    }
    case 'read_inbox':
      return board.inbox(caller).map(m => ({ id: m.id, from: m.from, task_id: m.task_id, content: m.content, ts: m.ts }));
    case 'get_roster':
      return { me: caller, roster: ctx.roster };
    case 'finish_run':
      board.finish(args.summary ?? '', caller);
      return { ok: true, message: 'Summary recorded; the router will shut down after running tasks finish.' };
  }
  return { error: `unknown tool ${name}` };
}
