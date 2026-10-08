// 常驻「主代理」Claude 会话 —— 一次运行的主线程。
// 用 `claude -p --input-format stream-json --output-format stream-json` 起一个长期存活的进程:
// 目标和实时事件从 stdin 注入(排队到当前回合结束后处理),agentic 回合从 stdout 流出。
// 进程意外退出时用 --resume 同一会话续命重启,主线程不丢上下文。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { boardMcpEntry, writeTempJson } from './spawn-util.mjs';
import { createThreadWriter, claudeEventEntries } from './thread.mjs';

const IDLE_WATCHDOG_MS = 10 * 60 * 1000; // 持续无输出超过此时长则强制重启续命
const MAX_RESTARTS = 8;

export class MainSession {
  /**
   * opts: {
   *   cwd, agentName, roster, dataFile, logDir, systemPrompt,
   *   onText(text), onTool(name, input), onTurnEnd(resultEvent), onNotice(message)
   * }
   */
  constructor({ resumeId = null, cwd, agentName = 'manager', roster, dataFile, logDir, systemPrompt = '', onText, onTool, onTurnEnd, onNotice, threadPath }) {
    this.cwd = cwd;
    this.agentName = agentName;
    this.roster = roster;
    this.dataFile = dataFile;
    this.logDir = logDir;
    this.systemPrompt = systemPrompt;
    this.thread = threadPath ? createThreadWriter(threadPath) : null;
    this.onText = onText || (() => {});
    this.onTool = onTool || (() => {});
    this.onTurnEnd = onTurnEnd || (() => {});
    this.onNotice = onNotice || (() => {});
    this.queue = [];        // 忙碌期间排队的事件,回合结束后合并注入
    this.busy = false;      // true = 当前有一个回合在处理
    this.sessionId = resumeId; // --resume 续接上次会话
    this.stopped = false;
    this.restarts = 0;
    this.child = null;
    this.watchdog = null;
    this.awaitingInit = false;
    this.startedAt = 0;
    this.errTail = '';
  }

  start() {
    const cfg = loadConfig().claude;
    this.mcpFile = writeTempJson(this.logDir, `mcp-${this.agentName}.json`, {
      mcpServers: { board: boardMcpEntry({ agentName: this.agentName, dataFile: this.dataFile, roster: this.roster }) }
    });
    // 线程留档实际发送的系统提示词：claude 经 --append-system-prompt 注入，随每次请求生效
    // 续接时系统提示词已在线程里留档过
    if (this.systemPrompt && !this.sessionId) this.thread?.add('system', { text: this.systemPrompt, via: 'append-system-prompt' });
    this._spawn(cfg, this.sessionId);
  }

  _spawn(cfg, resumeId) {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--mcp-config', this.mcpFile,
      '--permission-mode', 'bypassPermissions'
    ];
    if (this.systemPrompt) args.push('--append-system-prompt', this.systemPrompt);
    if (resumeId) args.push('--resume', resumeId);
    if (cfg.model) args.push('--model', cfg.model);
    if (cfg.effort) args.push('--effort', cfg.effort);
    const env = {};
    if (cfg.proxy) { env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; }
    let child;
    try {
      child = spawn(cfg.exe, args, { cwd: this.cwd, env: { ...process.env, ...env }, windowsHide: true });
    } catch (e) {
      this.onNotice(`主会话启动失败: ${e.message}`);
      return;
    }
    this.child = child;
    this.startedAt = Date.now();
    this.errTail = '';
    this.awaitingInit = true; // 启动阶段（init 未到）也受看门狗保护
    this.streamLog = fs.createWriteStream(path.join(this.logDir, 'manager-stream.log'), { flags: 'a' });
    this.streamLog.write(`\n===== ${new Date().toISOString()} spawn${resumeId ? ' (resume)' : ''} =====\n`);

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
      this._feedWatchdog();
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) this._handleLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { this.errTail = (this.errTail + d).slice(-4000); });
    child.on('error', e => { this.errTail += `\nspawn error: ${e.message}`; });
    child.on('close', code => this._onClose(code));
    this._feedWatchdog();
  }

  _handleLine(line) {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    try { this.streamLog.write(line + '\n'); } catch {}
    if (this.thread) for (const e of claudeEventEntries(ev)) this.thread.add(e.kind, e.data);
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.session_id) this.sessionId = ev.session_id;
      this.awaitingInit = false;
      this.busy = false;
      this._feedWatchdog(); // 先解除武装（空闲不再计时），再刷队列（_write 会重新武装）
      this._flush();
    } else if (ev.type === 'assistant') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'text' && block.text) this.onText(block.text);
        else if (block.type === 'tool_use') this.onTool(block.name, block.input || {});
      }
    } else if (ev.type === 'result') {
      this.busy = false;
      this.onTurnEnd(ev);
      if (this.modelReload) { this.modelReload = false; this.child?.kill(); }
      else this._flush();
    }
  }

  /** 注入一条 user 消息;忙碌时排队,空闲时立即写入 */
  send(text) {
    if (this.stopped || !text) return;
    if (this.busy || !this.child?.stdin?.writable) { this.queue.push(text); return; }
    this._write(text);
  }

  _write(text) {
    this.busy = true;
    this.thread?.add('user', { text });
    this._feedWatchdog();
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
    try { this.child.stdin.write(msg); } catch {
      this.busy = false;
      this.queue.push(text);
    }
  }

  _flush() {
    if (this.busy || this.stopped || !this.queue.length) return;
    if (!this.child?.stdin?.writable) return;
    const text = this.queue.splice(0).join('\n\n');
    this._write(text);
  }

  _feedWatchdog() {
    clearTimeout(this.watchdog);
    if (this.stopped) return;
    this.watchdog = setTimeout(() => {
      // 只在真挂死时强杀：回合在跑（busy）或启动阶段 init 未到（awaitingInit）。
      // 空闲等待不算——chat 模式在等用户下一条消息、goal 模式在等子代理结果，
      // 杀掉健康空闲进程只会陷入"杀→resume→又空闲→又杀"的循环。
      if (!this.busy && !this.awaitingInit) return;
      this.onNotice(`主会话超过 ${Math.round(IDLE_WATCHDOG_MS / 60000)} 分钟无输出，强制重启续命…`);
      try { this.child.kill('SIGKILL'); } catch {}
    }, IDLE_WATCHDOG_MS);
  }

  _onClose(code) {
    clearTimeout(this.watchdog);
    try { this.streamLog?.end(`===== close code=${code} =====\n`); } catch {}
    this.child = null;
    if (this.stopped) return;
    this.busy = false;
    if (Date.now() - this.startedAt > 5 * 60 * 1000) this.restarts = 0; // 稳定跑够 5 分钟则重置计数
    this.restarts++;
    if (this.restarts > MAX_RESTARTS) {
      this.onNotice(`主会话连续退出 ${this.restarts} 次，放弃重启。stderr 尾部: ${this.errTail.slice(-300)}`);
      return;
    }
    const delay = Math.min(2000 * this.restarts, 15000);
    this.onNotice(`主会话进程退出(code=${code})，${Math.round(delay / 1000)}s 后 --resume 续命重启…`);
    setTimeout(() => { if (!this.stopped) this._spawn(loadConfig().claude, this.sessionId); }, delay);
  }

  requestModelReload() {
    if (this.stopped) return;
    if (this.busy) this.modelReload = true;
    else this.child?.kill();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.watchdog);
    try { this.child?.kill(); } catch {}
  }
}
