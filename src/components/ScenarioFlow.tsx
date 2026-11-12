// 情境流程圖：SVG 泳道圖渲染器（無外部函式庫）
// 設計原則（dataviz）：節點以「形狀」區分種類、邊以「文字標籤」搭配色調（絕不只靠顏色）、
// 所有顏色皆使用 Fluent 語意 token（CSS 變數），自動跟隨淺色／深色／高對比主題。
import { makeStyles, tokens } from '@fluentui/react-components';
import { useId, useMemo } from 'react';
import { flowEdgeKeys, flowLaneKey, flowNodeKey, sharedLaneKey, type FlowNode, type FlowNodeKind, type FlowTone, type ScenarioFlowDef } from './scenarioFlowTypes';
import { tf, useT, zh, type TFunction } from '../i18n';

// ---------- 尺寸 ----------
interface Metrics {
  laneLabelW: number;
  laneH: number;
  nodeW: number;
  nodeH: number;
  decisionH: number;
  gap: number;
  padX: number;
  padY: number;
  font: number;
  lineH: number;
  edgeFont: number;
}
const FULL: Metrics = { laneLabelW: 110, laneH: 96, nodeW: 150, nodeH: 56, decisionH: 70, gap: 40, padX: 12, padY: 8, font: 13, lineH: 16, edgeFont: 11 };
const COMPACT: Metrics = { laneLabelW: 90, laneH: 80, nodeW: 128, nodeH: 50, decisionH: 60, gap: 32, padX: 10, padY: 6, font: 11, lineH: 14, edgeFont: 10 };

const KINDS: FlowNodeKind[] = ['start', 'end', 'action', 'system', 'decision', 'audit'];
/** zh-TW 標籤（相容既有匯入）；渲染時以 flows.ui.kind.<kind>／flows.ui.tone.<tone> 依目前語言翻譯 */
export const KIND_LABELS: Record<FlowNodeKind, string> = Object.fromEntries(KINDS.map((k) => [k, zh(`flows.ui.kind.${k}`)])) as Record<FlowNodeKind, string>;
export const TONE_LABELS: Record<FlowTone, string> = Object.fromEntries((['success', 'danger', 'warning', 'info', 'neutral'] as FlowTone[]).map((k) => [k, zh(`flows.ui.tone.${k}`)])) as Record<FlowTone, string>;
const TONE_COLOR: Record<FlowTone, string> = {
  success: tokens.colorPaletteGreenForeground1,
  danger: tokens.colorPaletteRedForeground1,
  warning: tokens.colorPaletteDarkOrangeForeground1,
  info: tokens.colorBrandForeground1,
  neutral: tokens.colorNeutralForeground3,
};
const TONES: FlowTone[] = ['success', 'danger', 'warning', 'info', 'neutral'];

const useStyles = makeStyles({
  figure: { margin: 0, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, minWidth: 0 },
  caption: { display: 'flex', flexDirection: 'column', rowGap: '2px' },
  title: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1, fontSize: tokens.fontSizeBase300 },
  summary: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  scroller: {
    overflowX: 'auto',
    overflowY: 'hidden',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  svg: { display: 'block', fontFamily: tokens.fontFamilyBase },
  link: { cursor: 'pointer', outline: 'none', '&:hover .sf-ring': { opacity: 0.5 }, '&:focus-visible .sf-ring': { opacity: 1 } },
  legend: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, listStyle: 'none', margin: 0, padding: 0 },
  legendItem: { display: 'inline-flex', alignItems: 'center', columnGap: '6px' },
  details: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  summaryEl: { cursor: 'pointer' },
  textList: { margin: `${tokens.spacingVerticalXS} 0 0`, paddingLeft: '1.5em', color: tokens.colorNeutralForeground1, lineHeight: tokens.lineHeightBase300 },
});

// ---------- 文字換行（CJK 每字 1 單位；ASCII 約 0.58 單位） ----------
function unitOf(ch: string): number {
  if (ch === ' ') return 0.35;
  return /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.58;
}
function widthUnits(s: string): number {
  let w = 0;
  for (const ch of s) w += unitOf(ch);
  return w;
}
export function wrapLabel(label: string, maxUnits: number, maxLines: number): string[] {
  const out: string[] = [];
  for (const para of label.split('\n')) {
    let cur = '';
    let w = 0;
    for (const ch of para) {
      const u = unitOf(ch);
      if (w + u > maxUnits && cur) {
        const sp = cur.lastIndexOf(' ');
        if (sp > 0 && /[A-Za-z0-9.]/.test(ch)) {
          out.push(cur.slice(0, sp));
          cur = cur.slice(sp + 1);
          w = widthUnits(cur);
        } else {
          out.push(cur);
          cur = '';
          w = 0;
        }
      }
      cur += ch;
      w += u;
    }
    if (cur) out.push(cur.trim());
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (widthUnits(last) > maxUnits - 1 && last.length > 1) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return out;
}

/**
 * 依目前語言取得流程的顯示文字（標題、摘要、泳道、節點標籤／說明、邊標籤）。
 * 鍵見 scenarioFlowTypes.ts；鍵不存在時保留定義中的 zh-TW 文字。結構（id、route、tone）不變。
 */
export function localizeFlow(t: TFunction, flow: ScenarioFlowDef): ScenarioFlowDef {
  const edgeKeys = flowEdgeKeys(flow);
  const laneLabel = (id: string, fallback: string) => {
    const own = flowLaneKey(flow.id, id);
    if (t.has(own)) return t(own);
    // 共用泳道：只有定義文字與共用泳道相同時才採用（避免自訂泳道誤用共用翻譯）
    const shared = sharedLaneKey(id);
    return t.has(shared) && zh(shared) === fallback ? t(shared) : fallback;
  };
  return {
    ...flow,
    title: tf(t, `flows.${flow.id}.title`, flow.title),
    summary: flow.summary === undefined ? undefined : tf(t, `flows.${flow.id}.summary`, flow.summary),
    lanes: flow.lanes.map((l) => ({ ...l, label: laneLabel(l.id, l.label) })),
    nodes: flow.nodes.map((n) => ({
      ...n,
      label: tf(t, flowNodeKey(flow.id, n.id, 'label'), n.label),
      note: n.note === undefined ? undefined : tf(t, flowNodeKey(flow.id, n.id, 'note'), n.note),
    })),
    edges: flow.edges.map((e, i) => (e.label === undefined ? e : { ...e, label: tf(t, edgeKeys[i], e.label) })),
  };
}

// ---------- 版面配置 ----------
interface Placed {
  node: FlowNode;
  col: number;
  laneIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Layout {
  placed: Map<string, Placed>;
  occupied: Set<string>;
  width: number;
  height: number;
}

/**
 * 欄位 = 所有「較早出現」前驅節點的最大欄位 + 1；沒有前驅則接在目前最右欄之後。
 * 因此同一個判斷節點的多個分支會自然落在同一欄（不同泳道），同泳道撞欄時往右推。
 */
export function layoutFlow(flow: ScenarioFlowDef, m: Metrics): Layout {
  const laneIdx = new Map(flow.lanes.map((l, i) => [l.id, i] as const));
  const order = new Map(flow.nodes.map((n, i) => [n.id, i] as const));
  const colOf = new Map<string, number>();
  const occupied = new Set<string>();
  const placed = new Map<string, Placed>();
  let maxCol = -1;
  flow.nodes.forEach((n, i) => {
    const preds = flow.edges.filter((e) => e.to === n.id && colOf.has(e.from) && (order.get(e.from) ?? Infinity) < i);
    let col = preds.length ? Math.max(...preds.map((e) => colOf.get(e.from)!)) + 1 : maxCol + 1;
    const li = laneIdx.get(n.lane) ?? 0;
    while (occupied.has(`${li}:${col}`)) col++;
    occupied.add(`${li}:${col}`);
    colOf.set(n.id, col);
    maxCol = Math.max(maxCol, col);
    const h = n.kind === 'decision' ? m.decisionH : m.nodeH;
    placed.set(n.id, {
      node: n,
      col,
      laneIdx: li,
      x: m.padX + m.laneLabelW + col * (m.nodeW + m.gap),
      y: m.padY + li * m.laneH + (m.laneH - h) / 2,
      w: m.nodeW,
      h,
    });
  });
  const cols = maxCol + 1;
  return {
    placed,
    occupied,
    width: m.padX * 2 + m.laneLabelW + cols * m.nodeW + Math.max(0, cols - 1) * m.gap,
    height: m.padY * 2 + Math.max(1, flow.lanes.length) * m.laneH,
  };
}

// ---------- 邊的路徑 ----------
interface Pt {
  x: number;
  y: number;
}
interface EdgeGeom {
  d: string;
  mid: Pt;
  back: boolean;
  straight: boolean;
}
const f = (n: number) => n.toFixed(1);
function roundedPolyline(pts: Pt[], r: number): string {
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const d1 = Math.hypot(c.x - p.x, c.y - p.y);
    const d2 = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = { x: c.x - ((c.x - p.x) / (d1 || 1)) * rr, y: c.y - ((c.y - p.y) / (d1 || 1)) * rr };
    const b = { x: c.x + ((n.x - c.x) / (d2 || 1)) * rr, y: c.y + ((n.y - c.y) / (d2 || 1)) * rr };
    d += ` L${f(a.x)},${f(a.y)} Q${f(c.x)},${f(c.y)} ${f(b.x)},${f(b.y)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${f(last.x)},${f(last.y)}`;
}
function cubic(p1: Pt, c1: Pt, c2: Pt, p2: Pt): { d: string; mid: Pt } {
  return {
    d: `M${f(p1.x)},${f(p1.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`,
    mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 },
  };
}

function edgeGeometry(s: Placed, t: Placed, m: Metrics, occupied: Set<string>): EdgeGeom {
  if (t.col > s.col) {
    const p1 = { x: s.x + s.w, y: s.y + s.h / 2 };
    const p2 = { x: t.x, y: t.y + t.h / 2 };
    if (Math.abs(p1.y - p2.y) < 1) {
      return { d: `M${f(p1.x)},${f(p1.y)} L${f(p2.x)},${f(p2.y)}`, mid: { x: (p1.x + p2.x) / 2, y: p1.y }, back: false, straight: true };
    }
    if (t.col - s.col === 1) {
      const mx = (p1.x + p2.x) / 2;
      return { ...cubic(p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2), back: false, straight: false };
    }
    // 跨多欄且換泳道：正交連線。優先沿「來源泳道」水平前進、在目標前一個間隙轉彎；若會穿過節點則改在來源後的間隙先轉彎。
    const between = (lane: number) => {
      for (let c = s.col + 1; c < t.col; c++) if (occupied.has(`${lane}:${c}`)) return true;
      return false;
    };
    const vx = between(s.laneIdx) ? p1.x + m.gap / 2 : p2.x - m.gap / 2;
    const pts = [p1, { x: vx, y: p1.y }, { x: vx, y: p2.y }, p2];
    const longOnSource = vx - p1.x >= p2.x - vx;
    const mid = longOnSource ? { x: (p1.x + vx) / 2, y: p1.y } : { x: (vx + p2.x) / 2, y: p2.y };
    return { d: roundedPolyline(pts, 8), mid, back: false, straight: true };
  }
  // 回邊（指向較早的欄）：由來源左側繞回目標右側，虛線表示
  const p1 = { x: s.x, y: s.y + s.h / 2 };
  const p2 = { x: t.x + t.w, y: t.y + t.h / 2 };
  const bulge = s.laneIdx === t.laneIdx ? m.laneH * 0.42 : 0;
  return { ...cubic(p1, { x: p1.x - m.gap, y: p1.y + bulge }, { x: p2.x + m.gap, y: p2.y + bulge }, p2), back: true, straight: false };
}

// ---------- 節點形狀 ----------
function NodeShape({ p }: { p: Placed }) {
  const { x, y, w, h } = p;
  const base = { fill: tokens.colorNeutralBackground1, stroke: tokens.colorNeutralStroke1, strokeWidth: 1.25 };
  switch (p.node.kind) {
    case 'start':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} style={{ fill: tokens.colorBrandBackground2, stroke: tokens.colorBrandStroke1, strokeWidth: 1.25 }} />;
    case 'end':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} style={{ fill: tokens.colorNeutralBackgroundInverted, stroke: tokens.colorNeutralBackgroundInverted, strokeWidth: 1.25 }} />;
    case 'system':
      return <rect x={x} y={y} width={w} height={h} rx={6} strokeDasharray="5 3" style={{ ...base, fill: tokens.colorNeutralBackground3 }} />;
    case 'decision': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return <polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} strokeLinejoin="round" style={{ ...base, fill: tokens.colorNeutralBackground2, stroke: tokens.colorBrandStroke1, strokeWidth: 1.5 }} />;
    }
    case 'audit': {
      const c = 12; // 折角大小
      return (
        <g>
          <path d={`M${x},${y} H${x + w - c} L${x + w},${y + c} V${y + h} H${x} Z`} style={{ ...base, fill: tokens.colorNeutralBackground4 }} />
          <path d={`M${x + w - c},${y} V${y + c} H${x + w}`} style={{ fill: tokens.colorNeutralBackground2, stroke: tokens.colorNeutralStroke1, strokeWidth: 1 }} />
        </g>
      );
    }
    default:
      return <rect x={x} y={y} width={w} height={h} rx={6} style={base} />;
  }
}

function NodeText({ p, m, latin }: { p: Placed; m: Metrics; latin: number }) {
  const isDecision = p.node.kind === 'decision';
  const maxUnits = ((isDecision ? p.w * 0.62 : p.w - 16) / m.font) * 1.02 * latin;
  const lines = wrapLabel(p.node.label, maxUnits, 3);
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const startY = cy - ((lines.length - 1) * m.lineH) / 2;
  const fill = p.node.kind === 'end' ? tokens.colorNeutralForegroundInverted : tokens.colorNeutralForeground1;
  return (
    <text x={cx} y={startY} fontSize={m.font} textAnchor="middle" dominantBaseline="central" style={{ fill, fontWeight: p.node.kind === 'decision' || p.node.kind === 'start' ? 600 : 400 }} aria-hidden>
      {lines.map((ln, i) => (
        <tspan key={i} x={cx} y={startY + i * m.lineH}>
          {ln}
        </tspan>
      ))}
    </text>
  );
}

// ---------- 主元件 ----------
export function ScenarioFlow({ flow: def, compact }: { flow: ScenarioFlowDef; compact?: boolean }) {
  const s = useStyles();
  const t = useT();
  const flow = useMemo(() => localizeFlow(t, def), [t, def]);
  // 英文字母實際寬度比 wrapLabel 的保守估計窄：英文介面放寬每行寬度（zh-TW／ja 維持原值）
  const latin = t.locale === 'en' ? 1.15 : 1;
  const m = compact ? COMPACT : FULL;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const layout = useMemo(() => layoutFlow(flow, m), [flow, m]);
  const laneById = useMemo(() => new Map(flow.lanes.map((l) => [l.id, l])), [flow.lanes]);
  const nodeById = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow.nodes]);
  const usedTones = useMemo(() => TONES.filter((tone) => flow.edges.some((e) => (e.tone ?? 'neutral') === tone)), [flow.edges]);
  const usedKinds = useMemo(() => KINDS.filter((k) => flow.nodes.some((n) => n.kind === k)), [flow.nodes]);
  const kindLabel = (k: FlowNodeKind) => t(`flows.ui.kind.${k}`);
  const markerId = (tone: FlowTone) => `sf-${uid}-arrow-${tone}`;
  const ariaBase = t('flows.ui.ariaLabel', { title: flow.title, lanes: flow.lanes.length, steps: flow.nodes.length });
  const ariaLabel = flow.summary ? t('flows.ui.ariaLabelSummary', { base: ariaBase, summary: flow.summary }) : ariaBase;
  // 在狹窄容器中最多縮至 80%（字體仍可讀），再窄則改以水平捲動
  const minWidth = Math.min(layout.width, Math.max(compact ? 480 : 640, layout.width * 0.8));

  return (
    <figure className={s.figure}>
      <figcaption className={s.caption}>
        <span className={s.title}>{flow.title}</span>
        {flow.summary && <span className={s.summary}>{flow.summary}</span>}
      </figcaption>
      <div className={s.scroller}>
        <svg className={s.svg} viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" style={{ maxWidth: layout.width, minWidth }} preserveAspectRatio="xMinYMin meet" role="img" aria-label={ariaLabel}>
          <defs>
            {TONES.map((t) => (
              <marker key={t} id={markerId(t)} viewBox="0 0 8 8" markerWidth={8} markerHeight={8} refX={7} refY={4} orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L8,4 L0,8 Z" style={{ fill: TONE_COLOR[t] }} />
              </marker>
            ))}
          </defs>
          {/* 泳道背景與標題 */}
          {flow.lanes.map((lane, i) => {
            const y = m.padY + i * m.laneH;
            const lines = wrapLabel(lane.label, ((m.laneLabelW - 20) / m.font) * latin, 3);
            const ty = y + m.laneH / 2 - ((lines.length - 1) * m.lineH) / 2;
            return (
              <g key={lane.id}>
                <rect x={0} y={y} width={layout.width} height={m.laneH} style={{ fill: i % 2 === 0 ? tokens.colorNeutralBackground1 : tokens.colorNeutralBackground2 }} />
                <rect x={0} y={y} width={m.padX + m.laneLabelW} height={m.laneH} style={{ fill: tokens.colorNeutralBackground3 }} />
                <line x1={0} x2={layout.width} y1={y + m.laneH} y2={y + m.laneH} style={{ stroke: tokens.colorNeutralStroke2, strokeWidth: 1 }} />
                <text x={m.padX} y={ty} fontSize={m.font} dominantBaseline="central" style={{ fill: tokens.colorNeutralForeground2, fontWeight: 600 }}>
                  {lines.map((ln, k) => (
                    <tspan key={k} x={m.padX} y={ty + k * m.lineH}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
          <line x1={m.padX + m.laneLabelW} x2={m.padX + m.laneLabelW} y1={0} y2={layout.height} style={{ stroke: tokens.colorNeutralStroke1, strokeWidth: 1 }} />
          {/* 邊 */}
          {flow.edges.map((e, i) => {
            const sp = layout.placed.get(e.from);
            const tp = layout.placed.get(e.to);
            if (!sp || !tp) return null;
            const tone: FlowTone = e.tone ?? 'neutral';
            const color = TONE_COLOR[tone];
            const g = edgeGeometry(sp, tp, m, layout.occupied);
            const chipW = e.label ? widthUnits(e.label) * m.edgeFont + 12 : 0;
            const chipH = m.edgeFont + 7;
            const lx = g.mid.x;
            const ly = g.straight ? g.mid.y - chipH / 2 - 3 : g.mid.y;
            return (
              <g key={`${e.from}-${e.to}-${i}`}>
                <path d={g.d} fill="none" strokeWidth={1.5} strokeDasharray={g.back ? '5 4' : undefined} markerEnd={`url(#${markerId(tone)})`} style={{ stroke: color }} />
                {e.label && (
                  <g transform={`translate(${f(lx)},${f(ly)})`} aria-hidden>
                    <rect x={-chipW / 2} y={-chipH / 2} width={chipW} height={chipH} rx={chipH / 2} style={{ fill: tokens.colorNeutralBackground1, stroke: color, strokeWidth: 1 }} />
                    <text x={0} y={0.5} fontSize={m.edgeFont} textAnchor="middle" dominantBaseline="central" style={{ fill: color, fontWeight: 600 }}>
                      {e.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {/* 節點 */}
          {flow.nodes.map((n) => {
            const p = layout.placed.get(n.id);
            if (!p) return null;
            const body = (
              <g data-node-id={n.id} data-kind={n.kind}>
                {n.note && <title>{n.note}</title>}
                {n.route && <rect className="sf-ring" x={p.x - 3} y={p.y - 3} width={p.w + 6} height={p.h + 6} rx={n.kind === 'start' || n.kind === 'end' ? (p.h + 6) / 2 : 9} style={{ fill: 'none', stroke: tokens.colorStrokeFocus2, strokeWidth: 2, opacity: 0, pointerEvents: 'none' }} />}
                <NodeShape p={p} />
                <NodeText p={p} m={m} latin={latin} />
              </g>
            );
            return n.route ? (
              <a key={n.id} href={`#${n.route}`} className={s.link} aria-label={t('flows.ui.nodeLink', { label: n.label.replace(/\n/g, ' ') })}>
                {body}
              </a>
            ) : (
              <g key={n.id}>{body}</g>
            );
          })}
        </svg>
      </div>
      {/* 圖例：節點種類與邊的色調（皆附文字） */}
      <ul className={s.legend} aria-label={t('flows.ui.legend')}>
        {usedKinds.map((k) => (
          <li key={k} className={s.legendItem}>
            <LegendGlyph kind={k} />
            {kindLabel(k)}
          </li>
        ))}
        {usedTones.map((tone) => (
          <li key={tone} className={s.legendItem}>
            <svg width={22} height={10} aria-hidden>
              <line x1={0} x2={16} y1={5} y2={5} strokeWidth={2} style={{ stroke: TONE_COLOR[tone] }} />
              <path d="M15,1 L21,5 L15,9 Z" style={{ fill: TONE_COLOR[tone] }} />
            </svg>
            {t(`flows.ui.tone.${tone}`)}
          </li>
        ))}
      </ul>
      <details className={s.details}>
        <summary className={s.summaryEl}>{t('flows.ui.textView')}</summary>
        <ol className={s.textList}>
          {flow.nodes.map((n) => {
            const outs = flow.edges.filter((e) => e.from === n.id);
            return (
              <li key={n.id}>
                {t('flows.ui.text.lane', { lane: laneById.get(n.lane)?.label ?? n.lane })}
                {n.label.replace(/\n/g, ' ')}
                {t('flows.ui.text.kind', { kind: kindLabel(n.kind) })}
                {n.note ? t('flows.ui.text.note', { note: n.note }) : ''}
                {outs.length > 0 && (
                  <>
                    {' '}→{' '}
                    {outs.map((e) => `${e.label ? t('flows.ui.text.edgeLabel', { label: e.label }) : ''}${(nodeById.get(e.to)?.label ?? e.to).replace(/\n/g, ' ')}`).join(t('flows.ui.text.sep'))}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </details>
    </figure>
  );
}

function LegendGlyph({ kind }: { kind: FlowNodeKind }) {
  const common = { strokeWidth: 1.25, stroke: tokens.colorNeutralStroke1 };
  let shape: JSX.Element;
  switch (kind) {
    case 'start':
      shape = <rect x={1} y={1} width={20} height={10} rx={5} style={{ ...common, fill: tokens.colorBrandBackground2, stroke: tokens.colorBrandStroke1 }} />;
      break;
    case 'end':
      shape = <rect x={1} y={1} width={20} height={10} rx={5} style={{ fill: tokens.colorNeutralBackgroundInverted }} />;
      break;
    case 'system':
      shape = <rect x={1} y={1} width={20} height={10} rx={2} strokeDasharray="3 2" style={{ ...common, fill: tokens.colorNeutralBackground3 }} />;
      break;
    case 'decision':
      shape = <polygon points="11,0.5 21.5,6 11,11.5 0.5,6" style={{ ...common, fill: tokens.colorNeutralBackground2, stroke: tokens.colorBrandStroke1 }} />;
      break;
    case 'audit':
      shape = <path d="M1,1 H17 L21,5 V11 H1 Z" style={{ ...common, fill: tokens.colorNeutralBackground4 }} />;
      break;
    default:
      shape = <rect x={1} y={1} width={20} height={10} rx={2} style={{ ...common, fill: tokens.colorNeutralBackground1 }} />;
  }
  return (
    <svg width={22} height={12} aria-hidden>
      {shape}
    </svg>
  );
}

