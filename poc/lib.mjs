// Shared helpers for the MaaS local-GPU POC (zero dependencies, Node >= 20).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'poc.config.json'), 'utf8'));
  if (process.env.MAAS_POC_STORAGE) cfg.storageRoot = process.env.MAAS_POC_STORAGE;
  // A Windows drive path (the default is D:/maas-poc-storage) means nothing on Linux or macOS: fall back to ./storage next to the scripts.
  if (process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(cfg.storageRoot)) cfg.storageRoot = path.join(HERE, 'storage');
  cfg.storageRoot = path.resolve(cfg.storageRoot);
  return cfg;
}

/** Storage layout on the data drive. Everything the POC persists lives under storageRoot. */
export function storage(cfg) {
  const root = cfg.storageRoot;
  const dirs = {
    root,
    state: path.join(root, 'state'), // control-plane state: nodes, tenants, keys (hashed)
    ledger: path.join(root, 'ledger'), // usage-YYYY-MM-DD.jsonl (metadata only, no prompts)
    logs: path.join(root, 'logs'), // agent.log / gateway.log
    reports: path.join(root, 'reports'), // bench / acceptance test reports
    models: path.join(root, 'models'), // manifest.json: which weights (by digest) this node may serve
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return dirs;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic write: temp file + rename, so a crash never leaves a half-written state file. */
export function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function makeLogger(file, tag) {
  return (level, msg, extra) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, tag, msg, ...(extra ?? {}) });
    try {
      fs.appendFileSync(file, line + '\n');
    } catch {
      /* ignore */
    }
    const text = `[${tag}] ${level.toUpperCase()} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
    if (level === 'error' || level === 'warn') console.error(text);
    else console.log(text);
  };
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (prefix, bytes = 24) => `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}
