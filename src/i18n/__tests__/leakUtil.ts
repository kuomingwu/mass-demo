// i18n 外漏偵測的共用工具（測試專用）
import allowlist from '../allowlist.json';
import zhTW from '../zh-TW';
import ja from '../ja';

/** 平假名、片假名、CJK 擴充 A、CJK 統一漢字、相容漢字 */
export const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]+/g;

/**
 * 繁體專用字：日文使用新字體（号 価 区 鍵 単 応 択 証 読 写 録 変 処 点 実 験 拠 営 囲 対 説 従 啓），
 * 這些繁體字形不會出現在自然的日文中；用來偵測 ja 頁面的 zh-TW 外漏。
 * 刻意排除日文也使用的字（例如 為替 的「為」、時間、機能、請求、開始、運用、選択的「選」、費用、標準）。
 */
export const TRAD_ONLY = /[們這與戶關號價區鑰單臺應擇證讀寫錄變處點實驗據營圍對說從啟]/g;

export const NAMES: string[] = [...(allowlist as { names: string[] }).names].sort((a, b) => b.length - a.length);

export function isAllowedRun(run: string): boolean {
  return NAMES.some((n) => n === run || (run.length >= 2 && n.includes(run)));
}

/** 移除 allowlist 專有名詞（最長者優先），避免其中的繁體字被誤判 */
export function stripNames(text: string): string {
  let out = text;
  for (const n of NAMES) out = out.split(n).join(' ');
  return out;
}

/** en：非 allowlist 的 CJK 片段 */
export function enLeaks(text: string): string[] {
  return Array.from(new Set((text.match(CJK) ?? []).filter((r) => !isAllowedRun(r))));
}

const JA_VALUES = new Set(Object.values(ja));
/**
 * 可疑的 zh-TW 文案：含 CJK、長度 ≥ 3、無插補參數、與 ja 對應值不同、且不等於任何 ja 文案、不是 allowlist 專有名詞。
 * 這些字串原封不動出現在 ja 頁面上，代表該處沒有翻譯。
 */
const ZH_SUSPECTS: string[] = Array.from(
  new Set(
    Object.entries(zhTW)
      .filter(([k, v]) => v.length >= 3 && !v.includes('{') && /[一-鿿]/.test(v) && ja[k] !== v && !JA_VALUES.has(v) && !NAMES.some((n) => n.includes(v)))
      .map(([, v]) => v),
  ),
).sort((a, b) => b.length - a.length);

/** ja：頁面上的 zh-TW 字典文案（逐字）與繁體專用字 */
export function jaLeaks(text: string): string[] {
  const stripped = stripNames(text);
  const out: string[] = [];
  for (const v of ZH_SUSPECTS) if (stripped.includes(v)) out.push(`zh「${v.length > 40 ? `${v.slice(0, 40)}…` : v}」`);
  const chars = Array.from(new Set(stripped.match(TRAD_ONLY) ?? []));
  for (const c of chars) {
    const i = stripped.indexOf(c);
    out.push(`繁「${c}」…${stripped.slice(Math.max(0, i - 10), i + 10).replace(/\s+/g, ' ')}…`);
  }
  return out;
}
