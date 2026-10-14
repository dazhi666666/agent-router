import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../lib/config.mjs';
import { readJson } from './sessions.mjs';

export const providerFile = () => process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE || path.join(process.env.USERPROFILE || process.env.HOME || '', '.zcode', 'v2', 'provider_config.json');

// ---------- 可选模型清单（CLI/models.dev 实时拉取 + 内存缓存；失败时沿用上次结果） ----------
const TTL = 10 * 60 * 1000;
const cache = new Map(); // key -> { at, value }
function cached(key, fn, ttl = TTL) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  let value;
  try { value = fn(); } catch { value = undefined; }
  if (value === undefined) return hit?.value ?? { options: [], labels: {}, efforts: {} };
  cache.set(key, { at: Date.now(), value });
  return value;
}

function sh(exe, args, timeoutMs = 30000) {
  if (!exe || (path.isAbsolute(exe) && !fs.existsSync(exe))) return '';
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  return r.status === 0 ? String(r.stdout || '') : '';
}

/** opencode zen 模型（CLI 列表） */
function opencodeList() {
  const out = sh(loadConfig().opencode.exe, ['models', 'opencode'], 30000);
  const options = out.split('\n').map(l => l.trim()).filter(l => /^opencode\/[\w.:-]+$/.test(l));
  return { options, labels: {}, efforts: {} };
}

/** opencode 各模型的显示名与思考强度档（models.dev 元数据；reasoning_options 即 CLI --variant 的合法值） */
function zenMeta() {
  const r = spawnSync('curl', ['-s', '--compressed', '--max-time', '30', 'https://models.dev/api.json'], { encoding: 'utf8', timeout: 45000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return undefined;
  const models = JSON.parse(r.stdout)?.opencode?.models || {};
  const labels = {}, efforts = {};
  for (const [id, m] of Object.entries(models)) {
    if (m.name) labels[`opencode/${id}`] = m.name;
    const ro = m.reasoning_options;
    if (!Array.isArray(ro) || !ro.length) continue;
    const effort = ro.find(o => o.type === 'effort');
    if (effort) efforts[`opencode/${id}`] = effort.values.map(v => (v == null ? 'none' : v));
    else if (ro.some(o => o.type === 'budget_tokens')) efforts[`opencode/${id}`] = ['high', 'max'];
    // 仅 toggle 的模型在 openai-compatible 下不合成 variant
  }
  return { options: [], labels, efforts };
}

/** antigravity 模型（agy models：`id\t显示名`，强度档已并入 id 后缀） */
function antigravityList() {
  const out = sh(loadConfig().antigravity.exe, ['models'], 45000);
  const options = [], labels = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([\w.:-]+)\t(.+)$/);
    if (!m) continue;
    options.push(m[1]);
    labels[m[1]] = m[2].trim();
  }
  return { options, labels, efforts: {} };
}

/** devin 模型（devin models list：恰好两空格缩进的 `id  显示名  [元数据]` 行，深层缩进是子模型不收） */
function devinList() {
  const out = sh(loadConfig().devin.exe, ['models', 'list'], 30000);
  const options = [], labels = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^ {2}([\w][\w.:-]*) {2,}(.+?)\s*(?:\[.*\])?\s*$/);
    if (!m) continue;
    options.push(m[1]);
    labels[m[1]] = m[2].trim();
  }
  return { options, labels, efforts: {} };
}

/** ZCode 每个模型的思考强度档（runtime 注册表 zcode-builtin.json 的 modelRules；
 * 规则按序覆盖，命中越靠后越具体。GLM-5.3(-Flash) 是 low/high/max，其余多为 disabled/enabled） */
function zcodeRegistry() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const root = path.join(home, '.zcode', 'v2', 'runtime', 'provider', process.platform === 'win32' ? 'windows-x86_64' : `${process.platform}-${process.arch}`);
  let file = null;
  try {
    outer: for (const ver of fs.readdirSync(root).filter(v => /^\d/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      for (const ep of fs.readdirSync(path.join(root, ver))) {
        const p = path.join(root, ver, ep, 'zcode-builtin.json');
        if (fs.existsSync(p)) { file = p; break outer; }
      }
    }
  } catch {}
  if (!file) {
    const vend = path.join(path.dirname(loadConfig().zcode.entry || ''), '..', 'vendor', 'provider', 'zcode-builtin.json');
    if (fs.existsSync(vend)) file = vend;
  }
  if (!file) return null;
  try {
    const rules = JSON.parse(fs.readFileSync(file, 'utf8'))?.config?.modelConfigRules?.modelRules || [];
    return rules.filter(r => r.config?.optionSpecs?.reasoningLevel?.values?.length)
      .map(r => ({ re: new RegExp(r.modelMatch, 'i'), values: r.config.optionSpecs.reasoningLevel.values }));
  } catch { return null; }
}
const modelIdOf = sel => { const s = String(sel || ''); const at = s.indexOf('/'); return at > 0 ? s.slice(at + 1) : s; };
/** 模型选择（provider/model）→ 可用思考档位数组（未知/都缺失时 null，调用方跳过校验）。
 * 桌面端「编辑模型配置」里配的档位存 provider_config.json（provider+model 精确匹配，其次仅 model 匹配），
 * 优先于内置注册表的 modelMatch 规则（后者按序覆盖，命中越靠后越具体） */
function zcodeLevels(modelSel) {
  if (!modelSel) return null;
  const sel = String(modelSel), at = sel.indexOf('/');
  const providerId = at > 0 ? sel.slice(0, at) : '', modelId = at > 0 ? sel.slice(at + 1) : sel;
  const personal = readJson(providerFile(), {})?.config?.modelConfigRules?.providerModelRules || [];
  for (const r of personal) if (r.providerId === providerId && r.modelId === modelId && r.config?.optionSpecs?.reasoningLevel?.values?.length) return r.config.optionSpecs.reasoningLevel.values;
  for (const r of personal) if (r.modelId === modelId && r.config?.optionSpecs?.reasoningLevel?.values?.length) return r.config.optionSpecs.reasoningLevel.values;
  const rules = cached('zcode-registry', zcodeRegistry, 30 * 60 * 1000);
  if (!rules) return null;
  let values = null;
  for (const r of rules) if (r.re.test(modelId)) values = r.values;
  return values;
}

export function modelCatalog() {
  const cfg = loadConfig();
  const root = readJson(providerFile(), {});
  const conf = root.config || {};
  const choices = new Map();
  const add = (providerId, modelId) => { if (providerId && modelId) choices.set(`${providerId}/${modelId}`, { providerId, modelId }); };
  add(conf.defaultModelSelection?.providerId, conf.defaultModelSelection?.modelId);
  for (const p of conf.providerConfigRules?.providerRules || []) {
    if (p.enabled === false) continue;
    for (const id of p.config?.personalModelIds || []) add(p.providerId, id);
  }
  for (const m of conf.modelConfigRules?.providerModelRules || []) if (m.config?.enabled !== false) add(m.providerId, m.modelId);
  const zen = cached('opencode-models', opencodeList);
  const zenExtra = cached('models-dev-zen', zenMeta, 30 * 60 * 1000);
  const agy = cached('antigravity-models', antigravityList);
  const devin = cached('devin-models', devinList);
  return {
    claude: { default: cfg.claude.model || '', custom: true },
    devin: { default: cfg.devin.model || '', options: devin.options, labels: devin.labels },
    codex: { default: cfg.codex.model || '', custom: true },
    opencode: {
      default: cfg.opencode.model || '',
      options: zen.options,
      labels: { ...(zen.labels || {}), ...(zenExtra.labels || {}) },
      efforts: zenExtra.efforts || {},
    },
    antigravity: { default: cfg.antigravity.model || '', options: agy.options, labels: agy.labels },
    // 每个模型（含默认）各自的思考档位：UI 据此渲染 ZCode 的思考强度下拉并校验取值
    zcode: { default: conf.defaultModelSelection ? `${conf.defaultModelSelection.providerId}/${conf.defaultModelSelection.modelId}` : '', options: [...choices.keys()], custom: false, efforts: Object.fromEntries([...choices.keys()].map(o => [o, zcodeLevels(o)]).filter(([, v]) => v)) },
    // 开源版与 npm 版共用 ~/.zcode/v2/provider_config.json：模型清单与默认值完全一致
    'zcode-oss': { default: conf.defaultModelSelection ? `${conf.defaultModelSelection.providerId}/${conf.defaultModelSelection.modelId}` : '', options: [...choices.keys()], custom: false, efforts: Object.fromEntries([...choices.keys()].map(o => [o, zcodeLevels(o)]).filter(([, v]) => v)) },
  };
}
const TYPES = ['claude', 'zcode', 'zcode-oss', 'devin', 'codex', 'opencode', 'antigravity'];

function checkModel(kind, value) {
  if ((kind === 'zcode' || kind === 'zcode-oss') && !modelCatalog()[kind].options.includes(value)) throw new Error('请选择本机已配置的 ZCode 模型');
  if (kind === 'opencode') {
    const base = value.split('@')[0];
    const list = modelCatalog().opencode.options;
    if (list.length && !list.includes(base)) throw new Error('请选择 OpenCode 可用模型，或清空使用客户端默认');
  }
}

/** models 按类型 keyed；保留键 `main` 是主代理自己的模型（mainKind 给出主代理类型） */
export function validateModels(models = {}, mainKind = null) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('模型配置无效');
  const out = {};
  for (const [key, value] of Object.entries(models)) {
    if (!(TYPES.includes(key) || key === 'main') || typeof value !== 'string' || value.length > 250 || /[\r\n\x00]/.test(value)) throw new Error('模型配置无效');
    const kind = key === 'main' ? mainKind : key;
    if (value && kind && !TYPES.includes(kind)) throw new Error('该主代理类型不支持单独选择模型');
    if (value && TYPES.includes(kind)) checkModel(kind, value.trim());
    out[key] = value.trim();
  }
  return out;
}

/** efforts 按类型 keyed（`main` = 主代理自己的思考强度）。目前只有 ZCode 系支持：
 * 取值必须在该类型所选模型（无则默认模型）的注册表档位里，防止拉起时被 CLI 拒绝 */
export function validateEfforts(efforts = {}, models = {}, mainKind = null) {
  if (efforts === undefined || efforts === null) return {};
  if (typeof efforts !== 'object' || Array.isArray(efforts)) throw new Error('思考强度配置无效');
  const out = {};
  for (const [key, value] of Object.entries(efforts)) {
    if (!(TYPES.includes(key) || key === 'main')) throw new Error('思考强度配置无效');
    const v = typeof value === 'string' ? value.trim() : value;
    if (v === undefined || v === null || v === '') { out[key] = ''; continue; }
    if (typeof v !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(v)) throw new Error('思考强度配置无效');
    const kind = key === 'main' ? mainKind : key;
    if (!['zcode', 'zcode-oss'].includes(kind)) throw new Error(`${kind || '未知类型'} 暂不支持单独选择思考强度`);
    const modelSel = models[key === 'main' ? 'main' : key] || modelCatalog()[kind].default;
    const values = zcodeLevels(modelSel);
    if (values && !values.includes(v)) throw new Error(`${modelIdOf(modelSel) || 'ZCode'} 不支持思考强度 ${v}（可用：${values.join('/')}）`);
    out[key] = v;
  }
  return out;
}
const MCP_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const strMap = v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k !== 'string' || k.length > 128 || typeof val !== 'string' || val.length > 4096 || /[\r\n\x00]/.test(val)) return null;
    out[k] = val;
  }
  return out;
};

/** 对话级 MCP 服务器（settings.mcpServers）：name -> 条目，规范化为 stdio/http/sse 三种形状。
 * 各 CLI 适配器从这里取本对话的服务器注入自己的启动配置；对话之间互不可见。 */
export function validateMcpServers(input) {
  if (input === undefined || input === null) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('MCP 配置无效：需要 { 名字: 服务器 } 对象');
  const entries = Object.entries(input);
  if (entries.length > 32) throw new Error('MCP 配置无效：最多 32 个服务器');
  const out = {};
  for (const [name, raw] of entries) {
    if (!MCP_NAME.test(name)) throw new Error(`MCP 配置无效：名字 ${JSON.stringify(name).slice(0, 40)} 只能用字母数字、- 和 _`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`MCP 服务器 ${name} 配置无效：需要对象`);
    const type = raw.type === undefined ? undefined : raw.type;
    if (type !== undefined && !['stdio', 'http', 'sse'].includes(type)) throw new Error(`MCP 服务器 ${name} 的 type 只支持 stdio/http/sse`);
    const unknown = Object.keys(raw).filter(k => !['type', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'enabled'].includes(k));
    if (unknown.length) throw new Error(`MCP 服务器 ${name} 有未知字段：${unknown.join('、').slice(0, 80)}`);
    if (type === 'stdio' || (type === undefined && typeof raw.command === 'string')) {
      if (typeof raw.command !== 'string' || !raw.command.trim() || raw.command.length > 2048) throw new Error(`MCP 服务器 ${name} 缺少有效的 command`);
      if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.length > 64 || raw.args.some(a => typeof a !== 'string' || a.length > 4096))) throw new Error(`MCP 服务器 ${name} 的 args 必须是字符串数组`);
      const env = strMap(raw.env);
      if (raw.env !== undefined && !env) throw new Error(`MCP 服务器 ${name} 的 env 必须是字符串到字符串的映射`);
      if (raw.cwd !== undefined && (typeof raw.cwd !== 'string' || raw.cwd.length > 1024)) throw new Error(`MCP 服务器 ${name} 的 cwd 无效`);
      out[name] = { type: 'stdio', command: raw.command, ...(raw.args?.length ? { args: raw.args } : {}), ...(env ? { env } : {}), ...(raw.cwd ? { cwd: raw.cwd } : {}) };
    } else if (type === 'http' || type === 'sse' || (type === undefined && typeof raw.url === 'string')) {
      if (typeof raw.url !== 'string' || !/^https?:\/\//.test(raw.url) || raw.url.length > 2048) throw new Error(`MCP 服务器 ${name} 缺少有效的 http(s) url`);
      const headers = strMap(raw.headers);
      if (raw.headers !== undefined && !headers) throw new Error(`MCP 服务器 ${name} 的 headers 必须是字符串到字符串的映射`);
      out[name] = { type: type === 'sse' ? 'sse' : 'http', url: raw.url, ...(headers ? { headers } : {}) };
    } else throw new Error(`MCP 服务器 ${name} 需要 command（本地进程）或 url（远程服务）`);
    if (raw.enabled === false) out[name].enabled = false;
  }
  return out;
}

/** 类型段 = 该类型子代理的模型与思考强度；`main` 段仅主代理启动器读取；`mcpServers` 是本对话的 MCP 服务器 */
export function runtimeConfig(models = {}, efforts = {}, mainKind = null, mcpServers = {}) {
  // antigravity 的模型名可带思考档位后缀（如 gemini-3.8-flash-high），拆成 --model + --effort；
  // opencode 支持 `provider/model@variant`（思考强度），拆成 --model + --variant；
  // zcode 的思考强度是独立字段（provider defaultModelSelection.options.reasoningLevel），不并入模型名
  const parse = (kind, value) => {
    if (kind === 'opencode') {
      const at = value.lastIndexOf('@');
      return { model: at > 0 ? value.slice(0, at) : value, ...(at > 0 ? { variant: value.slice(at + 1) } : {}) };
    }
    if (kind === 'antigravity') {
      const agy = value.match(/^(.*?)(?:-(high|max|medium|low))?$/) || [];
      return { model: agy[1] || value, ...(agy[2] ? { effort: agy[2] } : {}) };
    }
    return { model: value };
  };
  const pick = (kind, key) => ({ ...(models[key] ? parse(kind, models[key]) : {}), ...(efforts[key] ? { effort: efforts[key] } : {}) });
  const servers = validateMcpServers(mcpServers);
  const mainZcode = ['zcode', 'zcode-oss'].includes(mainKind);
  const main = models.main || (efforts.main && mainZcode) ? {
    ...(models.main ? parse(mainKind, models.main) : {}),
    ...(efforts.main && mainZcode ? { effort: efforts.main } : {})
  } : null;
  return {
    claude: models.claude ? parse('claude', models.claude) : {},
    devin: models.devin ? parse('devin', models.devin) : {},
    codex: models.codex ? parse('codex', models.codex) : {},
    opencode: models.opencode ? parse('opencode', models.opencode) : {},
    antigravity: models.antigravity ? parse('antigravity', models.antigravity) : {},
    zcode: pick('zcode', 'zcode'),
    'zcode-oss': pick('zcode-oss', 'zcode-oss'),
    ...(main ? { main } : {}),
    ...(Object.keys(servers).length ? { mcpServers: servers } : {})
  };
}
