// Shared plumbing for spawning agent CLI processes with the board MCP server attached.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';

const BOARD_SERVER = fileURLToPath(new URL('./board-server.mjs', import.meta.url));
const PROJECT_ROOT = path.dirname(path.dirname(BOARD_SERVER));

// Router 启动时设置本次运行的 RPC 端点（core/rpc.mjs）；各适配器拿到的 board MCP 条目都指向它
let endpoint = null;
export function setBoardEndpoint(value) { endpoint = value; }

/** 某个 agent 的 board MCP 服务条目（stdio 代理 → Router RPC）。dataFile/roster 参数保留兼容，已不再使用。 */
export function boardMcpEntry({ agentName }) {
  if (!endpoint) throw new Error('board endpoint not initialized (setBoardEndpoint)');
  return {
    command: process.execPath,
    args: [BOARD_SERVER],
    env: {
      AGENT_NAME: agentName,
      ROUTER_URL: endpoint.url,
      ROUTER_TOKEN: endpoint.token
    }
  };
}

/** 本对话启用的 MCP 服务器（runtime-config.json 的 mcpServers 段，滤掉 enabled:false）。
 * 各适配器拉起进程时把它注入各自的启动配置：只对该对话生效，对话之间互不可见。 */
export function conversationMcpServers() {
  return Object.fromEntries(Object.entries(loadConfig().mcpServers || {}).filter(([, e]) => e.enabled !== false));
}

/** boardMcpEntry → ACP session/new 的 mcpServers 条目。
 * ACP stdio 变体要求 type 判别字段且 env 为 [{name,value}] 数组
 * （devin CLI 3000.11+ 用 untagged enum 校验，扁平 env 对象会被拒为 Invalid params）。 */
export function toAcpMcpServer(name, entry) {
  return {
    name,
    type: 'stdio',
    command: entry.command,
    args: entry.args,
    env: Object.entries(entry.env || {}).map(([k, v]) => ({ name: k, value: String(v) }))
  };
}

/**
 * Spawn a process and collect stdout/stderr.
 * Returns { code, stdout, stderr }. timeoutMs<=0 表示不限时，不设强杀定时器（取消任务走 handle 的 killTree）。
 * input 非空时写入 stdin 并关闭（EOF）：prompt 走 stdin 而不是 argv——Windows 命令行上限 32k，
 * 长 spec/旧报告从 argv 传会 spawn ENAMETOOLONG。
 */
export function spawnCollect(cmd, args, { cwd, timeoutMs = 0, onStdoutLine, onChild, env, input } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    if (input != null) {
      child.stdin.on('error', () => {});   // 子进程提前退出时写 stdin 会 EPIPE，交给 close/error 分支处理
      child.stdin.end(input);
    }
    if (onChild) try { onChild(child); } catch {}
    let stdout = '', stderr = '', killed = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs) : null;

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
      stdout += d;
      if (onStdoutLine) {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) onStdoutLine(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`进程超时被终止 (${Math.round(timeoutMs / 1000)}s)`));
      resolve({ code, stdout, stderr });
    });
  });
}

/** Write a per-run temp file (used for claude --mcp-config). */
export function writeTempJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 1));
  return p;
}

// ---------- 工作区配置文件的并发共管（写-还原模式用） ----------
// zcode 的 .zcode/config.json、antigravity 的 .agents/mcp_config.json 都是「任务前写入、
// 任务后还原」的工作区级配置。同目录并行任务时，先结束的任务若照旧还原/删除，会毁掉
// 别人「刚写完、还没拉起进程」的配置。按路径引用计数：第一个使用者备份原件并写入，
// 最后一个使用者负责还原/删除，中间收尾不碰文件；内容没变就跳过写入，减少覆盖窗口。
const configEras = new Map(); // file -> { n, original: Buffer|null, written: string|null }

/** 开始一次使用；返回本时代状态（original 为进场时的文件内容，written 为本时代已写入内容） */
export function beginConfigEra(file) {
  let era = configEras.get(file);
  if (!era) {
    era = { n: 0, original: fs.existsSync(file) ? fs.readFileSync(file) : null, written: null };
    configEras.set(file, era);
  }
  era.n += 1;
  return era;
}

/** 原子写入目标内容（与已写入内容相同则跳过） */
export function writeConfigEra(era, file, content) {
  if (content === era.written) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  era.written = content;
}

/** 结束一次使用；引用归零时把文件还原为原件（没有原件则连文件带目录清理） */
export function endConfigEra(file) {
  const era = configEras.get(file);
  if (!era || --era.n > 0) return;
  configEras.delete(file);
  if (era.original) fs.writeFileSync(file, era.original);
  else { try { fs.unlinkSync(file); } catch {} try { fs.rmdirSync(path.dirname(file)); } catch {} }
}

// ---------- 「写入→拉起→CLI 读取配置」关键窗的跨进程串行化 ----------
// 工作区级配置文件（zcode 的 .zcode/config.json、antigravity 的 .agents/mcp_config.json）
// 由 CLI 进程启动时读取一次。同目录并行的两个任务——尤其是不同对话、各自带对话级 MCP 的——
// 若在别人「刚写完、子进程还没读完」的窗口里覆写文件，对方的子进程就会读到错的服务器清单。
// withConfigLock 提供跨进程互斥（含崩溃残锁回收）；withWorkspaceConfig 在锁内完成
// 备份→写入→拉起→缓冲→还原：锁释放时文件已还原成原件，后开始的使用者（哪怕在另一个
// 进程里）快照到的必然是原件 —— 这是不同对话并行跑 zcode/antigravity 时 MCP 互相隔离的关键。
const CONFIG_READ_GRACE_MS = 8000; // CLI 从 spawn 到读完配置的缓冲。实测 warm 启动 1.5~2.3s
                                   // （node 启动 + 14MB bundle 解析 + 读配置 + 拉起 MCP），8s ≈ 3.5 倍余量
const LOCK_STALE_MS = 30000;       // 正常持锁不超过缓冲期几秒，超过即视为崩溃残留
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 纯互斥（残锁按时间回收）。缓冲等待由 task 自行负责。 */
export async function withConfigLock(file, task) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true }); // 全新工作区还没有 .zcode/ 等目录
  const deadline = Date.now() + 60000;
  for (;;) {
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock); } catch {}
      if (Date.now() > deadline) throw new Error(`配置文件锁获取超时: ${lock}`);
      await sleep(120);
      continue;
    }
    try { await task(); }
    finally { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(lock); } catch {} }
    return;
  }
}

/**
 * 工作区配置文件的完整写入窗（全程在文件锁内）：
 * begin 时代 → writeCfg(era) 合并写入 → startSpawn() 拉起（不等待）→ 等 CLI 读完配置的缓冲 → end 还原。
 * 返回 startSpawn() 的 promise（提前失败不算 unhandledRejection，结果由调用方 await 原样拿到）。
 */
export async function withWorkspaceConfig(file, writeCfg, startSpawn) {
  let promise;
  await withConfigLock(file, async () => {
    const era = beginConfigEra(file);
    try {
      writeCfg(era);
      promise = startSpawn();
      promise?.catch?.(() => {});
    } catch (e) { endConfigEra(file); throw e; }
    await sleep(CONFIG_READ_GRACE_MS);
    endConfigEra(file); // 读完即还原：共享文件暴露给他人的窗口压到最短
  });
  return promise;
}

export { PROJECT_ROOT };
