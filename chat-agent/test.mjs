// chat-agent tests: node --test chat-agent/test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { parseReply, formatResults, protocolPrompt, ChatAgentSession, createFsTools, createConsult, openAiProvider } from './index.mjs';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };
/** A provider that answers from a script: each entry is a reply string or a function of the messages. */
function scripted(replies) {
  const seen = [];
  return { seen, async complete(messages) { seen.push(messages.map(m => ({ ...m }))); const r = replies.shift(); return { text: typeof r === 'function' ? r(messages) : r ?? 'done' }; } };
}

test('protocol: parse tool calls, tolerate fences and invented results', () => {
  const r = parseReply(`Let me check.\n<tool_call>\n{"name": "list_tasks", "arguments": {}}\n</tool_call>\n<tool_call>\n\`\`\`json\n{"name":"create_task","arguments":{"title":"t","spec":"use \`\`\`js\\ncode\\n\`\`\`"}}\n\`\`\`\n</tool_call>\n<tool_result name="list_tasks">[]</tool_result> ok`);
  assert.equal(r.text, 'Let me check.');
  assert.deepEqual(r.calls.map(c => c.name), ['list_tasks', 'create_task']);
  assert.match(r.calls[1].arguments.spec, /```js/);
  const bad = parseReply('<tool_call>{name: oops}</tool_call>');
  assert.match(bad.calls[0].error, /invalid JSON/);
  const open = parseReply('x <tool_call>{"name":"get_roster","arguments":{}}');
  assert.equal(open.calls[0].name, 'get_roster');
  assert.equal(parseReply('just text').calls.length, 0);
  assert.match(formatResults([{ name: 'a', value: { ok: true } }, { name: 'b', error: 'nope' }]), /<tool_result name="b" error="true">/);
  const prompt = protocolPrompt([{ name: 'create_task', description: 'd', inputSchema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } }, s: { enum: ['done', 'failed'] } }, required: ['tags'] } }]);
  assert.match(prompt, /- tags \(string\[\], required\)/);
  assert.match(prompt, /- s \("done" \| "failed"\)/);
});

test('fs tools: read, list, search, confined to the root', t => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'one\nfunction hello() {}\nthree\n');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'function hello() {}');
  const f = createFsTools(root);
  assert.match(f.invoke('read_file', { path: 'src/a.js', offset: 2, limit: 1 }), /lines 2-2 of 4\)\n2\tfunction hello/);
  assert.equal(f.invoke('list_files', {}), 'src/\nsrc/a.js');
  assert.equal(f.invoke('search', { pattern: 'HELLO' }), 'src/a.js:2: function hello() {}');
  assert.match(f.invoke('read_file', { path: '../secret' }).error, /outside/);
  assert.match(f.invoke('read_file', { path: path.join(os.tmpdir(), 'x') }).error, /outside/);
});

test('session: tool loop, queued messages, step limit, resume', async t => {
  const dir = tmp(t);
  const calls = [], entries = [];
  const provider = scripted([
    'Checking.\n<tool_call>{"name":"echo","arguments":{"v":1}}</tool_call>',
    m => { assert.match(m.at(-1).content, /<tool_result name="echo">\n\{\n "got": 1\n\}/); assert.match(m.at(-1).content, /\[事件\] late/); return 'All done.'; },
    '<tool_call>{"name":"nope","arguments":{}}</tool_call>',
    m => { assert.match(m.at(-1).content, /unknown tool nope/); return 'ok'; }
  ]);
  let turns = 0;
  const s = new ChatAgentSession({
    provider, systemPrompt: 'SYS', stateDir: dir,
    tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} } }],
    invoke: async (name, args) => { calls.push([name, args]); await new Promise(r => setTimeout(r, 30)); return { got: args.v }; },
    onEntry: (kind, data) => entries.push([kind, data.text ?? data.name]),
    onTurnEnd: () => { turns++; }
  });
  s.start();
  s.send('hello');
  await until(() => calls.length === 1);
  s.send('[事件] late'); // 回合进行中到达：随工具结果一起送达
  await until(() => turns === 1);
  assert.deepEqual(calls, [['echo', { v: 1 }]]);
  assert.deepEqual(entries.filter(e => e[0] === 'assistant').map(e => e[1]), ['Checking.', 'All done.']);
  assert.match(provider.seen[0][0].content, /^SYS\n\n# Tools[\s\S]*## echo/);
  s.send('again');
  await until(() => turns === 2);
  // 恢复：同一 id 读回历史，系统提示词换成当前版本
  const id = s.sessionId;
  const r = new ChatAgentSession({ provider: scripted([m => `${m.length} messages; system=${m[0].content.slice(0, 4)}`]), systemPrompt: 'NEW!', stateDir: dir, resumeId: id, tools: [] });
  let text = '';
  r.onText = v => { text = v; };
  r.start();
  r.send('resumed?');
  await until(() => text);
  assert.equal(r.sessionId, id);
  assert.match(text, /^10 messages; system=NEW!/);
  // 步数上限
  const loop = new ChatAgentSession({ provider: { complete: async () => ({ text: '<tool_call>{"name":"echo","arguments":{}}</tool_call>' }) }, stateDir: dir, maxSteps: 3, tools: [{ name: 'echo', description: '', inputSchema: {} }], invoke: () => 'x' });
  const notices = [];
  loop.onNotice = n => notices.push(n);
  let ended = false;
  loop.onTurnEnd = () => { ended = true; };
  loop.start(); loop.send('go');
  await until(() => ended);
  assert.match(notices[0], /上限 3/);
});

test('session: provider failure retries then reports, and the session keeps working', async t => {
  let n = 0;
  const s = new ChatAgentSession({ provider: { complete: async () => { n++; if (n <= 3) throw new Error('boom'); return { text: 'back' }; } }, stateDir: tmp(t), retries: 2, retryDelayMs: 10, tools: [] });
  const notices = []; let turns = 0, text = '';
  Object.assign(s, { onNotice: m => notices.push(m), onTurnEnd: () => turns++, onText: v => { text = v; } });
  s.start(); s.send('a');
  await until(() => turns === 1, 15000);
  assert.equal(n, 3); assert.match(notices.at(-1), /回合失败: boom/);
  s.send('b');
  await until(() => text === 'back');
  // 失败回合的用户消息与新消息合并，角色保持交替
  assert.deepEqual(JSON.parse(fs.readFileSync(s.file, 'utf8')).messages.map(m => m.role), ['system', 'user', 'assistant']);
});

test('consult: attaches files and returns the answer', async t => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'CONTENT-A');
  const provider = scripted([m => `saw ${m[1].content.includes('<file path="a.txt">\nCONTENT-A') ? 'file' : 'nothing'}`]);
  const consult = createConsult({ provider, root });
  const r = await consult({ question: 'why?', files: ['a.txt', 'missing.txt', '../x'] }, 'claude');
  assert.equal(r.answer, 'saw file');
  assert.equal(r.files_not_attached.length, 2);
  assert.match(provider.seen[0][1].content, /Asked by: claude/);
  assert.match((await consult({})).error, /question/);
});

test('openai provider: streams SSE, reports HTTP errors', async t => {
  let lastBody = null;
  const server = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c; lastBody = JSON.parse(b);
    if (req.headers.authorization !== 'Bearer k') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const d of [{ reasoning_content: 'hm' }, { content: 'Hel' }, { content: 'lo' }]) res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const p = openAiProvider({ baseUrl, model: 'm', apiKey: 'k', params: { temperature: 0.2 } });
  assert.deepEqual(await p.complete([{ role: 'user', content: 'hi' }]), { text: 'Hello', reasoning: 'hm' });
  assert.equal(lastBody.temperature, 0.2); assert.equal(lastBody.model, 'm');
  await assert.rejects(openAiProvider({ baseUrl, model: 'm', apiKey: 'x' }).complete([]), /HTTP 401: bad key/);
  await assert.rejects(openAiProvider({ baseUrl, model: 'm', apiKeyEnv: 'AR_NO_SUCH_KEY' }).complete([]), /AR_NO_SUCH_KEY/);
});
