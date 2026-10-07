// Shared plumbing for spawning agent CLI processes with the board MCP server attached.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
 * Returns { code, stdout, stderr }. Kills the child after timeoutMs.
 */
export function spawnCollect(cmd, args, { cwd, timeoutMs = 600000, onStdoutLine, onChild, env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    if (onChild) try { onChild(child); } catch {}
    let stdout = '', stderr = '', killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

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

export { PROJECT_ROOT };
