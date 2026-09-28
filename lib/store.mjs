// Atomic JSON store shared by all board-server instances.
// Writers across processes serialize on a temp-file + rename with retry
// (rename over an open file briefly fails on Windows).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function emptyBoard() {
  return { seq: { task: 0, msg: 0 }, tasks: [], messages: [] };
}

function readBoard(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return emptyBoard();
    throw e;
  }
}

function writeBoard(file, data) {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
  );
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  let lastErr;
  for (let i = 0; i < 20; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}

/** Read-modify-write under cross-process rename lock. fn(board) mutates the board in place; its return value is ignored. */
export function mutate(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const started = Date.now();
  for (;;) {
    try { const fd = fs.openSync(lock, 'wx'); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const owner = Number(fs.readFileSync(lock, 'utf8'));
        try { process.kill(owner, 0); }
        catch (err) { if (err.code === 'ESRCH' || err.code === 'EPERM') { try { fs.unlinkSync(lock); } catch {} continue; } }
      } catch {}
      if (Date.now() - started > 10000) throw new Error('任务板正忙，请稍后重试');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
  for (let attempt = 0; ; attempt++) {
    const board = readBoard(file);
    const before = JSON.stringify(board);
    fn(board);
    const after = JSON.stringify(board);
    if (after === before) return board;
    try {
      writeBoard(file, board);
      return board;
    } catch (e) {
      if (attempt >= 10) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * (attempt + 1));
    }
  }
  } finally { try { fs.unlinkSync(lock); } catch {} }
}

export function read(file) {
  return readBoard(file);
}
