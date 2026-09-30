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
    zcode: { default: conf.defaultModelSelection ? `${conf.defaultModelSelection.providerId}/${conf.defaultModelSelection.modelId}` : '', options: [...choices.keys()], custom: false },
  };
}
export function validateModels(models = {}) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('模型配置无效');
  const out = {};
  for (const [key, value] of Object.entries(models)) {
    if (!['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity'].includes(key) || typeof value !== 'string' || value.length > 250 || /[\r\n\x00]/.test(value)) throw new Error('模型配置无效');
    if (value && key === 'zcode' && !modelCatalog().zcode.options.includes(value)) throw new Error('请选择本机已配置的 ZCode 模型');
    if (value && key === 'opencode') {
      const base = value.split('@')[0];
      const list = modelCatalog().opencode.options;
      if (list.length && !list.includes(base)) throw new Error('请选择 OpenCode 可用模型，或清空使用客户端默认');
    }
    out[key] = value.trim();
  }
  return out;
}
export function runtimeConfig(models) {
  // antigravity 的模型名可带思考档位后缀（如 gemini-3.8-flash-high），拆成 --model + --effort；
  // opencode 支持 `provider/model@variant`（思考强度），拆成 --model + --variant
  const agy = models.antigravity?.match(/^(.*?)(?:-(high|max|medium|low))?$/) || [];
  const at = models.opencode ? models.opencode.lastIndexOf('@') : -1;
  return {
    claude: { ...(models.claude ? { model: models.claude } : {}) },
    devin: { ...(models.devin ? { model: models.devin } : {}) },
    codex: { ...(models.codex ? { model: models.codex } : {}) },
    opencode: models.opencode ? { model: at > 0 ? models.opencode.slice(0, at) : models.opencode, ...(at > 0 ? { variant: models.opencode.slice(at + 1) } : {}) } : {},
    antigravity: models.antigravity ? { model: agy[1] || models.antigravity, ...(agy[2] ? { effort: agy[2] } : {}) } : {},
    zcode: { ...(models.zcode ? { model: models.zcode } : {}) }
  };
}
