import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findExecutableOnPath } from './config.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-router-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'node', 'bin');
  const npmRoot = path.join(root, 'node', 'lib', 'node_modules');
  const module = path.join(root, 'lib', 'config.mjs');
  fs.mkdirSync(path.dirname(module), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL('./config.mjs', import.meta.url)), module);
  const write = (file, text = '', mode = 0o755) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { mode });
    return file;
  };
  const load = ({ platform = 'darwin', arch = 'arm64', env = {} } = {}) => {
    const script = `
      Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
      Object.defineProperty(process, 'arch', { value: ${JSON.stringify(arch)} });
      Object.defineProperty(process, 'execPath', { value: ${JSON.stringify(path.join(bin, 'node'))} });
      const { loadConfig } = await import(${JSON.stringify(pathToFileURL(module).href)});
      console.log(JSON.stringify(loadConfig()));
    `;
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^AGENT_ROUTER_|^npm_config_prefix$|^NPM_CONFIG_PREFIX$/i.test(key)));
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...childEnv, HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'), PATH: bin, ...env }
    }));
  };
  return { root, bin, npmRoot, write, load };
}

test('PATH lookup skips directories, broken links and non-executable POSIX files', t => {
  const f = fixture(t), other = path.join(f.root, 'other');
  fs.mkdirSync(other);
  const command = process.platform === 'win32' ? 'agent.exe' : 'agent';
  fs.mkdirSync(path.join(f.bin, command));
  const agent = f.write(path.join(other, command));
  assert.equal(findExecutableOnPath('agent', `${f.bin}${path.delimiter}${other}`), agent);
  assert.equal(findExecutableOnPath('missing-agent', f.bin), null);
  assert.equal(findExecutableOnPath(agent), agent);
  if (process.platform !== 'win32') {
    const noExec = f.write(path.join(f.bin, 'no-exec'), '', 0o644);
    fs.symlinkSync(path.join(f.root, 'missing'), path.join(f.bin, 'broken'));
    assert.equal(findExecutableOnPath(noExec), null);
    assert.equal(findExecutableOnPath('broken', f.bin), null);
  }
});

for (const platform of ['darwin', 'linux']) {
  test(`${platform} defaults discover CLI commands from PATH`, t => {
    const f = fixture(t);
    for (const command of ['claude', 'codex', 'opencode', 'devin', 'agy']) f.write(path.join(f.bin, command));
    const config = f.load({ platform });
    for (const [agent, command] of Object.entries({ claude: 'claude', codex: 'codex', opencode: 'opencode', devin: 'devin', antigravity: 'agy' })) {
      assert.equal(config[agent].exe, path.join(f.bin, command));
    }
  });
}

test('defaults find packages beside an nvm-style Node installation without PATH wrappers', t => {
  const f = fixture(t);
  const claude = f.write(path.join(f.npmRoot, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  const codex = f.write(path.join(f.npmRoot, '@openai', 'codex', 'bin', 'codex.js'));
  const opencode = f.write(path.join(f.npmRoot, 'opencode-ai', 'bin', 'opencode'));
  const zcode = f.write(path.join(f.npmRoot, 'zcode-app-cli', 'bin', 'zcode.js'), '', 0o644);
  const config = f.load();
  assert.equal(config.claude.exe, claude);
  assert.equal(config.codex.exe, codex);
  assert.equal(config.opencode.exe, opencode);
  assert.equal(config.zcode.entry, zcode);
});

test('ZCode uses a JavaScript entry instead of a PATH shell wrapper', t => {
  const f = fixture(t);
  f.write(path.join(f.bin, 'zcode'), '#!/bin/sh\nexit 0\n');
  const entry = f.write(path.join(f.npmRoot, 'zcode-app-cli', 'bin', 'zcode.js'), '', 0o644);
  assert.equal(f.load().zcode.entry, entry);
});

test('ZCode resolves a PATH symlink to its JavaScript entry', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const entry = f.write(path.join(f.root, 'custom', 'zcode.js'));
  fs.symlinkSync(entry, path.join(f.bin, 'zcode'));
  assert.equal(f.load().zcode.entry, fs.realpathSync(entry));
});

for (const arch of ['x64', 'arm64']) {
  test(`Windows ${arch} defaults use native npm binaries instead of .cmd shims`, t => {
    const f = fixture(t), npmRoot = path.join(f.root, 'node', 'node_modules');
    const target = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const codex = f.write(path.join(npmRoot, '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', target, 'bin', 'codex.exe'));
    const opencode = f.write(path.join(npmRoot, 'opencode-ai', 'node_modules', `opencode-windows-${arch}`, 'bin', 'opencode.exe'));
    f.write(path.join(f.bin, 'codex.cmd'));
    f.write(path.join(f.bin, 'opencode.cmd'));
    const config = f.load({ platform: 'win32', arch });
    assert.equal(config.codex.exe, codex);
    assert.equal(config.opencode.exe, opencode);
    const standalone = f.write(path.join(f.bin, 'codex.exe'));
    assert.equal(f.load({ platform: 'win32', arch }).codex.exe, standalone);
  });
}

test("Windows reports npm's default global prefix for a missing package", t => {
  const f = fixture(t);
  assert.equal(
    f.load({ platform: 'win32', arch: 'x64' }).zcode.entry,
    path.join(f.root, 'roaming', 'npm', 'node_modules', 'zcode-app-cli', 'bin', 'zcode.js')
  );
});

test('Windows falls back to the npm JavaScript entry when no native Codex binary exists', t => {
  const f = fixture(t);
  const codex = f.write(path.join(f.root, 'roaming', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  assert.equal(f.load({ platform: 'win32', arch: 'x64' }).codex.exe, codex);
});

test('npm prefix, user config, environment and runtime overrides retain precedence', t => {
  const f = fixture(t), prefix = path.join(f.root, 'custom-npm');
  const claude = f.write(path.join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude'));
  assert.equal(f.load({ env: { NPM_CONFIG_PREFIX: prefix } }).claude.exe, claude);
  f.write(path.join(f.root, 'router.config.json'), JSON.stringify({ claude: { exe: '/custom/claude' } }));
  assert.equal(f.load().claude.exe, '/custom/claude');
  assert.equal(f.load({ env: { AGENT_ROUTER_CLAUDE_EXE: '/env/claude' } }).claude.exe, '/env/claude');
  const runtime = f.write(path.join(f.root, 'runtime.json'), JSON.stringify({ claude: { exe: '/run/claude' } }));
  assert.equal(f.load({ env: { AGENT_ROUTER_CLAUDE_EXE: '/env/claude', AGENT_ROUTER_RUN_CONFIG: runtime } }).claude.exe, '/run/claude');
});
