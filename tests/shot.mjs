// Screenshot helper: drives headless Chrome over CDP.
// usage: node tests/shot.mjs <url> <out.png> [waitMs] [js-to-eval-after-load] [extraWaitMs]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, wait = '6000', js = '', extra = '0', size = '1440,900'] = process.argv.slice(2);
// A private port and profile per run, so several screenshots can be taken at the same time
const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'shot-chrome-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--window-size=${size}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find((p) => p.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    break;
  } catch { await sleep(200); }
}
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 600));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(+wait);
if (js) {
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true });
  if (r.result?.exceptionDetails) logs.push('EVAL EXC: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  else if (r.result?.result?.value !== undefined) logs.push('EVAL: ' + JSON.stringify(r.result.result.value));
  await sleep(+extra);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log(logs.join('\n'));
ws.close();
chrome.kill();
setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
