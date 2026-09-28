import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { readJson } from './sessions.mjs';

export const providerFile = () => process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE || path.join(process.env.USERPROFILE || process.env.HOME || '', '.zcode', 'v2', 'provider_config.json');
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
  return {
    claude: { default: cfg.claude.model || '', custom: true },
    devin: { default: cfg.devin.model || '', custom: true },
    codex: { default: cfg.codex.model || '', custom: true },
    opencode: { default: cfg.opencode.model || '', custom: true },
    antigravity: { default: cfg.antigravity.model || '', custom: true },
    zcode: { default: conf.defaultModelSelection ? `${conf.defaultModelSelection.providerId}/${conf.defaultModelSelection.modelId}` : '', options: [...choices.keys()], custom: false },
  };
}
export function validateModels(models = {}) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('模型配置无效');
  const out = {};
  for (const [key, value] of Object.entries(models)) {
    if (!['claude', 'zcode', 'devin', 'codex', 'opencode', 'antigravity'].includes(key) || typeof value !== 'string' || value.length > 250 || /[\r\n\x00]/.test(value)) throw new Error('模型配置无效');
    if (value && key === 'zcode' && !modelCatalog().zcode.options.includes(value)) throw new Error('请选择本机已配置的 ZCode 模型');
    out[key] = value.trim();
  }
  return out;
}
export function runtimeConfig(models) {
  // antigravity 的模型名可带思考档位后缀（如 gemini-3.1-pro-high），拆成 --model + --effort
  const agy = models.antigravity?.match(/^(.*?)(?:-(high|max|medium|low))?$/) || [];
  return {
    claude: { ...(models.claude ? { model: models.claude } : {}) },
    devin: { ...(models.devin ? { model: models.devin } : {}) },
    codex: { ...(models.codex ? { model: models.codex } : {}) },
    opencode: { ...(models.opencode ? { model: models.opencode } : {}) },
    antigravity: models.antigravity ? { model: agy[1] || models.antigravity, ...(agy[2] ? { effort: agy[2] } : {}) } : {},
    zcode: { ...(models.zcode ? { model: models.zcode } : {}) }
  };
}
