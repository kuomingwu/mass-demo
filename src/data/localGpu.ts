/**
 * Local GPU onboarding: flow steps, partitioning strategies, GPU catalog for the slice planner,
 * node software stack, and the snapshot measured in the validation environment (poc/, see poc/README.md).
 * All display text lives in the i18n dictionaries under `localgpu.*`; this file holds ids, numbers and commands only.
 */
import snapshot from './localGpuPoc.snapshot.json';

export interface PocSlice {
  id: string;
  publicId: string;
  sharing: string;
  tenantId: string | null;
  budgetMiB: number;
  reportedMiB: number;
  measuredMiB: number;
  numCtx: number;
  loadMs: number;
  state: string;
}
export interface PocBenchModel {
  tokPerSec: number;
  ttftMsP50: number;
  ttftMsP95: number;
}
export interface PocBenchmark {
  group: string;
  label: string;
  concurrency: number;
  totalTokPerSec: number;
  errors: number;
  gpuUtilPct: number;
  gpuPowerW: number;
  perModel: Record<string, PocBenchModel>;
}
export interface PocSnapshot {
  generatedAt: string;
  storageRoot: string;
  node: { name: string; agentVersion: string; gpuName: string; memoryTotalMiB: number; reserveMiB: number; sliceBudgetMiB: number; driver: string; runtime: string; os: string; mig: string; strategy: string; measurement: { baselineUsedMiB: number; loadedUsedMiB: number; gpuDeltaMiB: number; runtimeReportedMiB: number; overheadMiB: number } | null };
  slices: PocSlice[];
  dedicated: { switchMs: number; slice: PocSlice } | null;
  checks: { id: string; title: string; pass: boolean; detail: string }[];
  benchmarks: PocBenchmark[];
  interference: Record<string, { soloTokPerSec: number | null; contendedTokPerSec: number | null; retainedPct: number | null }>;
  capacity: { peakAggregateTokPerSec: number; outputTokensPerDayAt: { util10: number; util30: number; util60: number }; gpuPowerWAtPeak: number | null };
  totals: { passed: number; failed: number };
}
/** Numbers measured by poc/bench.mjs on this machine (refresh with poc/export-snapshot.mjs). */
export const POC_SNAPSHOT = snapshot as unknown as PocSnapshot;

// ---------- onboarding flow ----------
export interface FlowStep {
  id: string;
  /** commands for the production path (Linux, data-centre GPU) */
  commands?: string;
}

export const FLOW_STEPS: FlowStep[] = [
  {
    id: 'inventory',
    commands: ['nvidia-smi --query-gpu=index,name,memory.total,driver_version --format=csv', 'nvidia-smi --query-gpu=mig.mode.current --format=csv   # "[N/A]" = this card cannot do MIG'].join('\n'),
  },
  {
    id: 'driver',
    commands: ['sudo ubuntu-drivers install --gpgpu        # server driver branch', 'sudo nvidia-smi -pm 1                     # persistence mode', 'nvidia-smi                                # every GPU listed, no Xid errors in dmesg'].join('\n'),
  },
  {
    id: 'container',
    commands: [
      'sudo apt-get install -y nvidia-container-toolkit',
      'sudo nvidia-ctk runtime configure --runtime=containerd && sudo systemctl restart containerd',
      '# fleet: Kubernetes + NVIDIA GPU Operator (device plugin, MIG manager, DCGM exporter)',
      'helm install gpu-operator nvidia/gpu-operator -n gpu-operator --create-namespace',
    ].join('\n'),
  },
  {
    id: 'agent',
    commands: ['# one-time bootstrap token from the console; the agent only makes outbound HTTPS calls', 'curl -fsSL https://console.example.com/agent/install.sh | sudo MAAS_BOOTSTRAP_TOKEN=<one-time-token> sh', 'systemctl status maas-agent', 'journalctl -u maas-agent -n 20            # "enrolled", then a heartbeat every 5 s'].join('\n'),
  },
  {
    id: 'partition',
    commands: ['# hardware slices with MIG (example: two 40 GB slices on one H100)', 'sudo nvidia-smi -i 0 -mig 1', 'sudo nvidia-smi mig -i 0 -cgi 3g.40gb,3g.40gb -C', 'nvidia-smi -L                             # lists the MIG devices and their UUIDs'].join('\n'),
  },
  {
    id: 'runtime',
    commands: [
      '# one inference engine per slice; weights come from the local NVMe cache, verified by digest',
      'docker run --gpus "device=0" -v /var/lib/maas/models:/models -p 8000:8000 vllm/vllm-openai:latest \\',
      '  --model /models/Qwen3.6-35B-A3B --served-model-name qwen3.6-35b-a3b \\',
      '  --max-model-len 32768 --gpu-memory-utilization 0.90',
      'curl -s localhost:8000/v1/models',
    ].join('\n'),
  },
  {
    id: 'gateway',
    commands: ['curl -s https://api.example.com/v1/models -H "Authorization: Bearer $MAAS_API_KEY"', 'curl -s https://api.example.com/v1/chat/completions -H "Authorization: Bearer $MAAS_API_KEY" \\', '  -H "Content-Type: application/json" \\', '  -d \'{"model":"qwen3.6-35b-a3b","messages":[{"role":"user","content":"hello"}]}\''].join('\n'),
  },
  {
    id: 'metering',
    commands: ['# one ledger record per request: who, which model, which slice, tokens, cost. Never the prompt.', '{"ts":"2026-11-15T12:46:11Z","requestId":"req_x1","tenantId":"t-star","keyId":"key-prod","model":"qwen3.6-35b-a3b",', ' "nodeId":"node-tpe-a-07","sliceId":"gpu0","status":200,"promptTokens":34,"completionTokens":127,', ' "costUsd":0.0000318,"ttftMs":58,"durationMs":1240}'].join('\n'),
  },
  { id: 'acceptance' },
];

// ---------- partitioning strategies ----------
export type StrategyId = 'whole' | 'mig' | 'timeslice' | 'mps' | 'vram';
export const STRATEGIES: { id: StrategyId; isolation: 'strong' | 'hardware' | 'none' | 'limited' | 'admission' }[] = [
  { id: 'whole', isolation: 'strong' },
  { id: 'mig', isolation: 'hardware' },
  { id: 'timeslice', isolation: 'none' },
  { id: 'mps', isolation: 'limited' },
  { id: 'vram', isolation: 'admission' },
];

// ---------- slice planner ----------
export interface PlannerLayout {
  id: string;
  strategy: 'whole' | 'mig' | 'vram';
  /** slice sizes in GiB, with the MIG profile name when applicable */
  slices: { gib: number; profile?: string }[];
}
export interface PlannerGpu {
  id: string;
  name: string;
  vramGib: number;
  mig: boolean;
  layouts: PlannerLayout[];
}

const rep = (n: number, gib: number, profile: string) => Array.from({ length: n }, () => ({ gib, profile }));

export const PLANNER_GPUS: PlannerGpu[] = [
  {
    id: 'h100',
    name: 'NVIDIA H100 80GB',
    vramGib: 80,
    mig: true,
    layouts: [
      { id: 'whole', strategy: 'whole', slices: [{ gib: 80 }] },
      { id: 'mig-2x40', strategy: 'mig', slices: rep(2, 40, '3g.40gb') },
      { id: 'mig-40-20-10', strategy: 'mig', slices: [{ gib: 40, profile: '4g.40gb' }, { gib: 20, profile: '2g.20gb' }, { gib: 10, profile: '1g.10gb' }] },
      { id: 'mig-3x20-10', strategy: 'mig', slices: [...rep(3, 20, '2g.20gb'), { gib: 10, profile: '1g.10gb' }] },
      { id: 'mig-7x10', strategy: 'mig', slices: rep(7, 10, '1g.10gb') },
    ],
  },
  {
    id: 'h200',
    name: 'NVIDIA H200 141GB',
    vramGib: 141,
    mig: true,
    layouts: [
      { id: 'whole', strategy: 'whole', slices: [{ gib: 141 }] },
      { id: 'mig-2x71', strategy: 'mig', slices: rep(2, 71, '3g.71gb') },
      { id: 'mig-3x35-18', strategy: 'mig', slices: [...rep(3, 35, '2g.35gb'), { gib: 18, profile: '1g.18gb' }] },
      { id: 'mig-7x18', strategy: 'mig', slices: rep(7, 18, '1g.18gb') },
    ],
  },
  { id: 'l40s', name: 'NVIDIA L40S 48GB', vramGib: 48, mig: false, layouts: [{ id: 'whole', strategy: 'whole', slices: [{ gib: 48 }] }] },
  {
    id: 'rtx4080m',
    name: 'Workstation GPU 12GB (no MIG)',
    vramGib: 12,
    mig: false,
    layouts: [
      { id: 'vram-shared-2', strategy: 'vram', slices: [{ gib: 3.75 }, { gib: 3.5 }] },
      { id: 'vram-dedicated-1', strategy: 'vram', slices: [{ gib: 10.25 }] },
    ],
  },
];

/** VRAM a model needs in one slice (weights + KV cache + process overhead), GiB. `measured` = from the POC on this machine. */
export const PLANNER_MODELS: { id: string; needGib: number; measured: boolean }[] = [
  { id: 'bge-m3 (embedding)', needGib: 2, measured: false },
  { id: 'llama-3.2-3b Q4', needGib: 3.1, measured: true },
  { id: 'gemma-3-4b Q4', needGib: 3.4, measured: true },
  { id: 'gemma-3-taide-12b Q4', needGib: 7.6, measured: true },
  { id: 'gemma-3-taide-12b BF16', needGib: 28, measured: false },
  { id: 'qwen3.8-27b FP8', needGib: 34, measured: false },
  { id: 'qwen3.8-27b BF16', needGib: 62, measured: false },
  { id: 'gpt-oss-120b', needGib: 70, measured: false },
];

export function modelsThatFit(gib: number): typeof PLANNER_MODELS {
  return PLANNER_MODELS.filter((m) => m.needGib <= gib);
}

// ---------- node software stack ----------
export const NODE_STACK: { id: string; component: string }[] = [
  { id: 'os', component: 'Ubuntu Server 22.04 / 24.04 LTS' },
  { id: 'driver', component: 'NVIDIA data-centre driver' },
  { id: 'container', component: 'containerd + NVIDIA Container Toolkit' },
  { id: 'orchestrator', component: 'Kubernetes + NVIDIA GPU Operator' },
  { id: 'agent', component: 'maas-agent (systemd / DaemonSet)' },
  { id: 'runtime', component: 'vLLM / SGLang' },
  { id: 'modelCache', component: 'NVMe cache + object storage' },
  { id: 'telemetry', component: 'DCGM exporter + Prometheus' },
  { id: 'security', component: 'mTLS node certificate, outbound-only' },
];

export const AGENT_DUTIES = ['inventory', 'enroll', 'heartbeat', 'reconcile', 'cache'] as const;
export const AGENT_NEVER = ['keys', 'prompts', 'inbound'] as const;

export const AGENT_PROTOCOL = [
  'POST /agent/v1/enroll      Authorization: Bearer <one-time bootstrap token>',
  '  -> { nodeId, nodeToken }',
  '',
  'POST /agent/v1/heartbeat   Authorization: Bearer <node token>          (every 5 s)',
  '  body : GPU telemetry, runtime health, ACTUAL state of every slice',
  '  reply: DESIRED slices for this node (generation N)',
  '',
  'agent reconciles: admission control -> unload -> load -> measure VRAM -> ready',
].join('\n');

export const POC_STORAGE_LAYOUT = [
  'GPU node  /var/lib/maas/',
  '  state/     node-identity.json     node id + node credential',
  '  models/    <model>/<digest>/      weights cache, verified by digest',
  '             manifest.json          which weights this node may serve',
  '  logs/      agent.log',
  '',
  'Control plane (never on the node)',
  '  state      tenants, balances, key hashes, node registry',
  '  ledger     one record per request, metadata only',
  '  reports    acceptance report of every node',
].join('\n');

export const POC_RUN_COMMANDS = [
  'cd poc',
  'node gateway.mjs                     # control plane + OpenAI-compatible gateway',
  'node agent.mjs                       # node agent: enrolls, loads the slices, heartbeats',
  'node bench.mjs --with-dedicated      # acceptance checks + load test, writes the report',
  'node agent.mjs --release             # free the GPU memory when finished',
].join('\n');

export const POC_GATEWAY_DEFAULT = 'http://127.0.0.1:8787';
