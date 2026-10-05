// 任务板：Router 进程内存中的唯一状态源。
// 所有 agent 的板工具调用经 RPC 落到这里（见 core/rpc.mjs），变更即时以事件广播给调度器与主代理；
// board.json 只是快照（原子写），供 Web 界面读取，进程外不再写它。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const now = () => new Date().toISOString();

export class Board extends EventEmitter {
  /** @param {string} file board.json 路径；已存在则载入（--resume 续接） */
  constructor(file) {
    super();
    this.file = file;
    let data = null;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    this.seq = data?.seq || { task: 0, msg: 0 };
    this.tasks = data?.tasks || [];
    this.messages = data?.messages || [];
    this.finished = data?.finished || null;
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ seq: this.seq, tasks: this.tasks, messages: this.messages, ...(this.finished ? { finished: this.finished } : {}) }, null, 1));
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, this.file); return; }
      catch (e) { if (i >= 20) { try { fs.unlinkSync(tmp); } catch {} throw e; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
    }
  }

  task(id) { return this.tasks.find(t => t.id === id) || null; }

  createTask({ title, spec = '', assignee, blocked_by = [], isolated = false }, by) {
    const task = {
      id: `T${++this.seq.task}`, title, spec, assignee, blocked_by, isolated: !!isolated,
      status: 'pending', result: null, artifacts: [], created_by: by, created_at: now(), updated_at: now()
    };
    this.tasks.push(task);
    this.save();
    this.emit('task:created', task);
    return task;
  }

  /** 更新任务字段；by 记录是谁改的（router / agent 名） */
  updateTask(id, patch, by = 'router') {
    const task = this.task(id);
    if (!task) return null;
    const prev = task.status;
    Object.assign(task, patch, { updated_at: now(), updated_by: by });
    if (patch.status === 'in_progress' && !task.started_at) task.started_at = now();
    if (['done', 'failed'].includes(patch.status) && prev !== patch.status) task.finished_at = now();
    this.save();
    this.emit('task:updated', task, prev);
    return task;
  }

  sendMessage({ from, to, content, task_id = null }) {
    const msg = { id: `M${++this.seq.msg}`, from, to, task_id, content, read: false, ts: now() };
    this.messages.push(msg);
    this.save();
    this.emit('message', msg);
    return msg;
  }

  /** 取出发给 name 的消息；广播（to="*"）按收件人分别记录已读（readBy） */
  inbox(name, { unreadOnly = false, markRead = true } = {}) {
    const isRead = m => m.to === '*' ? (m.readBy || []).includes(name) : m.read;
    const mine = this.messages.filter(m => (m.to === name || m.to === '*') && m.from !== name && (!unreadOnly || !isRead(m)));
    if (markRead && mine.some(m => !isRead(m))) {
      for (const m of mine) {
        if (m.to === '*') m.readBy = [...new Set([...(m.readBy || []), name])];
        else m.read = true;
      }
      this.save();
    }
    return mine;
  }

  finish(summary, by) {
    this.finished = { summary, at: now(), by };
    this.save();
    this.emit('finished', this.finished);
  }
}
