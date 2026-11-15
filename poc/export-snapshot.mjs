// Copies the latest POC test report (D: drive) into the demo console as a trimmed snapshot,
// so the "Local GPU" page shows the numbers actually measured on this machine.
//   node export-snapshot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { HERE, loadConfig, storage } from './lib.mjs';

const cfg = loadConfig();
const dirs = storage(cfg);
const r = JSON.parse(fs.readFileSync(path.join(dirs.reports, 'latest.json'), 'utf8'));
const slice = (s) => ({ id: s.id, publicId: s.publicId, sharing: s.sharing, tenantId: s.tenantId, budgetMiB: s.budgetMiB, reportedMiB: s.vramMiB, measuredMiB: s.measuredMiB ?? s.vramMiB, numCtx: s.numCtx, loadMs: s.loadMs, state: s.state });
const snapshot = {
  generatedAt: r.generatedAt,
  storageRoot: r.storageRoot.replace(/\\/g, '/'),
  node: {
    name: r.node.name,
    agentVersion: r.node.agentVersion,
    gpuName: r.node.gpu.name,
    memoryTotalMiB: r.node.gpu.memoryTotalMiB,
    reserveMiB: r.node.gpu.reserveMiB,
    sliceBudgetMiB: r.node.gpu.sliceBudgetMiB,
    driver: r.node.gpu.driver,
    runtime: `${r.node.runtime.kind} ${r.node.runtime.version}`,
    os: r.node.partitioning.os,
    mig: r.node.partitioning.mig,
    strategy: r.node.partitioning.strategy,
    measurement: r.node.partitioning.measurement,
  },
  slices: r.node.slices.map(slice),
  dedicated: r.dedicated ? { switchMs: r.dedicated.switchMs, slice: slice(r.dedicated.slice) } : null,
  checks: r.checks,
  benchmarks: r.benchmarks.map((b) => ({
    group: b.group,
    label: b.label,
    concurrency: b.concurrency,
    totalTokPerSec: b.totalAggregateTokPerSec,
    errors: b.errors,
    gpuUtilPct: b.gpu.utilizationPctAvg,
    gpuPowerW: b.gpu.powerWAvg,
    perModel: Object.fromEntries(Object.entries(b.perModel).map(([m, v]) => [m, { tokPerSec: v.aggregateTokPerSec, ttftMsP50: v.ttftMsP50, ttftMsP95: v.ttftMsP95 }])),
  })),
  interference: r.interference,
  capacity: r.capacity,
  totals: { passed: r.totals.passed, failed: r.totals.failed },
};
const out = path.resolve(HERE, '../src/data/localGpuPoc.snapshot.json');
// Machine-specific paths do not belong on a product page: show the storage root as <data-root>.
const rootRe = new RegExp(cfg.storageRoot.replace(/[\\/]/g, '[\\\\/]+'), 'gi');
const text = JSON.stringify(snapshot, null, 2).replace(rootRe, '<data-root>').replace(/<data-root>[\\/]+/g, '<data-root>/');
fs.writeFileSync(out, text + '\n');
console.log(`snapshot written: ${out} (${snapshot.totals.passed} passed, ${snapshot.totals.failed} failed, ${snapshot.benchmarks.length} benchmark rows)`);
