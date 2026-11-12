// 輕量 SVG 圖表（遵循 dataviz 規範：細標記、2px 表面間隙、≥2 系列必有圖例、文字使用文字色票）
import { Text, makeStyles, tokens } from '@fluentui/react-components';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useThemeMode } from '../../theme/ThemeProvider';
import { formatCompact, seriesColor } from '../../theme/chartPalette';
import { useLocale, useT } from '../../i18n';

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    minWidth: 0,
  },
  titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', columnGap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  title: { fontWeight: tokens.fontWeightSemibold },
  subtitle: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  legend: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXS, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  legendItem: { display: 'inline-flex', alignItems: 'center', columnGap: '6px' },
  swatch: { width: '10px', height: '10px', borderRadius: '2px', display: 'inline-block' },
  svgWrap: { position: 'relative', width: '100%' },
  tooltip: {
    position: 'absolute',
    pointerEvents: 'none',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow8,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    fontSize: tokens.fontSizeBase200,
    zIndex: 5,
    whiteSpace: 'nowrap',
  },
  tile: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
    minWidth: 0,
  },
  tileLabel: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  tileValue: { fontSize: tokens.fontSizeHero800, fontWeight: tokens.fontWeightSemibold, lineHeight: tokens.lineHeightHero800 },
  tileDelta: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200, marginTop: tokens.spacingVerticalS },
  th: { textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, color: tokens.colorNeutralForeground2, fontWeight: tokens.fontWeightSemibold },
  td: { padding: '4px 8px', borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, fontVariantNumeric: 'tabular-nums' },
  details: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, cursor: 'pointer' },
});

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    setW(el.clientWidth || 600);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(200, e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: w };
}

const GRID = tokens.colorNeutralStroke2;
const AXIS_TEXT = tokens.colorNeutralForeground3;

export function ChartCard({ title, subtitle, legend, children, table }: { title: string; subtitle?: string; legend?: ReactNode; children: ReactNode; table?: ReactNode }) {
  const s = useStyles();
  const t = useT();
  return (
    <section className={s.card} aria-label={title}>
      <div className={s.titleRow}>
        <Text className={s.title} as="h3">
          {title}
        </Text>
        {subtitle && <span className={s.subtitle}>{subtitle}</span>}
      </div>
      {legend}
      {children}
      {table && (
        <details>
          <summary className={s.details}>{t('billing.charts.tableView')}</summary>
          {table}
        </details>
      )}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  const s = useStyles();
  const t = useT();
  if (items.length < 2) return null;
  return (
    <ul className={s.legend} aria-label={t('billing.charts.legend')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((it) => (
        <li key={it.label} className={s.legendItem}>
          <span className={s.swatch} style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  const s = useStyles();
  const L = useLocale();
  return (
    <table className={s.table}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} className={s.th} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={s.td}>
                {typeof c === 'number' ? L.fmtNumber(c) : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- 統計磚 ----------
export function StatTile({ label, value, delta, trend, hint }: { label: string; value: string; delta?: string; trend?: number[]; hint?: string }) {
  const s = useStyles();
  const t = useT();
  const { isDark } = useThemeMode();
  const path = useMemo(() => {
    if (!trend || trend.length < 2) return null;
    const max = Math.max(...trend, 1);
    const min = Math.min(...trend);
    const w = 96;
    const h = 28;
    return trend
      .map((v, i) => {
        const x = (i / (trend.length - 1)) * w;
        const y = h - ((v - min) / Math.max(1, max - min)) * (h - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [trend]);
  return (
    <div className={s.tile} role="group" aria-label={t('billing.charts.tileAria', { label, value })}>
      <span className={s.tileLabel}>{label}</span>
      <span className={s.tileValue}>{value}</span>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', columnGap: 8 }}>
        <span className={s.tileDelta}>{delta ?? hint ?? ''}</span>
        {path && (
          <svg width={96} height={28} aria-hidden>
            <path d={path} fill="none" stroke={seriesColor(0, isDark)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

// ---------- 堆疊長條（每日 × 系列） ----------
export interface StackedDatum {
  label: string;
  values: number[];
}
export function StackedBarChart({ data, series, colors, height = 220, valueFormat = formatCompact }: { data: StackedDatum[]; series: string[]; colors: string[]; height?: number; valueFormat?: (n: number) => string }) {
  const s = useStyles();
  const t = useT();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const pad = { l: 44, r: 8, t: 8, b: 24 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  const niceMax = niceCeil(max);
  const slot = iw / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(4, slot - 4));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 56)));
  return (
    <div ref={ref} className={s.svgWrap}>
      <svg width={width} height={height} role="img" aria-label={t('billing.charts.stackedBar')}>
        {ticks.map((t) => {
          const y = pad.t + ih - (t / niceMax) * ih;
          return (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y + 4} fontSize={11} textAnchor="end" fill={AXIS_TEXT}>
                {formatCompact(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          let acc = 0;
          return (
            <g
              key={d.label}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({
                  x: e.clientX - rect.left + 12,
                  y: e.clientY - rect.top - 8,
                  content: (
                    <div>
                      <strong>{d.label}</strong>
                      {series.map((sName, k) => (
                        <div key={sName}>
                          <span className={s.swatch} style={{ backgroundColor: colors[k], marginRight: 6 }} aria-hidden />
                          {sName}: {valueFormat(d.values[k])}
                        </div>
                      ))}
                      <div>{t('billing.charts.total', { value: valueFormat(totals[i]) })}</div>
                    </div>
                  ),
                });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
              {d.values.map((v, k) => {
                const h = (v / niceMax) * ih;
                const y = pad.t + ih - acc - h;
                acc += h;
                const isTop = k === d.values.length - 1 || d.values.slice(k + 1).every((z) => z === 0);
                return v > 0 ? (
                  <rect key={k} x={x} y={y + (isTop ? 0 : 1)} width={barW} height={Math.max(0, h - (isTop ? 0 : 2))} fill={colors[k]} rx={isTop ? 3 : 0} />
                ) : null;
              })}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 6} fontSize={11} textAnchor="middle" fill={AXIS_TEXT}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke={tokens.colorNeutralStroke1} />
      </svg>
      {tip && (
        <div className={s.tooltip} style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.content}
        </div>
      )}
    </div>
  );
}

// ---------- 水平長條（排名） ----------
export function HBarChart({ data, color, valueFormat = formatCompact, rowHeight = 28 }: { data: { label: string; value: number }[]; color: string; valueFormat?: (n: number) => string; rowHeight?: number }) {
  const s = useStyles();
  const t = useT();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const labelW = Math.min(180, Math.max(100, width * 0.3));
  const valueW = 80;
  const iw = Math.max(40, width - labelW - valueW - 8);
  const max = Math.max(1, ...data.map((d) => d.value));
  const height = data.length * rowHeight + 8;
  return (
    <div ref={ref} className={s.svgWrap}>
      <svg width={width} height={height} role="img" aria-label={t('billing.charts.hBar')}>
        {data.map((d, i) => {
          const y = 4 + i * rowHeight;
          const w = (d.value / max) * iw;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={y} width={width} height={rowHeight} fill={hover === i ? tokens.colorNeutralBackground1Hover : 'transparent'} />
              <text x={labelW - 8} y={y + rowHeight / 2 + 4} fontSize={12} textAnchor="end" fill={tokens.colorNeutralForeground2}>
                {d.label.length > 22 ? `${d.label.slice(0, 21)}…` : d.label}
              </text>
              <rect x={labelW} y={y + (rowHeight - 16) / 2} width={Math.max(2, w)} height={16} fill={color} rx={3} />
              <text x={labelW + w + 6} y={y + rowHeight / 2 + 4} fontSize={12} fill={tokens.colorNeutralForeground1} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {valueFormat(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- 折線（時間序列，單系列或多系列） ----------
export function LineChart({ data, series, colors, height = 200, valueFormat = formatCompact }: { data: { label: string; values: number[] }[]; series: string[]; colors: string[]; height?: number; valueFormat?: (n: number) => string }) {
  const s = useStyles();
  const t = useT();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: 8, b: 24 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const niceMax = niceCeil(max);
  const xOf = (i: number) => pad.l + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const yOf = (v: number) => pad.t + ih - (v / niceMax) * ih;
  const ticks = [0, 0.5, 1].map((f) => f * niceMax);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 56)));
  useEffect(() => setHover(null), [data]);
  return (
    <div ref={ref} className={s.svgWrap}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t('billing.charts.line')}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.round(((x - pad.l) / Math.max(1, iw)) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, idx)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={yOf(t)} y2={yOf(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={yOf(t) + 4} fontSize={11} textAnchor="end" fill={AXIS_TEXT}>
              {formatCompact(t)}
            </text>
          </g>
        ))}
        {series.map((_, k) => {
          const d = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p.values[k]).toFixed(1)}`).join(' ');
          const area = `${d} L${xOf(data.length - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${xOf(0).toFixed(1)},${(pad.t + ih).toFixed(1)} Z`;
          return (
            <g key={k}>
              {series.length === 1 && <path d={area} fill={colors[k]} opacity={0.1} />}
              <path d={d} fill="none" stroke={colors[k]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {data.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.label} x={xOf(i)} y={height - 6} fontSize={11} textAnchor="middle" fill={AXIS_TEXT}>
              {p.label}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <g>
            <line x1={xOf(hover)} x2={xOf(hover)} y1={pad.t} y2={pad.t + ih} stroke={tokens.colorNeutralStroke1} strokeWidth={1} />
            {series.map((_, k) => (
              <circle key={k} cx={xOf(hover)} cy={yOf(data[hover].values[k])} r={4} fill={colors[k]} stroke={tokens.colorNeutralBackground1} strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className={s.tooltip} style={{ left: Math.min(xOf(hover) + 12, width - 160), top: 8 }} role="tooltip">
          <strong>{data[hover].label}</strong>
          {series.map((name, k) => (
            <div key={name}>
              {series.length > 1 && <span className={s.swatch} style={{ backgroundColor: colors[k], marginRight: 6 }} aria-hidden />}
              {name}: {valueFormat(data[hover].values[k])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * p;
}
