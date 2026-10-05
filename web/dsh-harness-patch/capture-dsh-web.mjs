// Capture a fresh dsh-web snapshot from a locally built deepseek-harness tree.
// Usage: node data/capture-dsh-web.mjs <harnessRoot> <outDir> [port]
//  1. boots `node apps/cli/lib/bin.js --profile web --no-open` with a scratch DSH_HOME
//  2. follows the printed token URL to obtain the auth cookie
//  3. saves the rendered / HTML as <outDir>/index.html
//  4. fetches every plugin URL (manifest entries + HTML preload links) into <outDir>/plugins/pN.js
//     and writes plugins/map.json (document URL → pN.js)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [, , harnessRoot, outDir, portArg] = process.argv;
const PORT = Number(portArg || 3080);
if (!harnessRoot || !outDir) {
  console.error('usage: node capture-dsh-web.mjs <harnessRoot> <outDir> [port]');
  process.exit(1);
}
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));

const child = spawn(process.execPath, ['apps/cli/lib/bin.js', '--profile', 'web', '--no-open'], {
  cwd: harnessRoot,
  env: { ...process.env, DSH_HOME: scratch },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });
child.on('exit', code => { if (!done) fail(`web profile exited early (code=${code}):\n${bootLog.slice(-1500)}`); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let done = false;
function fail(msg) { done = true; try { child.kill('SIGKILL'); } catch {} console.error(msg); process.exit(1); }

// wait for the token URL in the boot log
let tokenUrl = null;
for (let i = 0; i < 120 && !done; i++) {
  const m = bootLog.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/);
  if (m) { tokenUrl = m[0]; break; }
  await sleep(1000);
}
if (!tokenUrl) fail(`token URL not found in boot log:\n${bootLog.slice(-1500)}`);
console.log('token URL acquired');

let cookie = '';
{
  const res = await fetch(tokenUrl, { redirect: 'manual' });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    const res2 = await fetch(new URL(res.headers.get('location'), BASE), { redirect: 'manual', headers: { cookie } });
    for (const c of (res2.headers.getSetCookie ? res2.headers.getSetCookie() : [])) cookie += '; ' + c.split(';')[0];
  }
}
if (!cookie) fail('no auth cookie obtained from token URL');
console.log('auth cookie acquired');

const get = async (url) => {
  const res = await fetch(new URL(url, BASE), { headers: { cookie } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

let indexHtml;
try { indexHtml = (await get('/')).toString('utf8'); } catch (e) { fail(String(e)); }
fs.mkdirSync(path.join(outDir, 'plugins'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);
console.log(`index.html captured (${indexHtml.length} bytes)`);

// collect every plugins/??... URL: manifest entries + HTML references
const urls = new Set();
const boot = indexHtml.match(/__DSH_BOOT__"\]\s*=\s*(\{.*?\})<\/script>/s);
if (boot) {
  const manifest = JSON.parse(boot[1].replace(/&quot;/g, '"'));
  for (const e of manifest.entries || []) if (e.url) urls.add(e.url);
} else {
  console.warn('warning: __DSH_BOOT__ manifest not found in HTML');
}
for (const m of indexHtml.matchAll(/(?:src|href)="(plugins\/[^"]+)"/g)) {
  urls.add(m[1].replace(/&amp;/g, '&'));
}
console.log(`${urls.size} plugin URLs to fetch`);

const map = {};
let n = 0;
for (const url of urls) {
  const buf = await get('/' + url);
  const name = `p${++n}.js`;
  fs.writeFileSync(path.join(outDir, 'plugins', name), buf);
  map[url.replace(/^\/+/, '')] = name;
}
fs.writeFileSync(path.join(outDir, 'plugins', 'map.json'), JSON.stringify(map, null, 1));
console.log(`captured ${n} plugin bundles → plugins/map.json`);

done = true;
try { child.kill('SIGKILL'); } catch {}
fs.rmSync(scratch, { recursive: true, force: true });
console.log('capture complete');
process.exit(0);
