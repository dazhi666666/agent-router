// Router 级配置: 各 agent 的可执行文件路径、代理等。可被环境变量覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULTS = {
  claude: {
    exe: 'C:\\Users\\user\\AppData\\Local\\Claude-3p\\claude-code\\2.1.281\\claude.exe',
    // 访问 Anthropic API 需要的本地代理（v2rayN 混合端口）；null 则不设代理
    proxy: 'http://127.0.0.1:10808',
    // 主代理与 claude 工人使用的模型；null 则用客户端默认。完整 ID 或别名均可
    model: null,
    // 思考投入档位（--effort low/medium/high…）；null 则用默认
    effort: null
  },
  zcode: {
    entry: 'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\zcode-app-cli\\bin\\zcode.js'
  },
  devin: {
    exe: 'C:\\Users\\user\\AppData\\Local\\devin\\cli\\bin\\devin.exe',
    // Devin 模型（DEVIN_MODEL）；null 则由 Devin 自动选择
    model: null
  },
  codex: {
    // npm 全局包内的原生二进制（PATH 里的 codex 是 .cmd 垫片，Node spawn 无法直接执行）
    exe: 'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe',
    // 直连时 Codex 的 WebSocket 反复超时才回退 HTTPS（约 90s）；走本地代理后秒连。
    // 与 claude.proxy 同一套 v2rayN 混合端口；null 则不设代理
    proxy: 'http://127.0.0.1:10808',
    model: null
  },
  opencode: {
    // npm 全局包内的原生二进制（PATH 里的 opencode 是 shell 垫片，Node spawn 无法直接执行）
    exe: 'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\node_modules\\opencode-windows-x64\\bin\\opencode.exe',
    // opencode zen 模型（provider/model）。免费档模型要求 CLI ≥1.18（`npm i -g opencode-ai@latest`），
    // 且首 token 排队常见 1-2 分钟；space-bunny-free 响应最快。null 则用客户端默认
    model: 'opencode/space-bunny-free',
    // 标题/摘要等辅助调用使用的模型（top-level small_model）；免费档账户用付费小模型会挂起
    small_model: 'opencode/space-bunny-free'
  },
  antigravity: {
    // Antigravity CLI（官方安装器落位 + 自更新）
    exe: 'C:\\Users\\user\\AppData\\Local\\agy\\bin\\agy.exe',
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
  }
  return merged;
}
