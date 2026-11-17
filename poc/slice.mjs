// MaaS local-GPU POC — try GPU slicing by hand.
//
//   node slice.mjs list              show the partition profiles in poc.config.json
//   node slice.mjs apply <profile>   apply a profile and show what the agent actually did on the GPU
//   node slice.mjs status            show the current slices and GPU memory
//   node slice.mjs url               print the admin topology link (with the current admin key) and the customer page link
//   node slice.mjs stop              unload the models, stop the gateway and agent, free the GPU memory
//
// `apply` starts the gateway and the agent if they are not running, and leaves them running.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, storage, readJson, writeJson, sleep, HERE } from './lib.mjs';

const run = promisify(execFile);
const cfg = loadConfig();
const dirs = storage(cfg);
const BASE = `http://${cfg.gateway.host}:${cfg.gateway.port}`;
const PIDS = path.join(dirs.state, 'poc-pids.local.json');
const [cmd, arg] = process.argv.slice(2);

const adminKey = () => readJson(path.join(dirs.state, 'poc-keys.local.json'), {}).admin;
async function api(method, pathname, body) {
  const res = await fetch(BASE + pathname, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${adminKey()}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const up = () =>
  fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
async function gpuUsed() {
  const { stdout } = await run('nvidia-smi', ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true });
  const [name, used, total] = stdout.trim().split(/\r?\n/)[0].split(',').map((x) => x.trim());
  return { name, used: Number(used), total: Number(total) };
}
function startDetached(script) {
  const out = fs.openSync(path.join(dirs.logs, `${script.replace('.mjs', '')}.out`), 'a');
  const child = spawn(process.execPath, [path.join(HERE, script)], { cwd: HERE, stdio: ['ignore', out, out], detached: true, windowsHide: true });
  child.unref();
  const pids = readJson(PIDS, {});
  pids[script] = child.pid;
  writeJson(PIDS, pids);
}
const pad = (s, n) => {
  const str = String(s);
  // CJK characters take two columns in a terminal
  const width = [...str].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  return str + ' '.repeat(Math.max(0, n - width));
};
function table(head, rows) {
  const w = head.map((h, i) => Math.max(...[h, ...rows.map((r) => r[i])].map((v) => [...String(v)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0))));
  const line = (r) => '  ' + r.map((v, i) => pad(v, w[i])).join('  ');
  console.log(line(head));
  console.log('  ' + w.map((n) => '─'.repeat(n)).join('  '));
  rows.forEach((r) => console.log(line(r)));
}
const STATE = { ready: '就緒', 'rejected-no-capacity': '拒絕：VRAM 不夠', 'over-budget': '超出預算', 'cpu-offload': '溢到系統記憶體', 'model-missing': '缺少模型權重', failed: '載入失敗', loading: '載入中', verifying: '驗證中', 'not-loaded': '未載入' };

function list() {
  for (const [name, p] of Object.entries(cfg.profiles)) {
    console.log(`\n${name}：${p.description}`);
    table(['切片', '預算 MiB', '模型', '共用或專屬', '同時請求'], p.slices.map((s) => [s.id, s.vramMiB, cfg.models[s.model]?.publicId ?? s.model, s.sharing === 'dedicated' ? `專屬 ${s.tenantId}` : '共用', s.maxInflight]));
  }
}

async function showStatus(o) {
  const node = o.nodes.find((n) => n.online);
  const g = await gpuUsed();
  console.log(`\n配置 ${o.profile}（第 ${o.generation} 版）｜${g.name}｜VRAM 已用 ${g.used}／${g.total} MiB`);
  if (!node) return console.log('  沒有上線的節點。');
  const m = node.partitioning?.measurement;
  console.log(`切割方式：${node.partitioning.strategy}｜可切片預算 ${node.gpu.sliceBudgetMiB} MiB（保留 ${node.gpu.reserveMiB} MiB 給系統）`);
  table(
    ['切片', '模型', '狀態', '預算 MiB', '實測 MiB', '在 GPU 上', '說明'],
    node.slices.map((s) => [s.id, s.publicId, STATE[s.state] ?? s.state, s.budgetMiB, s.measuredMiB ?? '-', s.gpuPct != null ? `${s.gpuPct}%` : '-', s.detail ?? '']),
  );
  if (m) console.log(`量測：載入前 ${m.baselineUsedMiB} MiB → 載入後 ${m.loadedUsedMiB} MiB，增加 ${m.gpuDeltaMiB} MiB（引擎自報 ${m.runtimeReportedMiB} MiB，額外開銷 ${m.overheadMiB} MiB）`);
}

async function apply(profile) {
  if (!cfg.profiles[profile]) {
    console.error(`沒有這個配置。可用的有：${Object.keys(cfg.profiles).join('、')}`);
    process.exit(1);
  }
  const before = await gpuUsed();
  if (!(await up())) {
    console.log('啟動閘道…');
    startDetached('gateway.mjs');
    for (let i = 0; i < 30 && !(await up()); i++) await sleep(500);
  }
  const sw = await api('POST', '/admin/v1/profile', { profile });
  console.log(`已指派配置 ${profile}（第 ${sw.json.generation} 版）。套用前 VRAM 已用 ${before.used} MiB。`);
  if (!(await api('GET', '/admin/v1/overview')).json.nodes.some((n) => n.online)) {
    console.log('啟動 Agent…');
    startDetached('agent.mjs');
  }
  process.stdout.write('等待 Agent 套用');
  const t0 = Date.now();
  for (;;) {
    const o = (await api('GET', '/admin/v1/overview')).json;
    const node = o.nodes.find((n) => n.online && n.appliedGeneration === o.generation);
    if (node && node.slices.length && node.slices.every((s) => !['loading', 'verifying'].includes(s.state))) {
      console.log(` 完成，${Math.round((Date.now() - t0) / 1000)} 秒`);
      return showStatus(o);
    }
    if (Date.now() - t0 > 300_000) {
      console.log(' 逾時');
      return showStatus(o);
    }
    process.stdout.write('.');
    await sleep(2000);
  }
}

async function stop() {
  const pids = readJson(PIDS, {});
  for (const [script, pid] of Object.entries(pids)) {
    try {
      process.kill(pid);
      console.log(`已停止 ${script}（${pid}）`);
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(PIDS, { force: true });
  await run(process.execPath, [path.join(HERE, 'agent.mjs'), '--release'], { cwd: HERE, windowsHide: true }).catch(() => {});
  await sleep(2500);
  const g = await gpuUsed();
  console.log(`已釋放。VRAM 已用 ${g.used}／${g.total} MiB`);
}

if (cmd === 'list') list();
else if (cmd === 'apply') await apply(arg);
else if (cmd === 'status') {
  if (!(await up())) console.log('閘道沒有在執行。先執行：node slice.mjs apply <配置>');
  else await showStatus((await api('GET', '/admin/v1/overview')).json);
} else if (cmd === 'stop') await stop();
else if (cmd === 'url') {
  // Print the admin topology link with the current admin key (the key changes whenever the state is reset).
  console.log(`${BASE}/topology#${adminKey()}`);
  console.log(`${BASE}/portal`);
}
else console.log('用法：node slice.mjs list | apply <配置> | status | url | stop');
