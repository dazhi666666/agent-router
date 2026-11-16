// dsh 适配器测试：node --test lib/dsh.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDshEvent, createDshState, headlessPatch } from './dsh.mjs';
import { setBoardEndpoint } from './spawn-util.mjs';

// boardMcpEntry 需要 endpoint；测试里指向不存在的本地地址即可（不发起连接）
setBoardEndpoint({ url: 'http://127.0.0.1:1/rpc', token: 't' });

test('applyDshEvent 投影 --json 事件到状态与线程条目', () => {
  const entries = [];
  const thread = { add: (kind, data) => entries.push({ kind, data }) };
  const state = createDshState();
  assert.equal(applyDshEvent(state, '非 JSON 行', thread), null);
  assert.equal(applyDshEvent(state, '{broken', thread), null);

  assert.deepEqual(applyDshEvent(state, JSON.stringify({ type: 'session', sessionId: 'session-1', cwd: 'd' }), thread), { sessionId: 'session-1' });
  assert.equal(state.sessionId, 'session-1');

  assert.deepEqual(applyDshEvent(state, JSON.stringify({ type: 'text', text: '你好' }), thread), { assistant: '你好' });
  assert.deepEqual(applyDshEvent(state, JSON.stringify({ type: 'thinking', text: '想想' }), thread), { thought: '想想' });
  applyDshEvent(state, JSON.stringify({ type: 'tool_call', callId: 'c1', tool: 'read_file', input: { p: 1 } }), thread);
  applyDshEvent(state, JSON.stringify({ type: 'tool_result', callId: 'c1', status: 'error', result: '炸了' }), thread);
  assert.deepEqual(applyDshEvent(state, JSON.stringify({ type: 'final', text: ' 完成啦 ' }), thread), { final: '完成啦' });
  assert.equal(state.finalText, '完成啦');
  assert.deepEqual(applyDshEvent(state, JSON.stringify({ type: 'error', message: '坏' }), thread), { error: '坏' });
  assert.equal(state.errorMessage, '坏');

  assert.deepEqual(entries.map(e => e.kind), ['assistant', 'thought', 'tool_use', 'tool_result']);
  assert.deepEqual(entries[2].data, { id: 'c1', name: 'read_file', input: { p: 1 } });
  assert.equal(entries[3].data.isError, true);
  assert.equal(entries[3].data.text, '炸了');
});

test('headlessPatch 生成看板 + 对话级 MCP 的 insert 列表', () => {
  const patch = JSON.parse(headlessPatch({
    agentName: 'T1-dsh',
    mcpServers: {
      web: { type: 'http', url: 'https://x/mcp', headers: { A: 'b' } },
      off: { type: 'stdio', command: 'o', enabled: false },
      helper: { type: 'stdio', command: 'node', args: ['h.js'], env: { K: 'v' }, cwd: '/w' }
    }
  }));
  assert.equal(Object.keys(patch).length, 1);
  const rows = patch.insert;
  assert.equal(rows.length, 3);
  const [board, web, helper] = rows;
  assert.equal(board.id, 'router-board-mcp');
  assert.equal(board.name, '@deepseek-ai/dsh-mcp-client');
  assert.equal(board.config.serverName, 'board');
  assert.equal(board.config.transport, 'stdio');
  assert.equal(board.config.env.AGENT_NAME, 'T1-dsh');
  assert.ok(board.config.env.ROUTER_URL && board.config.env.ROUTER_TOKEN);
  assert.equal(web.config.serverName, 'web');
  assert.equal(web.config.transport, 'streamable-http');
  assert.equal(web.config.url, 'https://x/mcp');
  assert.equal(web.config.headers.A, 'b');
  assert.equal(helper.config.transport, 'stdio');
  assert.equal(helper.config.command, 'node');
  assert.deepEqual(helper.config.args, ['h.js']);
  assert.deepEqual(helper.config.env, { K: 'v' });
  assert.equal(helper.config.cwd, '/w');
  // 无对话级 MCP 时只有看板一条
  assert.equal(JSON.parse(headlessPatch({ agentName: 'm' })).insert.length, 1);
});
