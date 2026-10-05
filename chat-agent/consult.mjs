// consult: a tool any agent can call to ask a chat-only model for a second opinion.
// The model sees only the request, so the host inlines the files the caller lists.
import fs from 'node:fs';
import path from 'node:path';
import { resolveInside } from './fs-tools.mjs';

const FILE_LIMIT = 100000;   // chars per attached file
const TOTAL_LIMIT = 400000;  // chars across all attached files

export function consultSchema(label = 'an expert model') {
  return {
    description: `Ask ${label}, a strong reasoning model with no tool access, for a second opinion: design decisions, hard bugs, reviewing a plan or a diff. It sees only this request, so include everything it needs: state the question precisely, add context (what you tried, errors, constraints), and list relevant files in "files" so their contents are attached. It can take minutes; use it for hard problems, not routine lookups. Its answer is advice: verify it before acting on it.`,
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The precise question to answer' },
        context: { type: 'string', description: 'Optional. Background: goal, what you tried, error output, constraints' },
        files: { type: 'array', items: { type: 'string' }, description: 'Optional. Paths (relative to the working directory) whose contents should be attached' }
      },
      required: ['question']
    }
  };
}

const SYSTEM = `You are a senior engineer consulted by a coding agent working on a software project. You cannot run tools or see anything beyond this message. Answer the question directly and concretely: name files, functions and exact changes where relevant, and explain the reasoning briefly. If the information given is not enough to be sure, say what is missing and give your best assessment with its assumptions.`;

/**
 * @param {{ provider: { complete: Function } | (() => Promise<object>), root: string }} opts
 * @returns {(args: { question: string, context?: string, files?: string[] }, from?: string) => Promise<object>}
 */
export function createConsult({ provider, root }) {
  const getProvider = typeof provider === 'function' ? provider : async () => provider;
  return async ({ question, context, files = [] } = {}, from = null) => {
    if (!question) return { error: 'question is required' };
    const attached = [], skipped = [];
    let total = 0;
    for (const f of Array.isArray(files) ? files : []) {
      try {
        let text = fs.readFileSync(resolveInside(root, f), 'utf8');
        if (text.length > FILE_LIMIT) text = `${text.slice(0, FILE_LIMIT)}\n… (truncated)`;
        if (total + text.length > TOTAL_LIMIT) { skipped.push(`${f} (attachment limit reached)`); continue; }
        total += text.length;
        attached.push(`<file path="${path.normalize(f).split(path.sep).join('/')}">\n${text}\n</file>`);
      } catch (e) { skipped.push(`${f} (${e.code === 'ENOENT' ? 'not found' : e.message})`); }
    }
    const user = [
      from ? `Asked by: ${from}` : '',
      `# Question\n${question}`,
      context ? `# Context\n${context}` : '',
      attached.length ? `# Files\n${attached.join('\n\n')}` : ''
    ].filter(Boolean).join('\n\n');
    const p = await getProvider();
    const res = await p.complete([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]);
    return { answer: res.text, ...(skipped.length ? { files_not_attached: skipped } : {}) };
  };
}
