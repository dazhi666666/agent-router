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

export { PROJECT_ROOT };
