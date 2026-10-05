// Read-only file tools run by the host on the model's behalf, confined to one root directory.
// They let a chat-only model look at the code itself instead of sending a subagent for every question.
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target', '.cache']);
const MAX_FILE = 1024 * 1024;

export const FS_TOOL_SCHEMAS = {
  read_file: {
    description: 'Read a text file in the working directory. Returns numbered lines. Use offset/limit for large files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the working directory' },
        offset: { type: 'number', description: 'Optional. First line to return (1-based)' },
        limit: { type: 'number', description: 'Optional. Number of lines to return (default 800)' }
      },
      required: ['path']
    }
  },
  list_files: {
    description: 'List files under a directory of the working directory, recursively (skips .git, node_modules and build output).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional. Directory relative to the working directory (default: the root)' },
        depth: { type: 'number', description: 'Optional. Maximum depth (default 3)' }
      }
    }
  },
  search: {
    description: 'Search file contents with a regular expression. Returns matching lines as path:line: text.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression (case-insensitive)' },
        path: { type: 'string', description: 'Optional. Directory or file to search (default: the root)' }
      },
      required: ['pattern']
    }
  }
};

/** Resolve a user-supplied path inside root, or throw. */
export function resolveInside(root, p = '.') {
  const abs = path.resolve(root, String(p || '.'));
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path is outside the working directory: ${p}`);
  return abs;
}

function* walk(dir, depth, maxDepth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield { full, dir: true, depth };
      if (depth < maxDepth) yield* walk(full, depth + 1, maxDepth);
    } else if (e.isFile()) yield { full, dir: false, depth };
  }
}

const isBinary = buf => buf.subarray(0, 8000).includes(0);

/**
 * @param {string} root
 * @returns {{ tools: object[], has(name: string): boolean, invoke(name: string, args: object): object }}
 */
export function createFsTools(root) {
  const rel = p => path.relative(root, p).split(path.sep).join('/') || '.';
  const impl = {
    read_file({ path: p, offset = 1, limit = 800 }) {
      const abs = resolveInside(root, p);
      const st = fs.statSync(abs);
      if (!st.isFile()) return { error: `${p} is not a file` };
      if (st.size > MAX_FILE * 4) return { error: `${p} is too large (${st.size} bytes)` };
      const buf = fs.readFileSync(abs);
      if (isBinary(buf)) return { error: `${p} looks like a binary file` };
      const lines = buf.toString('utf8').split(/\r?\n/);
      const start = Math.max(1, Math.floor(offset)), end = Math.min(lines.length, start - 1 + Math.max(1, Math.floor(limit)));
      const body = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n');
      return `${rel(abs)} (lines ${start}-${end} of ${lines.length})\n${body}`;
    },
    list_files({ path: p = '.', depth = 3 }) {
      const abs = resolveInside(root, p);
      const out = [];
      for (const e of walk(abs, 1, Math.min(8, Math.max(1, depth)))) {
        out.push(`${rel(e.full)}${e.dir ? '/' : ''}`);
        if (out.length >= 500) { out.push('… (truncated at 500 entries)'); break; }
      }
      return out.join('\n') || '(empty)';
    },
    search({ pattern, path: p = '.' }) {
      let re;
      try { re = new RegExp(pattern, 'i'); } catch (e) { return { error: `invalid pattern: ${e.message}` }; }
      const abs = resolveInside(root, p);
      const files = fs.statSync(abs).isFile() ? [{ full: abs }] : [...walk(abs, 1, 20)].filter(e => !e.dir);
      const out = [];
      for (const { full } of files) {
        let buf;
        try { if (fs.statSync(full).size > MAX_FILE) continue; buf = fs.readFileSync(full); } catch { continue; }
        if (isBinary(buf)) continue;
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i])) continue;
          out.push(`${rel(full)}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
          if (out.length >= 200) return `${out.join('\n')}\n… (truncated at 200 matches)`;
        }
      }
      return out.join('\n') || 'No matches.';
    }
  };
  return {
    tools: Object.entries(FS_TOOL_SCHEMAS).map(([name, def]) => ({ name, ...def })),
    has: name => Object.hasOwn(impl, name),
    invoke(name, args = {}) {
      try { return impl[name](args); } catch (e) { return { error: e.message }; }
    }
  };
}
