import { Badge, Tooltip } from '@fluentui/react-components';
import { LICENSE_OBLIGATION_KEYS, type ModelInfo } from '../data/models';
import { zh } from '../i18n/core';
import { tf, useT } from '../i18n';

/**
 * 模型授權義務（例如 Llama 社群授權要求標示「Built with Llama」、Gemma 使用條款的禁止用途政策）。
 * 資料層提供 `licenseObligations: string[]`（每筆一句 zh-TW 義務）與同序的 `licenseObligationKeys`（data.obligation.<group>.<n>）；
 * 欄位不存在時依授權名稱推導常見義務。UI 以目前語言顯示（tf(t, key, zh 文字)）。
 */
type WithObligations = ModelInfo & { licenseObligations?: readonly string[] | null; licenseObligationKeys?: readonly string[] | null };

export interface Obligation {
  /** 簡短徽章文字（zh-TW；表格用，也作為去重與 React key） */
  label: string;
  /** 完整義務說明（zh-TW；tooltip／詳情面板用） */
  detail: string;
  /** label 的字典鍵（data.ui.obligation.short.<slug>） */
  labelKey?: string;
  /** detail 的字典鍵（data.obligation.<group>.<n> 或 data.ui.obligation.fallback.<slug>） */
  detailKey?: string;
}

const SHORT = (slug: string) => `data.ui.obligation.short.${slug}`;

/** 義務句子的字典鍵 → 簡短徽章 slug（data.ui.obligation.short.<slug>） */
const SHORT_BY_KEY: Record<string, string> = {
  'data.obligation.llama.1': 'builtWithLlama',
  'data.obligation.llama.2': 'llamaNaming',
  'data.obligation.llama.3': 'llamaAup',
  'data.obligation.llama.4': 'llamaMau',
  'data.obligation.gemma.1': 'gemmaPup',
  'data.obligation.gemma.2': 'googleRemote',
  'data.obligation.gemma.3': 'derivedSame',
  'data.obligation.taide.1': 'taideTerms',
  'data.obligation.taide.2': 'builtWithLlama',
  'data.obligation.apache.1': 'apacheNotice',
  'data.obligation.apache.2': 'trademark',
  'data.obligation.qwenMax.1': 'commercialLicense',
  'data.obligation.platform.1': 'apacheNotice',
  'data.obligation.platform.2': 'publicSector',
};

/** 依授權名稱推導（資料層未提供義務時） */
const FALLBACK: { match: RegExp; slug: string }[] = [
  { match: /llama|taide/i, slug: 'builtWithLlama' },
  { match: /gemma/i, slug: 'gemmaPup' },
];

const ALL_OBLIGATION_KEYS: string[] = Object.values(LICENSE_OBLIGATION_KEYS).flat();

/** zh-TW 句子 → 字典鍵（句子沒有附鍵時以 zh-TW 字典反查） */
function keyOfSentence(sentence: string): string | undefined {
  return ALL_OBLIGATION_KEYS.find((k) => zh(k) === sentence);
}

function toObligation(detail: string, detailKey: string | undefined): Obligation {
  const key = detailKey ?? keyOfSentence(detail);
  const slug = key ? SHORT_BY_KEY[key] : undefined;
  if (slug) return { label: zh(SHORT(slug)), labelKey: SHORT(slug), detail, detailKey: key };
  const first = detail.split(/[；;。]/)[0];
  return { label: first.length > 14 ? `${first.slice(0, 14)}…` : first, detail, detailKey: key };
}

export function licenseObligations(m: ModelInfo): Obligation[] {
  const w = m as WithObligations;
  const explicit = w.licenseObligations;
  if (Array.isArray(explicit) && explicit.length) {
    const keys = Array.isArray(w.licenseObligationKeys) ? w.licenseObligationKeys : [];
    const seen = new Set<string>();
    return explicit
      .map((detail, i) => ({ detail: detail as unknown, key: keys[i] as string | undefined }))
      .filter((x): x is { detail: string; key: string | undefined } => typeof x.detail === 'string' && x.detail.trim().length > 0)
      .map((x) => toObligation(x.detail, x.key))
      .filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true)));
  }
  const hay = `${m.license ?? ''} ${m.family} ${m.id}`;
  return FALLBACK.filter((k) => k.match.test(hay)).map((k) => {
    const detailKey = `data.ui.obligation.fallback.${k.slug}`;
    return { label: zh(SHORT(k.slug)), labelKey: SHORT(k.slug), detail: zh(detailKey), detailKey };
  });
}

/** 表格用：最多顯示 max 個徽章，其餘以「+n」摘要；每個徽章 tooltip 顯示完整義務 */
export function LicenseObligationBadges({ model, size = 'small', max = 2, compact = false }: { model: ModelInfo; size?: 'tiny' | 'extra-small' | 'small' | 'medium'; max?: number; compact?: boolean }) {
  const t = useT();
  const items = licenseObligations(model);
  if (items.length === 0) return null;
  const label = (o: Obligation) => (o.labelKey ? tf(t, o.labelKey, o.label) : o.label);
  const detail = (o: Obligation) => (o.detailKey ? tf(t, o.detailKey, o.detail) : o.detail);
  // 窄欄（表格）用：只顯示一個「授權義務 ×n」徽章，完整內容放 tooltip 與詳情面板，避免徽章在窄欄內逐字換行重疊
  if (compact) {
    return (
      <Tooltip content={<ul style={{ margin: 0, paddingLeft: 16 }}>{items.map((o) => <li key={o.label}>{detail(o)}</li>)}</ul>} relationship="description">
        <Badge appearance="outline" color="warning" size={size} tabIndex={0} aria-label={t('data.ui.obligation.ariaSummary', { n: items.length, labels: items.map(label).join(t('data.ui.listSep')) })} style={{ whiteSpace: 'nowrap' }} data-tour="license-obligations">
          {t('data.ui.obligation.badgeCount', { n: items.length })}
        </Badge>
      </Tooltip>
    );
  }
  const shown = items.slice(0, max);
  const rest = items.slice(max);
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }} data-tour="license-obligations" role="list" aria-label={t('data.ui.obligation.listAria')}>
      {shown.map((o) => (
        <Tooltip key={o.label} content={detail(o)} relationship="description">
          <Badge appearance="outline" color="warning" size={size} tabIndex={0} role="listitem" aria-label={t('data.ui.obligation.itemAria', { detail: detail(o) })} style={{ whiteSpace: 'nowrap' }}>
            {label(o)}
          </Badge>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip content={rest.map(detail).join(t('data.ui.sentenceSep'))} relationship="description">
          <Badge appearance="outline" color="warning" size={size} tabIndex={0} role="listitem" aria-label={t('data.ui.obligation.moreAria', { n: rest.length })} style={{ whiteSpace: 'nowrap' }}>
            +{rest.length}
          </Badge>
        </Tooltip>
      )}
    </span>
  );
}

/** 詳情／Playground 用：完整義務清單 */
export function LicenseObligationList({ model }: { model: ModelInfo }) {
  const t = useT();
  const items = licenseObligations(model);
  if (items.length === 0) return null;
  return (
    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} data-tour="license-obligation-list">
      {items.map((o) => (
        <li key={o.label}>{o.detailKey ? tf(t, o.detailKey, o.detail) : o.detail}</li>
      ))}
    </ul>
  );
}
