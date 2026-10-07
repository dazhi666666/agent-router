// Text tool-calling protocol for models without native function calling.
//
// JSON tools:      <tool_call>{"name": "exec_command", "arguments": {"cmd": "npm test"}}</tool_call>
// Freeform tools:  <tool_call name="apply_patch">
//                  *** Begin Patch
//                  …
//                  *** End Patch
//                  </tool_call>
//
// The host runs the calls and replies with <tool_result> blocks in the next user message. XML-style tags are used
// instead of markdown fences so code inside arguments survives intact. Freeform bodies are raw text (no JSON
// escaping), and end at a </tool_call> that starts a line, so a patch can even contain the tag itself.

const RESULT_LIMIT = 30000;

/** Render one JSON-schema property type compactly: string, number, string[], object … */
function typeOf(schema = {}) {
  if (schema.enum) return schema.enum.map(v => JSON.stringify(v)).join(' | ');
  if (schema.type === 'array') return `${typeOf(schema.items)}[]`;
  return schema.type || 'any';
}

/** The tools section appended to the system prompt. */
export function protocolPrompt(tools) {
  if (!tools.length) return '';
  const list = tools.map(t => {
    if (t.format === 'freeform') return `## ${t.name} (freeform)\n${t.description}`;
    const props = t.inputSchema?.properties || {};
    const required = new Set(t.inputSchema?.required || []);
    const params = Object.entries(props).map(([k, v]) => `- ${k} (${typeOf(v)}${required.has(k) ? ', required' : ''})${v.description ? `: ${v.description}` : ''}`);
    return `## ${t.name}\n${t.description}\n${params.length ? `Parameters:\n${params.join('\n')}` : 'No parameters.'}`;
  }).join('\n\n');
  const freeform = tools.filter(t => t.format === 'freeform').map(t => t.name);
  return `
# Tools

You have no built-in tools. Call the tools below by writing tool call blocks in your reply:

<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>
${freeform.length ? `
Freeform tools (${freeform.join(', ')}) take raw text instead of JSON: put the text between <tool_call name="tool_name"> and a closing </tool_call> on its own line.
` : ''}
- JSON calls must be one valid JSON object with "name" and "arguments"; escape newlines and quotes inside strings.
- You may write several tool calls in one reply; they run in order. After your last call, stop writing and wait: the results arrive in the next message as <tool_result> blocks.
- Never write <tool_result> blocks yourself and never guess what a tool returned.
- Text outside tool call blocks is shown to the user. A reply without tool calls ends your turn, so finish with a message for the user.

${list}`.trim();
}

/** Strip a ```json … ``` fence some models put inside the block. */
function unfence(s) {
  const m = s.trim().match(/^```[\w-]*\s*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : s.trim();
}

const OPEN = /<tool_call(?:\s+name\s*=\s*["']([\w.-]+)["'])?\s*>/g;

/**
 * Split a model reply into visible text and tool calls.
 * Calls are { name, arguments } (JSON form), { name, raw } (named form; the host decides how to read raw),
 * or { error, raw } when a JSON call cannot be parsed.
 */
export function parseReply(reply) {
  const src = String(reply ?? '');
  const calls = [], parts = [];
  let pos = 0;
  for (;;) {
    OPEN.lastIndex = pos;
    const m = OPEN.exec(src);
    const textEnd = m ? m.index : src.length;
    // A model that keeps going after its calls sometimes invents results; drop everything from there.
    const fake = src.slice(pos, textEnd).search(/<tool_result\b/);
    if (fake !== -1) { parts.push(src.slice(pos, pos + fake)); break; }
    parts.push(src.slice(pos, textEnd));
    if (!m) break;
    const bodyStart = m.index + m[0].length;
    let bodyEnd, next;
    if (m[1]) {
      // Named form: the closing tag must start a line (a patch line always starts with + - space or ***).
      const lineClose = /(^|\n)<\/tool_call>/g;
      lineClose.lastIndex = bodyStart;
      const c = lineClose.exec(src);
      const anyClose = src.indexOf('</tool_call>', bodyStart);
      if (c) { bodyEnd = c.index; next = c.index + c[0].length; }
      else if (anyClose !== -1) { bodyEnd = anyClose; next = anyClose + '</tool_call>'.length; }
      else { bodyEnd = next = src.length; }
      calls.push({ name: m[1], raw: src.slice(bodyStart, bodyEnd).replace(/^\r?\n/, '').replace(/\r?\n$/, '') });
    } else {
      const close = src.indexOf('</tool_call>', bodyStart);
      bodyEnd = close === -1 ? src.length : close;
      next = close === -1 ? src.length : close + '</tool_call>'.length;
      const raw = unfence(src.slice(bodyStart, bodyEnd));
      if (raw) {
        try {
          const v = JSON.parse(raw);
          const name = v.name ?? v.tool;
          const args = v.arguments ?? v.args ?? v.input ?? {};
          if (typeof name !== 'string' || !name) calls.push({ error: 'missing "name"', raw });
          else calls.push({ name, arguments: typeof args === 'string' ? safeJson(args) : args });
        } catch (e) {
          calls.push({ error: `invalid JSON: ${e.message}`, raw });
        }
      }
    }
    pos = next;
  }
  const text = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  return { text, calls };
}

function safeJson(s) { try { return JSON.parse(s); } catch { return { input: s }; } }

/**
 * Turn a parsed call into the arguments for a tool definition.
 * Freeform tools get { input: raw text }; JSON tools called in the named form parse the body as JSON arguments.
 */
export function resolveArguments(call, tool) {
  if (tool?.format === 'freeform') {
    if (call.raw !== undefined) return { input: call.raw };
    const a = call.arguments || {};
    return { input: typeof a === 'string' ? a : a.input ?? a.patch ?? a.text ?? '' };
  }
  if (call.raw !== undefined) {
    const raw = unfence(call.raw);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && 'arguments' in v ? v.arguments : v;
  }
  return call.arguments || {};
}

/** One user message carrying the results of a reply's tool calls. */
export function formatResults(results) {
  return results.map(({ name, value, error }) => {
    let body = error ? JSON.stringify({ error }) : typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    if (body.length > RESULT_LIMIT) body = `${body.slice(0, RESULT_LIMIT)}\n… (truncated, ${body.length} chars total)`;
    return `<tool_result name="${name}"${error ? ' error="true"' : ''}>\n${body}\n</tool_result>`;
  }).join('\n\n');
}
