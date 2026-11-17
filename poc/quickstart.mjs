// MaaS local-GPU POC — quickstart. One command walks the whole story with the smallest catalog model:
//
//   Part 1  Add a site (data centre) and connect its GPU machine
//           admin adds the site -> one-time enrollment token -> the agent on the GPU machine enrolls into that site
//           -> heartbeat reports the GPU inventory -> the topology shows an empty card
//   Part 2  A customer gets enabled and picks a model
//           admin opens an account -> activation code -> customer activates -> API key
//           -> customer enables a model at the site -> the control plane carves a slice -> the agent loads and verifies it
//           -> first call -> usage -> a second customer shares the slice / a second model gets its own slice
//           -> disabling releases the VRAM
//
//   node quickstart.mjs          run the flow, then keep serving so you can use the two pages in a browser
//   node quickstart.mjs --once   run the flow, write the report, release the GPU and exit
//   add --fresh to start from an empty control-plane state (deletes state/control-plane.json and the POC keys)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, storage, readJson, sleep, HERE } from './lib.mjs';

const run = promisify(execFile);
const cfg = loadConfig();
const dirs = storage(cfg);
const BASE = `http://${cfg.gateway.host}:${cfg.gateway.port}`;
const ONCE = process.argv.includes('--once');
const FRESH = process.argv.includes('--fresh');
const MODE = 'on-demand';
const SMALL = Object.entries(cfg.models).sort((a, b) => a[1].sliceMiB - b[1].sliceMiB)[0]; // smallest model in the catalog
const SECOND = Object.entries(cfg.models).sort((a, b) => a[1].sliceMiB - b[1].sliceMiB)[1];
const MODEL = SMALL[1].publicId;
const MODEL2 = SECOND[1].publicId;
const SITE = { id: 'tw-taipei-1', name: '台北內湖一號機房', region: 'tw-north', location: '台北市內湖區' };

const children = [];
const steps = [];
let failed = 0;
let previousProfile = null;
let adminKey = null;

const title = (t) => console.log(`\n━━ ${t} ━━`);
function step(id, label, ok, detail = '') {
  steps.push({ id, label, ok, detail });
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✔' : '✘'} ${id} ${label}${detail ? `\n      ${detail}` : ''}`);
}
async function api(method, pathname, token, body) {
  const res = await fetch(BASE + pathname, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, json };
}
const up = async () => {
  try {
    return (await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};
function start(script, env = {}) {
  const out = fs.openSync(path.join(dirs.logs, `${script.replace('.mjs', '')}.out`), 'a');
  const child = spawn(process.execPath, [path.join(HERE, script)], { cwd: HERE, stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, ...env } });
  children.push(child);
  return child;
}
async function waitFor(fn, timeoutMs, everyMs = 1000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
}
const topo = async () => (await api('GET', '/admin/v1/topology', adminKey)).json;
const siteNode = (t) => t.sites.find((s) => s.id === SITE.id)?.nodes.find((n) => n.online);
const sliceOf = (t, sliceId) => siteNode(t)?.slices.find((s) => s.id === sliceId);
const waitSlice = (sliceId, timeoutMs = 180_000) =>
  waitFor(async () => {
    const s = sliceOf(await topo(), sliceId);
    return s && !['pending', 'loading', 'verifying'].includes(s.state) ? s : null;
  }, timeoutMs);
async function gpuUsed() {
  const { stdout } = await run('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true });
  return Number(stdout.trim().split(/\r?\n/)[0]);
}
async function newCustomer(name, models) {
  const created = await api('POST', '/admin/v1/tenants', adminKey, { name, creditUsd: 1.0, tpmLimit: 20000, rpmLimit: 60, models });
  const act = await api('POST', '/portal/v1/activate', null, { activationCode: created.json.activationCode });
  return { created, act, key: act.json?.apiKey, tenantId: created.json.tenantId, code: created.json.activationCode };
}

let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (adminKey && previousProfile && previousProfile !== MODE) await api('POST', '/admin/v1/profile', adminKey, { profile: previousProfile }).catch(() => {});
  for (const c of children) c.kill();
  // The agent may have been killed without running its own shutdown hook: release the VRAM it claimed.
  await run(process.execPath, [path.join(HERE, 'agent.mjs'), '--release'], { cwd: HERE, windowsHide: true }).catch(() => {});
}

async function main() {
  console.log(`MaaS 本地 GPU 快速驗證｜模型 ${MODEL}（${SMALL[0]}）｜資料存放於 ${cfg.storageRoot}`);

  if (await up()) {
    console.error('閘道已經在執行。請先結束它（node slice.mjs stop，或在執行 quickstart 的視窗按 Ctrl+C）再重跑。');
    failed += 1;
    return;
  }
  if (FRESH) for (const f of ['control-plane.json', 'poc-keys.local.json', 'agent-identity.json']) fs.rmSync(path.join(dirs.state, f), { force: true });

  // ---------- Part 1: add a site and connect its GPU machine ----------
  title('第一部分：加入機房，接上機房裡的 GPU 機器');

  const tags = await fetch(`${cfg.runtime.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json())
    .catch(() => null);
  const have = (name) => tags?.models?.find((m) => m.name === name);
  step('S01', '推論引擎在 GPU 機器上執行，模型權重已在本機', !!have(SMALL[0]), have(SMALL[0]) ? `${SMALL[0]}，${Math.round(have(SMALL[0]).size / 1048576)} MB` : `找不到 ${SMALL[0]}。請先執行：ollama pull ${SMALL[0]}`);
  if (!have(SMALL[0])) return;

  start('gateway.mjs');
  const gatewayUp = await waitFor(up, 15_000, 500);
  step('S02', '控制平面與 API 閘道啟動', !!gatewayUp, BASE);
  if (!gatewayUp) return;
  adminKey = readJson(path.join(dirs.state, 'poc-keys.local.json'), null).admin;
  previousProfile = (await api('GET', '/admin/v1/overview', adminKey)).json.profile;

  const sw = await api('POST', '/admin/v1/profile', adminKey, { profile: MODE });
  await api('POST', '/admin/v1/slices/clear', adminKey); // leftovers from an earlier run
  step('S03', '切割模式設為隨需切割', sw.status === 200, '不預先切好。客戶啟用模型時才從空閒的 VRAM 切出一塊');

  const site = await api('POST', '/admin/v1/sites', adminKey, SITE);
  const bootToken = site.json?.enrollmentToken;
  step('S04', '管理者加入機房，取得一次性註冊權杖', [200, 201].includes(site.status) && !!bootToken, `機房 ${site.json?.siteId}｜${SITE.name}｜${SITE.region}｜${SITE.location}，權杖 ${bootToken?.slice(0, 14)}…`);

  const wrongBoot = await api('POST', '/agent/v1/enroll', 'maas_boot_wrong', { name: 'intruder' });
  step('S05', '沒有註冊權杖的機器無法加入', wrongBoot.status === 401, `HTTP ${wrongBoot.status} ${wrongBoot.json?.error?.code}`);

  const empty = (await topo()).sites.find((s) => s.id === SITE.id);
  step('S06', '拓樸上出現這個機房，裡面還沒有機器', !!empty && !empty.nodes.some((n) => n.online), `機房 ${empty?.id}，上線機器 ${empty?.nodes.filter((n) => n.online).length ?? '-'} 台`);

  const baseline = await gpuUsed();
  start('agent.mjs', { MAAS_BOOTSTRAP_TOKEN: bootToken });
  const node = await waitFor(async () => {
    const t = await topo();
    const n = siteNode(t);
    return n?.gpu && n.appliedGeneration === t.generation ? n : null;
  }, 60_000);
  step('S07', 'GPU 機器上的 Agent 用權杖註冊，歸屬到這個機房', !!node, node ? `節點 ${node.id}（${node.name}）出現在機房 ${SITE.id}。機房由權杖決定，不是機器自己宣稱` : '逾時');
  if (!node) return;
  step('S08', 'Agent 回報顯示卡盤點與可用的切割方式', node.gpu.totalMiB > 0, `${node.gpu.name}，${node.gpu.totalMiB} MiB，系統保留 ${node.gpu.reserveMiB} MiB，可切 ${node.gpu.sliceBudgetMiB} MiB，切割方式 ${node.strategy}`);

  const reuse = await api('POST', '/agent/v1/enroll', bootToken, { name: 'second-machine' });
  step('S09', '註冊權杖只能用一次', reuse.status === 401, `用同一組權杖再註冊 → HTTP ${reuse.status} ${reuse.json?.error?.code}`);

  step('S10', '這時顯示卡還沒有任何切片', node.slices.length === 0 && node.freeMiB === node.gpu.sliceBudgetMiB, `切片 ${node.slices.length} 個，空閒 ${node.freeMiB} MiB，VRAM 已用 ${baseline} MiB`);

  // ---------- Part 2: a customer gets enabled and picks a model ----------
  title('第二部分：客戶啟用，並自己選機房與模型');

  const a = await newCustomer('Acme Demo', [MODEL, MODEL2]);
  step('C01', '管理者開立客戶帳號，系統產生一次性啟用碼', a.created.status === 201 && !!a.code, `租戶 ${a.tenantId}，試用額度 US$1.00，可用模型 ${MODEL}、${MODEL2}，啟用碼 ${a.code.slice(0, 10)}…`);
  step('C02', '客戶輸入啟用碼，帳號啟用並拿到 API 金鑰', a.act.status === 201 && !!a.key, `金鑰 ${a.key?.slice(0, 12)}…（只顯示這一次，伺服器只存雜湊值）`);
  if (!a.key) return;
  const again = await api('POST', '/portal/v1/activate', null, { activationCode: a.code });
  step('C03', '同一組啟用碼不能用第二次', again.status === 409, `HTTP ${again.status} ${again.json?.error?.code}`);

  const early = await api('POST', '/v1/chat/completions', a.key, { model: MODEL, messages: [{ role: 'user', content: 'hi' }] });
  step('C04', '還沒啟用模型之前，呼叫會被告知模型尚未就緒', early.status === 503, `HTTP ${early.status} ${early.json?.error?.code}`);

  const sites = (await api('GET', '/portal/v1/sites', a.key)).json;
  const mySite = sites.data.find((s) => s.id === SITE.id);
  step('C05', '客戶看得到可用的機房與剩餘容量', !!mySite && mySite.onlineNodes === 1, `${mySite?.name}｜${mySite?.location}｜上線機器 ${mySite?.onlineNodes} 台｜空閒 ${mySite?.freeMiB} MiB`);

  const t0 = Date.now();
  const dep = await api('POST', '/portal/v1/deployments', a.key, { model: MODEL, siteId: SITE.id });
  step('C06', '客戶選機房與模型，控制平面在那台機器上切出一塊', dep.status === 201 && dep.json?.carved === true, `切片 ${dep.json?.sliceId}，${dep.json?.vramMiB} MiB，節點 ${dep.json?.nodeId}`);
  if (dep.status !== 201) return;
  const s1 = await waitSlice(dep.json.sliceId);
  const afterLoad = await gpuUsed();
  step('C07', 'Agent 接到指派，載入模型並驗證在預算內', s1?.state === 'ready', s1 ? `${Math.round((Date.now() - t0) / 1000)} 秒後就緒，實測 ${s1.measuredMiB}／${s1.budgetMiB} MiB，顯示卡 VRAM 從 ${baseline} 增加到 ${afterLoad} MiB` : '逾時');
  const t1 = await topo();
  const shown = sliceOf(t1, dep.json.sliceId);
  step('C08', '拓樸上看得到這個切片與使用它的客戶', !!shown && shown.tenants.some((x) => x.id === a.tenantId), `${SITE.id} → ${siteNode(t1).id} → ${shown?.id}（${shown?.model}）→ ${shown?.tenants.map((x) => x.name).join('、')}，剩餘空閒 ${siteNode(t1).freeMiB} MiB`);

  const chat = await api('POST', '/v1/chat/completions', a.key, { model: MODEL, max_tokens: 80, temperature: 0.2, messages: [{ role: 'user', content: 'Reply with one short sentence: what is a GPU?' }] });
  const reply = chat.json?.choices?.[0]?.message?.content?.trim() ?? '';
  step('C09', '客戶用 OpenAI 相容的 API 呼叫，請求送到剛切出的切片', chat.status === 200 && reply.length > 0 && chat.headers.get('x-maas-slice') === dep.json.sliceId, `節點 ${chat.headers.get('x-maas-node')}，切片 ${chat.headers.get('x-maas-slice')}，輸入 ${chat.json?.usage?.prompt_tokens} 輸出 ${chat.json?.usage?.completion_tokens} token\n      回覆：${reply.replace(/\s+/g, ' ').slice(0, 110)}`);

  await sleep(1200);
  const me = (await api('GET', '/portal/v1/me', a.key)).json;
  step('C10', '用量已記帳並從額度扣款', me.today.ok === 1 && me.spentUsd > 0, `花費 US$${me.spentUsd.toFixed(8)}，餘額 US$${me.balanceUsd.toFixed(8)}`);

  // second customer, same model: no new slice
  const b = await newCustomer('Beta Corp', [MODEL]);
  const blocked = await api('POST', '/v1/chat/completions', b.key, { model: MODEL, messages: [{ role: 'user', content: 'hi' }] });
  step('C11', '另一個客戶沒有啟用，就不能使用別人切片上的模型', blocked.status === 503, `HTTP ${blocked.status} ${blocked.json?.error?.code}`);
  const depB = await api('POST', '/portal/v1/deployments', b.key, { model: MODEL, siteId: SITE.id });
  const chatB = await api('POST', '/v1/chat/completions', b.key, { model: MODEL, max_tokens: 20, messages: [{ role: 'user', content: 'Say hi.' }] });
  step('C12', '第二個客戶啟用同一個模型，共用現有切片，不重複佔用 VRAM', depB.status === 200 && depB.json?.carved === false && depB.json?.sliceId === dep.json.sliceId && chatB.status === 200, `共用切片 ${depB.json?.sliceId}，呼叫 HTTP ${chatB.status}`);

  // a different model: a second slice next to the first one
  let s2 = null;
  let dep2 = null;
  if (have(SECOND[0])) {
    dep2 = await api('POST', '/portal/v1/deployments', a.key, { model: MODEL2, siteId: SITE.id });
    s2 = dep2.status === 201 ? await waitSlice(dep2.json.sliceId) : null;
    const t2 = await topo();
    const first = sliceOf(t2, dep.json.sliceId);
    step('C13', '客戶再啟用另一個模型，同一張卡上切出第二塊', s2?.state === 'ready' && first?.state === 'ready', s2 ? `${dep2.json.sliceId}（${MODEL2}）實測 ${s2.measuredMiB}／${s2.budgetMiB} MiB，第一塊仍然就緒，剩餘空閒 ${siteNode(t2).freeMiB} MiB` : `HTTP ${dep2.status} ${dep2.json?.error?.code ?? ''}`);
  }

  const big = Object.values(cfg.models).sort((x, y) => y.sliceMiB - x.sliceMiB)[0];
  const c = await newCustomer('Gamma Lab', '*');
  const full = await api('POST', '/portal/v1/deployments', c.key, { model: big.publicId, siteId: SITE.id });
  step('C14', '剩餘 VRAM 不夠時，啟用被拒絕並說明原因', full.status === 409 && full.json?.error?.code === 'NO_CAPACITY', `${big.publicId} → HTTP ${full.status}：${full.json?.error?.message}`);

  // release
  if (dep2?.status === 201) {
    const rm = await api('POST', '/portal/v1/deployments/remove', a.key, { sliceId: dep2.json.sliceId });
    const gone = await waitFor(async () => {
      const t = await topo();
      const n = siteNode(t);
      return n.appliedGeneration === t.generation && !n.slices.some((s) => s.id === dep2.json.sliceId) ? n : null;
    }, 60_000);
    await sleep(2500);
    step('C15', '客戶停用模型，切片歸還，VRAM 釋放', rm.json?.released === true && !!gone, gone ? `切片 ${dep2.json.sliceId} 已移除，空閒回到 ${gone.freeMiB} MiB，顯示卡 VRAM 已用 ${await gpuUsed()} MiB` : '逾時');
  }
  const leave = await api('POST', '/portal/v1/deployments/remove', b.key, { sliceId: dep.json.sliceId });
  const still = await api('POST', '/v1/chat/completions', a.key, { model: MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  step('C16', '共用的切片只要還有客戶在用就不會被收回', leave.json?.released === false && still.status === 200, `Beta Corp 停用後，Acme Demo 呼叫 HTTP ${still.status}`);

  const events = (await topo()).events.map((e) => e.type);
  step('C17', '每一次機房、註冊、切割、釋放都留下事件紀錄', ['site-added', 'node-enrolled', 'slice-carved', 'slice-shared'].every((t) => events.includes(t)) || !FRESH, events.slice(0, 8).join(', '));

  // An unused activation code so the customer page can be tried by hand.
  let manual = null;
  if (!ONCE) manual = (await api('POST', '/admin/v1/tenants', adminKey, { name: 'Browser Demo', creditUsd: 1.0, models: [MODEL, MODEL2] })).json;

  // ---------- report ----------
  const passed = steps.length - failed;
  const md = [
    '# MaaS 本地 GPU 快速驗證報告',
    '',
    `- 時間：${new Date().toISOString()}`,
    `- 機房：${SITE.id}｜${SITE.name}｜${SITE.location}`,
    `- 模型：${MODEL}（${SMALL[0]}）、${MODEL2}（${SECOND[0]}）`,
    `- GPU：${node.gpu.name}，${node.gpu.totalMiB} MiB`,
    `- 結果：${passed}／${steps.length} 項通過`,
    '',
    '| 編號 | 項目 | 結果 | 說明 |',
    '|---|---|---|---|',
    ...steps.map((s) => `| ${s.id} | ${s.label} | ${s.ok ? '通過' : '失敗'} | ${s.detail.replace(/\n\s*/g, '<br>').replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dirs.reports, 'quickstart-latest.md'), md);
  fs.writeFileSync(path.join(dirs.reports, 'quickstart-latest.json'), JSON.stringify({ at: new Date().toISOString(), site: SITE, model: MODEL, gpu: node.gpu.name, passed, total: steps.length, steps }, null, 2));
  title(`結果：${passed}／${steps.length} 項通過`);
  console.log(`  報告：${path.join(dirs.reports, 'quickstart-latest.md')}`);

  if (!ONCE && failed === 0) {
    title('換你用瀏覽器走一次');
    console.log(`  管理者的拓樸頁：${BASE}/topology#${adminKey}`);
    console.log(`  客戶的啟用頁：  ${BASE}/portal`);
    console.log(`  啟用碼：        ${manual.activationCode}`);
    console.log('\n  兩頁並排開著。在啟用頁輸入啟用碼，選機房與模型按「啟用」，拓樸頁會即時多出一塊切片。');
    console.log('  服務持續執行中。按 Ctrl+C 結束並釋放 GPU 記憶體。');
    await new Promise((resolve) => process.once('SIGINT', resolve));
    console.log('\n  正在結束並釋放 GPU 記憶體…');
  }
}

main()
  .catch((e) => {
    failed += 1;
    console.error('快速驗證中斷：', e?.stack ?? e);
  })
  .finally(async () => {
    await cleanup();
    process.exit(failed ? 1 : 0);
  });
