// One command for the whole live demo:
//
//   npm run live            start the validation gateway + node agent (poc/quickstart.mjs), the admin portal and the
//                           customer portal, then open both portals already pointed at the gateway
//   npm run live -- --no-open    same, without opening the browser
//
// Ctrl+C stops everything and frees the GPU memory.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPEN = !process.argv.includes('--no-open');
const ADMIN_PORT = 5174;
const CUSTOMER_PORT = 5173;
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(vite)) {
  console.error('找不到 node_modules。請先執行：npm install');
  process.exit(1);
}

const children = [];
let stopping = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startPortal(mode, port) {
  const child = spawn(process.execPath, [vite, '--mode', mode, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`\n${mode} 入口的開發伺服器意外結束（代碼 ${code}）。連接埠 ${port} 可能已被占用。\n${log.slice(-600)}`);
      void stop(1);
    }
  });
  children.push(child);
}
async function waitPort(port, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) })).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}
function openInBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the links are printed anyway */
  }
}

let quickstart = null;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  // quickstart receives the same Ctrl+C from the console and cleans up by itself (stops gateway and agent, frees VRAM).
  if (quickstart && quickstart.exitCode === null) {
    const done = new Promise((r) => quickstart.once('exit', r));
    const timer = setTimeout(() => quickstart.kill(), 20_000);
    await done;
    clearTimeout(timer);
  }
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

console.log('啟動中：驗證環境（閘道與節點代理）、管理後台、客戶入口…\n');
startPortal('admin', ADMIN_PORT);
startPortal('customer', CUSTOMER_PORT);

quickstart = spawn(process.execPath, [path.join(ROOT, 'poc', 'quickstart.mjs')], { cwd: path.join(ROOT, 'poc'), stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
let announced = false;
quickstart.stdout.on('data', async (d) => {
  const text = d.toString();
  out += text;
  // Show the checks as they run; the browser hints at the end are replaced by the block below.
  if (!announced) process.stdout.write(text.split('━━ 換你用瀏覽器走一次 ━━')[0]);
  const key = out.match(/topology#(\S+)/)?.[1];
  const code = out.match(/啟用碼：\s+(act_\S+)/)?.[1];
  if (!key || !code || announced) return;
  announced = true;
  const [a, c] = await Promise.all([waitPort(ADMIN_PORT), waitPort(CUSTOMER_PORT)]);
  if (!a || !c) {
    console.error('入口的開發伺服器沒有在時間內就緒。');
    return void stop(1);
  }
  const adminUrl = `http://localhost:${ADMIN_PORT}/#/local-gpu?tab=topology&key=${key}`;
  const customerUrl = `http://localhost:${CUSTOMER_PORT}/#/live-gpu?code=${code}`;
  console.log('\n━━ 全部就緒 ━━');
  console.log(`  管理後台（已帶入管理金鑰）：${adminUrl}`);
  console.log(`  客戶入口（已帶入啟用碼）：  ${customerUrl}`);
  console.log('\n  1. 客戶入口按「啟用」，取得 API 金鑰。');
  console.log('  2. 選機房與模型按「啟用」，管理後台的拓樸會在幾秒內多出一塊切片。');
  console.log('  3. 要再開一個客戶，在管理後台的「開客戶帳號」取得新的啟用碼。');
  console.log('\n  按 Ctrl+C 結束全部服務並釋放 GPU 記憶體。');
  if (OPEN) {
    openInBrowser(adminUrl);
    await sleep(800);
    openInBrowser(customerUrl);
  }
});
quickstart.on('exit', (code) => {
  if (!stopping) {
    if (!announced) console.error('\n驗證環境沒有啟動成功，請看上面的訊息。');
    void stop(code ?? 1);
  }
});
