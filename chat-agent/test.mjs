// chat-agent tests: node --test chat-agent/test.mjs
// The last test drives the real Codex CLI through the gateway; it is skipped when Codex is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  parseReply, formatResults, protocolPrompt, resolveArguments, createConsult, openAiProvider,
  startGateway, convertTools, convertInput, toOutputItems, codexModelInfo, codexProviderArgs, prepareCodexHome
} from './index.mjs';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** A provider that answers from a script: each entry is a reply string or a function of the messages. */
function scripted(replies) {
  const seen = [];
  return { seen, async complete(messages) { seen.push(messages.map(m => ({ ...m }))); const r = replies.shift(); return { text: typeof r === 'function' ? r(messages) : r ?? 'done' }; } };
}

test('protocol: JSON and freeform calls, fences, invented results', () => {
  const r = parseReply('Let me check.\n<tool_call>\n```json\n{"name":"create_task","arguments":{"title":"t","spec":"use ```js\\ncode\\n```"}}\n```\n</tool_call>\n<tool_result name="x">[]</tool_result> ok');
  assert.equal(r.text, 'Let me check.');
  assert.match(r.calls[0].arguments.spec, /```js/);
  assert.match(parseReply('<tool_call>{name: oops}</tool_call>').calls[0].error, /invalid JSON/);
  assert.equal(parseReply('x <tool_call>{"name":"get_roster","arguments":{}}').calls[0].name, 'get_roster');
  // 自由格式：原文保留，且只认行首的关闭标签
  const free = parseReply('Patching.\n<tool_call name="apply_patch">\n*** Begin Patch\n*** Update File: p.mjs\n-const a = "</tool_call>";\n+const a = 1;\n*** End Patch\n</tool_call>\n<tool_call name="exec_command">{"cmd": "npm test"}</tool_call>');
  assert.equal(free.text, 'Patching.');
  assert.equal(free.calls[0].raw, '*** Begin Patch\n*** Update File: p.mjs\n-const a = "</tool_call>";\n+const a = 1;\n*** End Patch');
  assert.deepEqual(resolveArguments(free.calls[0], { format: 'freeform' }), { input: free.calls[0].raw });
  assert.deepEqual(resolveArguments(free.calls[1], { inputSchema: {} }), { cmd: 'npm test' });
  assert.deepEqual(resolveArguments({ name: 'apply_patch', arguments: { patch: 'P' } }, { format: 'freeform' }), { input: 'P' });
  assert.match(formatResults([{ name: 'a', value: { ok: true } }, { name: 'b', error: 'nope' }]), /<tool_result name="b" error="true">/);
  const prompt = protocolPrompt([
    { name: 'create_task', description: 'd', inputSchema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } }, s: { enum: ['done', 'failed'] } }, required: ['tags'] } },
    { name: 'apply_patch', description: 'patch', format: 'freeform' }
  ]);
  assert.match(prompt, /- tags \(string\[\], required\)/);
  assert.match(prompt, /- s \("done" \| "failed"\)/);
  assert.match(prompt, /Freeform tools \(apply_patch\)[\s\S]*## apply_patch \(freeform\)/);
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
  assert.equal(lastBody.temperature, 0.2);
  await assert.rejects(openAiProvider({ baseUrl, model: 'm', apiKey: 'x' }).complete([]), /HTTP 401: bad key/);
  await assert.rejects(openAiProvider({ baseUrl, model: 'm', apiKeyEnv: 'AR_NO_SUCH_KEY' }).complete([]), /AR_NO_SUCH_KEY/);
});

test('gateway translation: tools, input history, output items', () => {
  const { tools, skipped } = convertTools([
    { type: 'function', name: 'shell_command', description: 'run', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
    { type: 'custom', name: 'apply_patch', description: 'edit', format: { type: 'grammar', syntax: 'lark', definition: 'start: x' } },
    { type: 'namespace', name: 'mcp__board__', tools: [{ type: 'function', name: 'create_task', description: 'c', parameters: {} }] },
    { type: 'namespace', name: 'multi_agent_v1', tools: [{ type: 'function', name: 'spawn_agent', description: 's', parameters: {} }] },
    { type: 'web_search' }
  ]);
  assert.deepEqual(tools.map(x => x.name), ['shell_command', 'apply_patch', 'mcp__board__create_task', 'multi_agent_v1.spawn_agent']);
  assert.match(tools[1].description, /Input grammar \(lark\):\nstart: x/);
  assert.deepEqual(skipped, ['web_search']);

  const msgs = convertInput([
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'perms' }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do it' }, { type: 'input_image', image_url: 'x' }] },
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
    { type: 'function_call', name: 'create_task', namespace: 'mcp__board__', arguments: '{"title":"t"}', call_id: 'c1' },
    { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch', call_id: 'c2' },
    { type: 'function_call_output', call_id: 'c1', output: 'T1' },
    { type: 'custom_tool_call_output', call_id: 'c2', output: [{ type: 'input_text', text: 'Success.' }] }
  ]);
  assert.deepEqual(msgs.map(m => m.role), ['user', 'assistant', 'user']);
  assert.match(msgs[0].content, /<developer_instructions>\nperms\n<\/developer_instructions>\n\ndo it\n\[image omitted/);
  assert.match(msgs[1].content, /^ok\n\n<tool_call>\n\{"name":"mcp__board__create_task","arguments":\{"title":"t"\}\}\n<\/tool_call>\n\n<tool_call name="apply_patch">\n\*\*\* Begin Patch/);
  assert.match(msgs[2].content, /<tool_result name="mcp__board__create_task">\nT1\n<\/tool_result>\n\n<tool_result name="apply_patch">\nSuccess\./);

  const out = toOutputItems('Working.\n<tool_call>{"name":"mcp__board__create_task","arguments":{"title":"x"}}</tool_call>\n<tool_call name="apply_patch">\n*** Begin Patch\n*** End Patch\n</tool_call>\n<tool_call>{"name":"nope","arguments":{}}</tool_call>', tools);
  assert.deepEqual(out.items.map(i => i.type), ['message', 'function_call', 'custom_tool_call']);
  assert.equal(out.items[1].name, 'create_task'); assert.equal(out.items[1].namespace, 'mcp__board__');
  assert.equal(out.items[1].arguments, '{"title":"x"}');
  assert.equal(out.items[2].input, '*** Begin Patch\n*** End Patch');
  assert.match(out.problems[0], /Unknown tool "nope"/);
});

/** POST a Responses request to the gateway and collect the SSE events */
async function responses(gw, body) {
  const r = await fetch(`${gw.url}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${gw.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, events: text.split('\n\n').filter(b => b.includes('data: ')).map(b => JSON.parse(b.slice(b.indexOf('data: ') + 6))) };
}

test('gateway server: SSE response, repair of bad calls, auth, catalog, failures', async t => {
  const provider = scripted([
    '<tool_call>{"name":"missing","arguments":{}}</tool_call>',
    m => { assert.match(m.at(-1).content, /\[gateway\] Your last reply could not be executed:\n- Unknown tool "missing"/); return 'Running.\n<tool_call>{"name":"shell_command","arguments":{"command":"ls"}}</tool_call>'; }
  ]);
  const failing = { complete: async () => { throw new Error('quota exceeded'); } };
  const gw = await startGateway({ models: async name => ({ good: provider, bad: failing })[name] || null, catalog: () => [codexModelInfo({ name: 'good' })] });
  t.after(() => gw.close());
  const tools = [{ type: 'function', name: 'shell_command', description: 'run', parameters: { type: 'object', properties: { command: { type: 'string' } } } }];
  const { status, events } = await responses(gw, { model: 'good', instructions: 'BASE', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'list' }] }], tools, stream: true });
  assert.equal(status, 200);
  assert.deepEqual(events.map(e => e.type), ['response.created', 'response.output_item.added', 'response.output_text.delta', 'response.output_item.done', 'response.output_item.added', 'response.output_item.done', 'response.completed']);
  const call = events[5].item;
  assert.equal(call.type, 'function_call'); assert.equal(call.arguments, '{"command":"ls"}'); assert.ok(call.call_id);
  assert.ok(events.at(-1).response.usage.total_tokens > 0);
  assert.match(provider.seen[0][0].content, /^BASE\n\n# Tools[\s\S]*## shell_command/);
  // 模型调用失败 → response.failed
  const failed = await responses(gw, { model: 'bad', input: [], stream: true });
  assert.equal(failed.events.at(-1).type, 'response.failed');
  assert.match(failed.events.at(-1).response.error.message, /quota exceeded/);
  assert.equal((await responses(gw, { model: 'unknown', input: [] })).status, 404);
  assert.equal((await fetch(`${gw.url}/responses`, { method: 'POST', body: '{}' })).status, 401);
  const catalog = await (await fetch(`${gw.url}/models`, { headers: { Authorization: `Bearer ${gw.token}` } })).json();
  assert.equal(catalog.models[0].slug, 'good');
  assert.equal(catalog.models[0].apply_patch_tool_type, 'freeform');
  assert.match(catalog.models[0].base_instructions, /^You are a coding agent running in the Codex CLI/);
});

const CODEX_EXE = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const codexExe = process.env.AGENT_ROUTER_CODEX_EXE || (fs.existsSync(CODEX_EXE) ? CODEX_EXE : null);

test('real Codex drives a chat-only model through the gateway (apply_patch + shell)', { skip: !codexExe && 'Codex CLI not installed', timeout: 120000 }, async t => {
  const dir = tmp(t), work = path.join(dir, 'work');
  fs.mkdirSync(work);
  let toolNames = [];
  const fake = { async complete(messages) {
    toolNames = (messages[0].content.match(/^## (\S+)/gm) || []).map(l => l.slice(3));
    // Codex decides which shell tool to offer (exec_command or shell_command)
    const shell = toolNames.includes('exec_command') ? { name: 'exec_command', arguments: { cmd: 'Get-Content hello.txt' } } : { name: 'shell_command', arguments: { command: 'Get-Content hello.txt' } };
    const last = messages.at(-1).content;
    if (last.includes(`<tool_result name="${shell.name}">`)) {
      assert.match(last, /hi from a chat model/);
      return { text: 'DONE: hello.txt verified.' };
    }
    if (last.includes('<tool_result name="apply_patch">')) return { text: `<tool_call>${JSON.stringify(shell)}</tool_call>` };
    return { text: 'Creating the file.\n<tool_call name="apply_patch">\n*** Begin Patch\n*** Add File: hello.txt\n+hi from a chat model\n*** End Patch\n</tool_call>' };
  } };
  const home = prepareCodexHome({ dir: path.join(dir, 'codex-home'), models: [{ name: 'fake-brain', label: 'Fake Brain' }] });
  const gw = await startGateway({ models: async name => name === 'fake-brain' ? fake : null });
  t.after(() => gw.close());
  const args = ['exec', '--json', '--cd', work, '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', ...codexProviderArgs({ url: gw.url, model: 'fake-brain', tokenEnv: 'CHAT_GATEWAY_TOKEN' }), 'create hello.txt'];
  const out = await new Promise((resolve, reject) => {
    const child = spawn(codexExe, args, { env: { ...process.env, CODEX_HOME: home, CHAT_GATEWAY_TOKEN: gw.token }, windowsHide: true });
    let text = '';
    child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    child.stdin.end();
    child.on('error', reject);
    child.on('close', code => resolve({ code, text }));
  });
  assert.equal(out.code, 0, out.text);
  assert.equal(fs.readFileSync(path.join(work, 'hello.txt'), 'utf8').trim(), 'hi from a chat model');
  assert.match(out.text, /"type":"agent_message","text":"DONE: hello.txt verified\."/);
  assert.ok(toolNames.includes('apply_patch') && toolNames.some(n => n === 'exec_command' || n === 'shell_command'), toolNames.join(','));
  assert.ok(!toolNames.some(n => n.startsWith('multi_agent') || n.endsWith('_goal')), toolNames.join(','));
});
