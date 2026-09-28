import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-][\w.-]{0,180}$/.test(value) && value !== '..';
export const threadSessionId = (runId, thread) => `run_${Buffer.from(JSON.stringify([runId, thread])).toString('base64url')}`;
export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export class Sessions {
  constructor(dataDir, defaultRepo) {
    this.dataDir = dataDir;
    this.defaultRepo = defaultRepo;
    this.file = path.join(dataDir, 'sessions.json');
    this.items = readJson(this.file, {});
  }
  save() { writeJson(this.file, this.items); }
  create(id) {
    if (id && this.items[id]) return this.items[id];
    if (!safeId(id) || id.startsWith('run_')) id = `draft-${crypto.randomUUID()}`;
    const item = { id, createdAt: Date.now(), runId: null, thread: 'manager', settings: { repo: this.defaultRepo, agents: ['claude', 'zcode'], main: 'claude', timeout: 900, worktree: false, models: {} } };
    this.items[id] = item;
    this.save();
    return item;
  }
  resolve(id) {
    if (Object.hasOwn(this.items, id)) return this.items[id];
    if (!String(id).startsWith('run_')) return null;
    try {
      const [runId, thread] = JSON.parse(Buffer.from(id.slice(4), 'base64url').toString());
      if (!safeId(runId) || !safeId(thread) || !fs.existsSync(path.join(this.dataDir, runId))) return null;
      return { id, runId, thread, settings: readJson(path.join(this.dataDir, runId, 'run.json'))?.settings ?? null };
    } catch { return null; }
  }
  bind(id, runId) { this.items[id].runId = runId; this.save(); }
  managerId(runId) {
    return Object.values(this.items).find(s => s.runId === runId)?.id || threadSessionId(runId, 'manager');
  }
}
