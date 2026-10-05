// Text tool-calling protocol for models without native function calling.
// The model writes <tool_call>{"name": …, "arguments": {…}}</tool_call> blocks; the host runs them and replies
// with <tool_result> blocks in the next user message. XML-style tags are used instead of markdown fences so that
// specs containing ``` code blocks survive intact.

const RESULT_LIMIT = 20000;

/** Render one JSON-schema property type compactly: string, number, string[], object … */
function typeOf(schema = {}) {
  if (schema.enum) return schema.enum.map(v => JSON.stringify(v)).join(' | ');
  if (schema.type === 'array') return `${typeOf(schema.items)}[]`;
  return schema.type || 'any';
}

/** The tools section appended to the system prompt. */
export function protocolPrompt(tools) {
  const list = tools.map(t => {
    const props = t.inputSchema?.properties || {};
    const required = new Set(t.inputSchema?.required || []);
    const params = Object.entries(props).map(([k, v]) => `- ${k} (${typeOf(v)}${required.has(k) ? ', required' : ''})${v.description ? `: ${v.description}` : ''}`);
    return `## ${t.name}\n${t.description}\n${params.length ? `Parameters:\n${params.join('\n')}` : 'No parameters.'}`;
  }).join('\n\n');
  return `
# Tools

You have no built-in tools. Instead, call the tools below by writing tool call blocks in your reply:

<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>

- The content must be one valid JSON object with "name" and "arguments". Escape newlines and quotes inside JSON strings.
- You may write several tool calls in one reply; they run in order. After your last call, stop writing and wait: the results arrive in the next message as <tool_result> blocks.
- Never write <tool_result> blocks yourself and never guess what a tool returned.
- Text outside tool call blocks is shown to the user. A reply without tool calls ends your turn, so finish with a short message for the user.

${list}`.trim();
}

/** Strip a ```json … ``` fence some models put inside the block. */
function unfence(s) {
  const m = s.trim().match(/^```[\w-]*\s*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : s.trim();
}

/**
 * Split a model reply into visible text and tool calls.
 * @returns {{ text: string, calls: Array<{ name: string, arguments: object } | { error: string, raw: string }> }}
 */
export function parseReply(reply) {
  let src = String(reply ?? '');
  // A model that keeps going after its calls sometimes invents results; drop everything from there.
  const fake = src.search(/<tool_result\b/);
  if (fake !== -1) src = src.slice(0, fake);
  const calls = [];
  const parts = [];
  const re = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    parts.push(src.slice(last, m.index));
    last = re.lastIndex;
    const raw = unfence(m[1]);
    if (!raw) continue;
    try {
      const v = JSON.parse(raw);
      const name = v.name ?? v.tool;
      const args = v.arguments ?? v.args ?? v.input ?? {};
      if (typeof name !== 'string' || !name) calls.push({ error: 'missing "name"', raw });
      else calls.push({ name, arguments: typeof args === 'string' ? JSON.parse(args) : args });
    } catch (e) {
      calls.push({ error: `invalid JSON: ${e.message}`, raw });
    }
    if (m[0].length === 0) break;
  }
  parts.push(src.slice(last));
  const text = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  return { text, calls };
}

/** One user message carrying the results of a reply's tool calls. */
export function formatResults(results) {
  return results.map(({ name, value, error }) => {
    let body = error ? JSON.stringify({ error }) : typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    if (body.length > RESULT_LIMIT) body = `${body.slice(0, RESULT_LIMIT)}\n… (truncated, ${body.length} chars total)`;
    return `<tool_result name="${name}"${error ? ' error="true"' : ''}>\n${body}\n</tool_result>`;
  }).join('\n\n');
}
