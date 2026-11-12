/**
 * 情境流程圖（Scenario flow）宣告式定義。
 * 由 src/data/guideFlows.ts 提供各指引的流程，ScenarioFlow.tsx 負責以 SVG 泳道圖呈現。
 */

export type FlowNodeKind =
  | 'start' // 起點（圓角膠囊）
  | 'end' // 終點（圓角膠囊，深色）
  | 'action' // 使用者或 UI 動作（矩形）
  | 'system' // 伺服器／系統處理（矩形，次要色）
  | 'decision' // 判斷（菱形），通常有 2 條以上帶標籤的出邊
  | 'audit'; // 稽核／通知（平行四邊形或便箋樣式）

export type FlowTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

export interface FlowLane {
  id: string;
  /** 泳道名稱，例如 使用者、控制台 UI、授權伺服器、稽核 */
  label: string;
}

export interface FlowNode {
  id: string;
  /** 所屬泳道 id */
  lane: string;
  kind: FlowNodeKind;
  /** 節點文字（可含換行 \n，渲染器需支援 2–3 行） */
  label: string;
  /** 補充說明（tooltip 或下方小字） */
  note?: string;
  /** 對應頁面路由（例如 '/keys'），渲染器可做成可點擊連結 */
  route?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** 邊標籤，例如 允許 / 403 拒絕 / 待核准 */
  label?: string;
  tone?: FlowTone;
}

export interface ScenarioFlowDef {
  /** 對應指引 id（見 src/data/guides.ts） */
  id: string;
  title: string;
  /** 一句話說明此情境 */
  summary?: string;
  lanes: FlowLane[];
  /** 節點順序即時間順序（由左至右） */
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ---------- 多語鍵（見 src/i18n/README.md「流程圖」；字典區域 flows） ----------

/** 共用泳道（guideFlows.ts 的 LANES）的鍵 */
export function sharedLaneKey(laneId: string): string {
  return `flows.lane.${laneId}`;
}

/** 某流程自訂泳道的鍵 */
export function flowLaneKey(flowId: string, laneId: string): string {
  return `flows.${flowId}.lane.${laneId}`;
}

export function flowNodeKey(flowId: string, nodeId: string, field: 'label' | 'note'): string {
  return `flows.${flowId}.node.${nodeId}.${field}`;
}

/**
 * 每條邊的鍵：`flows.<flowId>.edge.<from>.<to>`；同一對 from/to 出現第 n 次（n ≥ 2）時加上 `.<n>`
 * （例如 billing 的 export-check → end 有「允許」與「403」兩條邊）。回傳陣列與 flow.edges 等長、同順序。
 */
export function flowEdgeKeys(flow: Pick<ScenarioFlowDef, 'id' | 'edges'>): string[] {
  const seen = new Map<string, number>();
  return flow.edges.map((e) => {
    const pair = `${e.from}.${e.to}`;
    const n = (seen.get(pair) ?? 0) + 1;
    seen.set(pair, n);
    return `flows.${flow.id}.edge.${pair}${n > 1 ? `.${n}` : ''}`;
  });
}
