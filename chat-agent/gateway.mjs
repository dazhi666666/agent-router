// Responses gateway: lets Codex (codex-rs) drive a chat-only model.
//
// Codex is the agent: its own tools (shell / exec_command, apply_patch, update_plan, MCP …), sandbox, approvals and
// context compaction all stay as they are. Codex talks to custom model providers only over the OpenAI Responses API,
// so this server speaks that API and translates for a model that can only chat:
//
//   request  instructions + input items + tools  →  chat messages; tools rendered into the text protocol (protocol.mjs)
//   reply    <tool_call> blocks in the model's text →  function_call / custom_tool_call output items
//
// Earlier calls and their outputs in the input are rendered back as <tool_call> / <tool_result> text, so the model
// sees one consistent protocol. Malformed or unknown calls are bounced back to the model (up to `repairs` times)
// before anything is returned to Codex.
//
// Point Codex at it with a provider: base_url = http://127.0.0.1:<port>/v1, wire_api = "responses",
// env_key = <variable holding the gateway token>, and -m <model name the gateway knows>.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { protocolPrompt, parseReply, resolveArguments } from './protocol.mjs';

// Codex's own default base instructions (codex-rs/protocol/src/prompts/base_instructions/default.md; see codex/README.md)
const CODEX_BASE_INSTRUCTIONS = fs.readFileSync(new URL('./codex/base_instructions.md', import.meta.url), 'utf8');

const rid = p => `${p}_${crypto.randomBytes(12).toString('hex')}`;

/** Codex tool specs → protocol tool definitions (namespaces are flattened to their full names). */
export function convertTools(specs = []) {
  const tools = [], skipped = [];
  for (const s of specs) {
    if (s.type === 'function') tools.push({ name: s.name, description: s.description || '', inputSchema: s.parameters || {} });
    else if (s.type === 'custom') {
      const grammar = s.format?.definition ? `\n\nInput grammar (${s.format.syntax || 'lark'}):\n${s.format.definition}` : '';
      tools.push({ name: s.name, description: `${s.description || ''}${grammar}`, format: 'freeform' });
    } else if (s.type === 'namespace') {
      for (const t of s.tools || []) {
        const inner = convertTools([t]).tools[0];
        if (inner) tools.push({ ...inner, name: qualified({ namespace: s.name, name: t.name }), namespace: s.name, innerName: t.name });
      }
    } else skipped.push(s.type);
  }
  return { tools, skipped };
}

// mcp__board__ + create_task → mcp__board__create_task; multi_agent_v1 + spawn_agent → multi_agent_v1.spawn_agent
const qualified = item => !item.namespace ? item.name : /[_.:-]$/.test(item.namespace) ? `${item.namespace}${item.name}` : `${item.namespace}.${item.name}`;

const textOf = content => typeof content === 'string' ? content : (content || []).map(c =>
  c.text ?? (c.type === 'input_image' ? '[image omitted: this model cannot see images]' : '')).filter(Boolean).join('\n');

function outputText(output) {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return textOf(output);
  if (typeof output.body === 'string') return output.body;
  if (Array.isArray(output.body)) return textOf(output.body);
  if (typeof output.content === 'string') return output.content;
  return JSON.stringify(output);
}

/** Responses input items → alternating chat messages (after the system message). */
export function convertInput(input = [], toolByName = new Map()) {
  const out = [];
  const names = new Map(); // call_id → tool name as the model knows it
  const push = (role, content) => {
    if (!content) return;
    const last = out.at(-1);
    if (last?.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  };
  for (const item of input) {
    const type = item.type || (item.role ? 'message' : '');
    if (type === 'message') {
      const text = textOf(item.content);
      if (item.role === 'assistant') push('assistant', text);
      else if (item.role === 'developer' || item.role === 'system') push('user', `<developer_instructions>\n${text}\n</developer_instructions>`);
      else push('user', text);
    } else if (type === 'function_call') {
      const name = qualified(item);
      names.set(item.call_id, name);
      let args = item.arguments;
      try { args = JSON.parse(item.arguments); } catch {}
      push('assistant', `<tool_call>\n${JSON.stringify({ name, arguments: args })}\n</tool_call>`);
    } else if (type === 'custom_tool_call') {
      const name = qualified(item);
      names.set(item.call_id, name);
      push('assistant', `<tool_call name="${name}">\n${item.input}\n</tool_call>`);
    } else if (type === 'local_shell_call') {
      names.set(item.call_id, 'shell');
      push('assistant', `<tool_call>\n${JSON.stringify({ name: 'shell', arguments: item.action })}\n</tool_call>`);
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      const name = names.get(item.call_id) || item.name || 'tool';
      push('user', `<tool_result name="${name}">\n${outputText(item.output)}\n</tool_result>`);
    } else if (type === 'compaction' || type === 'compaction_summary') {
      push('user', `[Summary of earlier conversation]\n${item.summary || item.encrypted_content || ''}`);
    }
    // reasoning / web_search_call / other items carry nothing a chat model can use
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '(conversation start)' });
  return out;
}

/** Turn a parsed reply into Responses output items; returns { items, problems } where problems need a retry. */
export function toOutputItems(reply, tools) {
  const byName = new Map(tools.map(t => [t.name, t]));
  const { text, calls } = parseReply(reply);
  const items = [], problems = [];
  if (text) items.push({ type: 'message', id: rid('msg'), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
  for (const call of calls) {
    if (call.error) { problems.push(`Malformed tool call (${call.error}). Write one JSON object: {"name": "...", "arguments": {...}}`); continue; }
    const tool = byName.get(call.name);
    if (!tool) { problems.push(`Unknown tool "${call.name}". Available tools: ${tools.map(t => t.name).join(', ')}`); continue; }
    let args;
    try { args = resolveArguments(call, tool); }
    catch (e) { problems.push(`Could not read the arguments of ${call.name}: ${e.message}`); continue; }
    const name = tool.innerName || tool.name;
    const ns = tool.namespace ? { namespace: tool.namespace } : {};
    if (tool.format === 'freeform') items.push({ type: 'custom_tool_call', id: rid('ctc'), status: 'completed', call_id: rid('call'), name, ...ns, input: args.input });
    else items.push({ type: 'function_call', id: rid('fc'), status: 'completed', call_id: rid('call'), name, ...ns, arguments: JSON.stringify(args) });
  }
  return { items, problems, text };
}

/**
 * Codex model metadata (ModelInfo, served from /models) for a chat model: freeform apply_patch, shell_command,
 * text-only input, no reasoning/verbosity/search parameters. Codex picks its tools from this.
 */
export function codexModelInfo({ name, label, contextWindow = 128000, baseInstructions = CODEX_BASE_INSTRUCTIONS }) {
  return {
    base_instructions: baseInstructions,
    slug: name, display_name: label || name, description: 'Chat model behind the Agent Router Responses gateway',
    default_reasoning_level: null, supported_reasoning_levels: [], shell_type: 'shell_command', visibility: 'list',
    supported_in_api: true, priority: 0, availability_nux: null, upgrade: null,
    apply_patch_tool_type: 'freeform', web_search_tool_type: 'text', supports_search_tool: false,
    truncation_policy: { mode: 'tokens', limit: 10000 }, supports_parallel_tool_calls: true,
    context_window: contextWindow, max_context_window: contextWindow, auto_compact_token_limit: Math.floor(contextWindow * 0.8),
    input_modalities: ['text'], supports_image_detail_original: false, prefer_websockets: false, use_responses_lite: false,
    support_verbosity: false, default_verbosity: null, supports_reasoning_summary_parameter: false, supports_reasoning_summaries: false,
    default_reasoning_summary: 'none', supports_reasoning_effort_updates: false,
    include_skills_usage_instructions: false, include_apps_usage_instructions: false, include_plugin_usage_instructions: false,
    experimental_supported_tools: [], service_tiers: [], additional_speed_tiers: [], default_service_tier: null,
    tool_mode: null, multi_agent_version: null, node_repl_disabled: true, supports_experimental_context: false
  };
}

/**
 * @param {{ models: (name: string) => Promise<{ complete: Function } | null>, catalog?: () => object[], token?: string, repairs?: number,
 *           onRequest?: (info: object) => void, log?: (msg: string) => void }} opts
 *   models(name) resolves the provider for the "model" field of a request (null → 404)
 * @returns {Promise<{ url: string, token: string, close: () => void, server: http.Server }>}
 */
export function startGateway({ models, catalog = () => [], token = crypto.randomBytes(16).toString('hex'), repairs = 2, onRequest, log = () => {}, port = 0 } = {}) {
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const url = new URL(req.url, 'http://x');
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: { message: 'unauthorized' } });
    if (req.method === 'GET' && /\/models$/.test(url.pathname)) return json(200, { models: catalog() });
    if (req.method !== 'POST' || !/\/responses$/.test(url.pathname)) return json(404, { error: { message: `not found: ${req.method} ${url.pathname}` } });
    let body = '';
    for await (const chunk of req) body += chunk;
    let request;
    try { request = JSON.parse(body); } catch { return json(400, { error: { message: 'invalid JSON' } }); }
    const provider = await models(request.model);
    if (!provider) return json(404, { error: { message: `unknown model ${request.model}` } });

    const { tools, skipped } = convertTools(request.tools || []);
    const system = [request.instructions, protocolPrompt(tools)].filter(Boolean).join('\n\n');
    const messages = [{ role: 'system', content: system }, ...convertInput(request.input || [])];
    onRequest?.({ model: request.model, tools: tools.map(t => t.name), skipped, messages: messages.length });

    const responseId = rid('resp');
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let seq = 0;
    const send = ev => res.write(`event: ${ev.type}\ndata: ${JSON.stringify({ ...ev, sequence_number: seq++ })}\n\n`);
    const base = { id: responseId, object: 'response', created_at: Math.floor(Date.now() / 1000), model: request.model };
    send({ type: 'response.created', response: { ...base, status: 'in_progress', output: [] } });
    // 长时间思考时保持连接：SSE 注释不会被当成事件
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
    try {
      let reply, reasoning = '', result;
      for (let attempt = 0; ; attempt++) {
        const r = await provider.complete(messages, { signal: abort.signal });
        reply = r.text || ''; reasoning = r.reasoning || reasoning;
        result = toOutputItems(reply, tools);
        if (!result.problems.length || attempt >= repairs) break;
        log(`repairing reply (${result.problems.join(' | ')})`);
        messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `[gateway] Your last reply could not be executed:\n- ${result.problems.join('\n- ')}\nWrite the reply again with valid tool calls.` });
      }
      const items = result.items;
      if (reasoning) items.unshift({ type: 'reasoning', id: rid('rs'), summary: [], content: [{ type: 'reasoning_text', text: reasoning }], encrypted_content: null });
      if (!items.length) items.push({ type: 'message', id: rid('msg'), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: result.problems.length ? `(The model's reply could not be executed: ${result.problems.join('; ')})` : '(empty reply)', annotations: [] }] });
      items.forEach((item, output_index) => {
        send({ type: 'response.output_item.added', output_index, item });
        if (item.type === 'message') send({ type: 'response.output_text.delta', output_index, content_index: 0, item_id: item.id, delta: item.content[0].text });
        send({ type: 'response.output_item.done', output_index, item });
      });
      const inChars = messages.reduce((n, m) => n + m.content.length, 0);
      const outTokens = Math.ceil((reply.length + reasoning.length) / 4), inTokens = Math.ceil(inChars / 4);
      send({ type: 'response.completed', response: { ...base, status: 'completed', output: items, usage: { input_tokens: inTokens, input_tokens_details: null, output_tokens: outTokens, output_tokens_details: null, total_tokens: inTokens + outTokens } } });
    } catch (e) {
      log(`model call failed: ${e.message}`);
      if (!abort.signal.aborted) send({ type: 'response.failed', response: { ...base, status: 'failed', error: { code: 'server_error', message: `chat model call failed: ${e.message}` } } });
    } finally {
      clearInterval(keepalive);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.unref();
      resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, token, close: () => server.close(), server });
    });
  });
}

/**
 * Codex command-line overrides that select a gateway model as Codex's provider.
 * @param {{ url: string, model: string, tokenEnv: string, contextWindow?: number }} o
 */
export function codexProviderArgs({ url, model, tokenEnv, providerId = 'chat_gateway' }) {
  return [
    '-c', `model_provider=${JSON.stringify(providerId)}`,
    '-c', `model_providers.${providerId}={ name = "Chat gateway", base_url = ${JSON.stringify(url)}, wire_api = "responses", env_key = ${JSON.stringify(tokenEnv)} }`,
    '-m', model
  ];
}
