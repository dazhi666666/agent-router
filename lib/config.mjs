// Router 级配置: 各 agent 的可执行文件路径、代理等。可被环境变量覆盖。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const NPM_GLOBAL = process.platform === 'win32' ? path.join(APPDATA, 'npm', 'node_modules') : '/usr/local/lib/node_modules';
const EXE = process.platform === 'win32' ? '.exe' : '';

/** 版本号目录下最新的那个（如 Claude-3p/claude-code/<ver>/claude.exe） */
function latestVersioned(dir, file) {
  try {
    const vers = fs.readdirSync(dir).filter(v => fs.existsSync(path.join(dir, v, file)));
    vers.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return vers.length ? path.join(dir, vers[0], file) : null;
  } catch { return null; }
}
/** 候选路径里第一个存在的；都不存在则返回第一个（让健康检查报"未找到"并提示路径） */
function firstExisting(...candidates) {
  const list = candidates.filter(Boolean);
  return list.find(p => fs.existsSync(p)) || list[0];
}

// maxConcurrent：该 agent 同时执行的子代理任务数上限
const DEFAULTS = {
  claude: {
    maxConcurrent: 2,
    exe: firstExisting(
      path.join(NPM_GLOBAL, '@anthropic-ai', 'claude-code', 'bin', `claude${EXE}`),
      latestVersioned(path.join(LOCALAPPDATA, 'Claude-3p', 'claude-code'), `claude${EXE}`),
      path.join(HOME, '.local', 'bin', `claude${EXE}`)
    ),
    // 访问 Anthropic API 需要的本地代理（v2rayN 混合端口）；null 则不设代理
    proxy: 'http://127.0.0.1:10808',
    // 主代理与 claude 工人使用的模型；null 则用客户端默认。完整 ID 或别名均可
    model: null,
    // 思考投入档位（--effort low/medium/high…）；null 则用默认
    effort: null
  },
  zcode: {
    maxConcurrent: 1, // 在工作目录里写 MCP 配置文件，同一目录只能同时跑一个
    entry: path.join(NPM_GLOBAL, 'zcode-app-cli', 'bin', 'zcode.js')
  },
  devin: {
    maxConcurrent: 2,
    exe: path.join(LOCALAPPDATA, 'devin', 'cli', 'bin', `devin${EXE}`),
    // Devin 模型（DEVIN_MODEL）；null 则由 Devin 自动选择
    model: null
  },
  codex: {
    maxConcurrent: 2,
    // npm 全局包内的原生二进制（PATH 里的 codex 是 .cmd 垫片，Node spawn 无法直接执行）
    exe: path.join(NPM_GLOBAL, '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
    // 直连时 Codex 的 WebSocket 反复超时才回退 HTTPS（约 90s）；走本地代理后秒连。
    // 与 claude.proxy 同一套 v2rayN 混合端口；null 则不设代理
    proxy: 'http://127.0.0.1:10808',
    model: null
  },
  opencode: {
    maxConcurrent: 2,
    // npm 全局包内的原生二进制（PATH 里的 opencode 是 shell 垫片，Node spawn 无法直接执行）
    exe: path.join(NPM_GLOBAL, 'opencode-ai', 'node_modules', 'opencode-windows-x64', 'bin', 'opencode.exe'),
    // opencode zen 模型（provider/model）。免费档模型要求 CLI ≥1.18（`npm i -g opencode-ai@latest`），
    // 且首 token 排队常见 1-2 分钟；space-bunny-free 响应最快。null 则用客户端默认
    model: 'opencode/space-bunny-free',
    // 标题/摘要等辅助调用使用的模型（top-level small_model）；免费档账户用付费小模型会挂起
    small_model: 'opencode/space-bunny-free'
  },
  antigravity: {
    maxConcurrent: 1, // 在工作目录里写 MCP 配置文件，同一目录只能同时跑一个
    // Antigravity CLI（官方安装器落位 + 自更新）
    exe: path.join(LOCALAPPDATA, 'agy', 'bin', `agy${EXE}`),
    // 生成接口有地区限制（User location is not supported），走与 claude 同一套 v2rayN 代理；null 则不设
    proxy: 'http://127.0.0.1:10808',
    // 模型与思考档位（--model / --effort low|medium|high|max）；null 则由客户端默认
    model: null,
    effort: null
  }
};

export function loadConfig() {
  const cfgFile = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'router.config.json');
  let user = {};
  try { user = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch {}
  const merged = {
    claude: { ...DEFAULTS.claude, ...(user.claude || {}) },
    zcode: { ...DEFAULTS.zcode, ...(user.zcode || {}) },
    devin: { ...DEFAULTS.devin, ...(user.devin || {}) }
    ,codex: { ...DEFAULTS.codex, ...(user.codex || {}) }
    ,opencode: { ...DEFAULTS.opencode, ...(user.opencode || {}) }
    ,antigravity: { ...DEFAULTS.antigravity, ...(user.antigravity || {}) }
    // 只能对话、不能用工具的模型（chat-agent/）：名字 → { label, baseUrl, model, apiKeyEnv, … } 或 { module }
    ,llm: { ...(user.llm || {}) }
    // consult 工具使用的 llm 名字；null 则不提供 consult
    ,consult: user.consult ?? null
  };
  if (process.env.AGENT_ROUTER_CLAUDE_EXE) merged.claude.exe = process.env.AGENT_ROUTER_CLAUDE_EXE;
  if (process.env.AGENT_ROUTER_CLAUDE_MODEL) merged.claude.model = process.env.AGENT_ROUTER_CLAUDE_MODEL;
  if (process.env.AGENT_ROUTER_CLAUDE_EFFORT) merged.claude.effort = process.env.AGENT_ROUTER_CLAUDE_EFFORT;
  if (process.env.AGENT_ROUTER_ZCODE_ENTRY) merged.zcode.entry = process.env.AGENT_ROUTER_ZCODE_ENTRY;
  if (process.env.AGENT_ROUTER_DEVIN_EXE) merged.devin.exe = process.env.AGENT_ROUTER_DEVIN_EXE;
  if (process.env.AGENT_ROUTER_DEVIN_MODEL) merged.devin.model = process.env.AGENT_ROUTER_DEVIN_MODEL;
  if (process.env.AGENT_ROUTER_CODEX_EXE) merged.codex.exe = process.env.AGENT_ROUTER_CODEX_EXE;
  if (process.env.AGENT_ROUTER_CODEX_MODEL) merged.codex.model = process.env.AGENT_ROUTER_CODEX_MODEL;
  if (process.env.AGENT_ROUTER_OPENCODE_EXE) merged.opencode.exe = process.env.AGENT_ROUTER_OPENCODE_EXE;
  if (process.env.AGENT_ROUTER_OPENCODE_MODEL) merged.opencode.model = process.env.AGENT_ROUTER_OPENCODE_MODEL;
  if (process.env.AGENT_ROUTER_ANTIGRAVITY_EXE) merged.antigravity.exe = process.env.AGENT_ROUTER_ANTIGRAVITY_EXE;
  if (process.env.AGENT_ROUTER_ANTIGRAVITY_MODEL) merged.antigravity.model = process.env.AGENT_ROUTER_ANTIGRAVITY_MODEL;
  if (process.env.AGENT_ROUTER_ANTIGRAVITY_EFFORT) merged.antigravity.effort = process.env.AGENT_ROUTER_ANTIGRAVITY_EFFORT;
  if (process.env.AGENT_ROUTER_RUN_CONFIG) {
    const runtime = JSON.parse(fs.readFileSync(process.env.AGENT_ROUTER_RUN_CONFIG, 'utf8'));
    for (const key of ['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity']) Object.assign(merged[key], runtime[key] || {});
    if (runtime.llm) Object.assign(merged.llm, runtime.llm);
    if (runtime.consult !== undefined) merged.consult = runtime.consult;
  }
  return merged;
}
