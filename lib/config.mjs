// Router 级配置: 各 agent 的可执行文件路径、代理等。可被环境变量覆盖。
import fs from 'node:fs';
import os from 'node:os';
import path, { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Find a command in PATH without invoking a shell. */
export function findExecutableOnPath(command, pathValue = process.env.PATH || '') {
  if (!command) return null;
  const hasPath = command.includes('/') || command.includes('\\');
  const extensions = process.platform === 'win32'
    ? (path.extname(command) ? [''] : (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';'))
    : [''];
  const candidates = hasPath
    ? [command]
    : pathValue.split(delimiter).filter(Boolean).flatMap(dir => extensions.map(ext => path.join(dir, `${command}${ext}`)));
  return candidates.find(candidate => {
    try {
      const stat = fs.statSync(candidate);
      return stat.isFile() && (process.platform === 'win32' || fs.accessSync(candidate, fs.constants.X_OK) === undefined);
    } catch { return false; }
  }) || null;
}

function npmGlobalRoots() {
  const roots = [];
  const prefix = process.env.NPM_CONFIG_PREFIX || process.env.npm_config_prefix;
  if (prefix) roots.push(process.platform === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules'));

  // npm's default global prefix is the parent of Node's bin directory (nvm/asdf/Homebrew).
  const nodeBin = path.dirname(process.execPath);
  const nodePrefix = path.basename(nodeBin).toLowerCase() === 'bin' ? path.dirname(nodeBin) : nodeBin;
  roots.push(process.platform === 'win32' ? path.join(nodePrefix, 'node_modules') : path.join(nodePrefix, 'lib', 'node_modules'));
  roots.push(process.platform === 'win32'
    ? path.join(APPDATA, 'npm', 'node_modules')
    : path.join(HOME, '.npm-global', 'lib', 'node_modules'));
  if (process.platform !== 'win32') roots.push('/usr/local/lib/node_modules', '/opt/homebrew/lib/node_modules');
  return [...new Set(roots)];
}

function npmPackage(...parts) {
  const candidates = npmGlobalRoots().map(root => path.join(root, ...parts));
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function windowsNativePackage(kind) {
  if (process.platform !== 'win32') return null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = npmGlobalRoots().map(root => kind === 'codex'
    ? path.join(root, '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
    : path.join(root, 'opencode-ai', 'node_modules', `opencode-windows-${arch}`, 'bin', 'opencode.exe'));
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function cliPath(command, ...packageCandidates) {
  const installedPackage = packageCandidates.find(candidate => candidate && fs.existsSync(candidate));
  return (process.platform === 'win32' ? installedPackage : findExecutableOnPath(command))
    || installedPackage
    || packageCandidates[0]
    || command;
}

/** 版本号目录下最新的那个（如 Claude-3p/claude-code/<ver>/claude.exe） */
function latestVersioned(dir, file) {
  try {
    const vers = fs.readdirSync(dir).filter(v => fs.existsSync(path.join(dir, v, file)));
    vers.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return vers.length ? path.join(dir, vers[0], file) : null;
  } catch { return null; }
}
// maxConcurrent（可选，router.config.json 里按 agent 配）：该 agent 同时执行的子代理任务数上限；缺省不限。
// 工作区级 MCP 配置（zcode/antigravity）经 spawn-util 的引用计数共管，并行任务收尾互不干扰
const DEFAULTS = {
  claude: {
    exe: cliPath('claude',
      npmPackage('@anthropic-ai', 'claude-code', 'bin', `claude${EXE}`),
      npmPackage('@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      latestVersioned(path.join(LOCALAPPDATA, 'Claude-3p', 'claude-code'), `claude${EXE}`),
      path.join(HOME, '.local', 'bin', `claude${EXE}`)),
    // 访问 Anthropic API 需要的本地代理（v2rayN 混合端口）；null 则不设代理
    proxy: 'http://127.0.0.1:10808',
    // 主代理与 claude 工人使用的模型；null 则用客户端默认。完整 ID 或别名均可
    model: null,
    // 思考投入档位（--effort low/medium/high…）；null 则用默认
    effort: null
  },
  zcode: {
    entry: cliPath('zcode', npmPackage('zcode-app-cli', 'bin', 'zcode.js')),
    // 思考强度（provider 覆盖文件的 defaultModelSelection.options.reasoningLevel，档位随模型而定）；null 则用客户端默认
    effort: null
  },
  // 开源 ZCode CLI：E:\ZCode 源码自建产物（apps/zcode-cli/packages/cli/dist/zcode.cjs）。
  // 与 npm 版共用 ~/.zcode 登录态、provider_config 与 ~/.zcode/cli 配置层，stream-json 事件同构
  'zcode-oss': {
    entry: 'E:/ZCode/apps/zcode-cli/packages/cli/dist/zcode.cjs',
    // 同 zcode：思考强度经 provider 覆盖文件下发
    effort: null
  },
  devin: {
    exe: cliPath('devin', path.join(LOCALAPPDATA, 'devin', 'cli', 'bin', `devin${EXE}`)),
    // Devin 模型（DEVIN_MODEL）；null 则由 Devin 自动选择
    model: null
  },
  codex: {
    // POSIX PATH entries are directly executable; on Windows prefer the packaged native binary.
    exe: cliPath('codex', windowsNativePackage('codex') || npmPackage('@openai', 'codex', 'bin', 'codex.js')),
    // 直连时 Codex 的 WebSocket 反复超时才回退 HTTPS（约 90s）；走本地代理后秒连。
    // 与 claude.proxy 同一套 v2rayN 混合端口；null 则不设代理
    proxy: 'http://127.0.0.1:10808',
    model: null
  },
  opencode: {
    // PATH scripts work on POSIX; native binaries are selected by the installed package wrapper there.
    exe: cliPath('opencode', windowsNativePackage('opencode') || npmPackage('opencode-ai', 'bin', 'opencode')),
    // opencode zen 模型（provider/model）。免费档模型要求 CLI ≥1.18（`npm i -g opencode-ai@latest`），
    // 且首 token 排队常见 1-2 分钟；space-bunny-free 响应最快。null 则用客户端默认
    model: 'opencode/space-bunny-free',
    // 标题/摘要等辅助调用使用的模型（top-level small_model）；免费档账户用付费小模型会挂起
    small_model: 'opencode/space-bunny-free'
  },
  antigravity: {
    // Antigravity CLI（官方安装器落位 + 自更新）
    exe: cliPath('agy', path.join(LOCALAPPDATA, 'agy', 'bin', `agy${EXE}`)),
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
    zcode: { ...DEFAULTS.zcode, ...(user.zcode || {}) }
    ,'zcode-oss': { ...DEFAULTS['zcode-oss'], ...(user['zcode-oss'] || {}) }
    ,devin: { ...DEFAULTS.devin, ...(user.devin || {}) }
    ,codex: { ...DEFAULTS.codex, ...(user.codex || {}) }
    ,opencode: { ...DEFAULTS.opencode, ...(user.opencode || {}) }
    ,antigravity: { ...DEFAULTS.antigravity, ...(user.antigravity || {}) }
    // 只能对话、不能用工具的模型（chat-agent/）：名字 → { label, baseUrl, model, apiKeyEnv, … } 或 { module }
    ,llm: { ...(user.llm || {}) }
    // consult 工具使用的 llm 名字；null 则不提供 consult
    ,consult: user.consult ?? null
    // 主代理单独选的模型（来自运行时 runtime-config.json 的 main 段）：仅主代理启动器读取，子代理不受影响
    ,main: {}
    // 本对话的 MCP 服务器（runtime-config.json 的 mcpServers 段，validateMcpServers 规范形状）：
    // 各 CLI 适配器拉起进程时注入自己的启动配置，只对该对话生效，对话之间互不可见
    ,mcpServers: {}
  };
  if (process.env.AGENT_ROUTER_CLAUDE_EXE) merged.claude.exe = process.env.AGENT_ROUTER_CLAUDE_EXE;
  if (process.env.AGENT_ROUTER_CLAUDE_MODEL) merged.claude.model = process.env.AGENT_ROUTER_CLAUDE_MODEL;
  if (process.env.AGENT_ROUTER_CLAUDE_EFFORT) merged.claude.effort = process.env.AGENT_ROUTER_CLAUDE_EFFORT;
  if (process.env.AGENT_ROUTER_ZCODE_ENTRY) merged.zcode.entry = process.env.AGENT_ROUTER_ZCODE_ENTRY;
  if (process.env.AGENT_ROUTER_ZCODE_OSS_ENTRY) merged['zcode-oss'].entry = process.env.AGENT_ROUTER_ZCODE_OSS_ENTRY;
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
    for (const key of ['claude', 'zcode', 'zcode-oss', 'devin', 'codex', 'opencode', 'antigravity']) Object.assign(merged[key], runtime[key] || {});
    if (runtime.main) merged.main = Object.fromEntries(Object.entries(runtime.main).filter(([k]) => ['model', 'variant', 'effort'].includes(k) && runtime.main[k]));
    if (runtime.mcpServers) merged.mcpServers = runtime.mcpServers;
    if (runtime.llm) Object.assign(merged.llm, runtime.llm);
    if (runtime.consult !== undefined) merged.consult = runtime.consult;
  }
  return merged;
}
