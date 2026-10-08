// 端到端测试用的假 agent（core/test.mjs 经 AGENT_ROUTER_TEST_AGENTS 注入 router.mjs）。
// 假主代理通过真实的 RPC 端点调用任务板工具；假子代理按提示词里的任务号写报告。
import { spawn } from 'node:child_process';
import { boardMcpEntry } from '../lib/spawn-util.mjs';
import { createThreadWriter } from '../lib/thread.mjs';

async function tool(agent, name, args) {
  const { ROUTER_URL, ROUTER_TOKEN } = boardMcpEntry({ agentName: agent }).env;
  const r = await fetch(ROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ROUTER_TOKEN}`, 'X-Agent': agent, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  });
  return JSON.parse((await r.json()).result.content[0].text);
}

async function fakeRun({ prompt, agentName, threadPath, resumeSessionId, onChild }) {
  const thread = createThreadWriter(threadPath);
  const id = (prompt.match(/\b(T\d+)\b/) || [])[1];
  if (resumeSessionId) thread.add('assistant', { text: `resumed session ${resumeSessionId}` });
  if (/slow/.test(prompt) && !resumeSessionId) {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true });
    onChild?.(child);
    await new Promise(r => child.on('close', r));
    return { sessionId: `sess-${id}`, text: '' };
  }
  // 需要时向 consult 顾问请教（附加工具经同一 RPC 端点）
  const advice = /consult please/.test(prompt) ? `; consulted: ${(await tool(agentName, 'consult', { question: 'how?' })).answer}` : '';
  // 续用轮给不同的报告：验证收割的是本轮输出，而不是上一轮遗留的旧 result
  const text = resumeSessionId
    ? `follow-up report from ${agentName} for ${id}${advice}`
    : `report from ${agentName} for ${id}${advice}`;
  thread.add('assistant', { text });
  return { sessionId: `sess-${id}`, text };
}

class FakeMain {
  constructor(opts) { this.opts = opts; this.thread = createThreadWriter(opts.threadPath); this.busy = false; this.sessionId = 'main-1'; this.done = new Set(); }
  start() {}
  stop() {}
  requestModelReload() {}
  async send(text) {
    this.thread.add('user', { text });
    const say = t => this.thread.add('assistant', { text: t });
    if (text === 'please build it') {
      await tool('manager', 'create_task', { title: 'part one', spec: 'do part one', assignee: 'claude' });
      await tool('manager', 'create_task', { title: 'part two', spec: 'do part two', assignee: 'zcode', blocked_by: ['T1'] });
      return say('dispatched T1 and T2');
    }
    if (text === 'followup T1') { this.followup = true; await tool('manager', 'followup_task', { task_id: 'T1', message: 'add more' }); return; }
    if (text === 'slow task') { await tool('manager', 'create_task', { title: 'slow one', spec: 'slow work', assignee: 'claude' }); return; }
    const m = text.match(/任务 (T\d+)「[^」]*」（\w+）已完成/);
    if (m) {
      this.done.add(m[1]);
      if (this.followup && m[1] === 'T1') { this.followup = false; return say('FINAL: followup done'); }
      if (this.done.has('T1') && this.done.has('T2') && !this.final) { this.final = true; say('FINAL: T1 done, T2 done'); }
    }
  }
}

export default {
  runners: {
    claude: { run: fakeRun, label: 'Fake Claude', resumable: true },
    zcode: { run: fakeRun, label: 'Fake ZCode', resumable: true }
  },
  MainSession: FakeMain
};
