// @vitest-environment jsdom
// 情境流程圖：資料完整性 + 每個流程都能在 ThemeProvider 內渲染為 SVG，且節點／邊標籤皆出現
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { ScenarioFlow, layoutFlow, wrapLabel } from '../ScenarioFlow';
import { GUIDE_FLOWS, getGuideFlow } from '../../data/guideFlows';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, media: '', dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <React.StrictMode>
        <ThemeProvider>{ui}</ThemeProvider>
      </React.StrictMode>,
    );
  });
  return container!;
}

const EXPECTED_IDS = ['welcome', 'register-cluster', 'deploy-model', 'onboard-tenant', 'create-key-playground', 'connect-provider-bailian', 'routing-spillover', 'assign-role-approval', 'billing', 'denied-request-access', 'hub-first-call', 'trial-request'];
const flows = Object.values(GUIDE_FLOWS);

describe('guideFlows 資料完整性', () => {
  it('包含所有預期的指引 id，且 getGuideFlow 可取得', () => {
    for (const id of EXPECTED_IDS) {
      expect(GUIDE_FLOWS[id], id).toBeDefined();
      expect(GUIDE_FLOWS[id].id).toBe(id);
      expect(getGuideFlow(id)).toBe(GUIDE_FLOWS[id]);
    }
    expect(getGuideFlow('nope')).toBeUndefined();
  });

  it('每則操作指引都有對應的流程圖', async () => {
    const { GUIDES } = await import('../../data/guides');
    for (const g of GUIDES) expect(GUIDE_FLOWS[g.id], `guide ${g.id} 缺流程圖`).toBeDefined();
    expect(GUIDES.length).toBe(12);
  });

  for (const flow of flows) {
    describe(flow.id, () => {
      const nodeIds = new Set(flow.nodes.map((n) => n.id));
      const laneIds = new Set(flow.lanes.map((l) => l.id));

      it('節點 id 唯一、泳道 id 唯一，數量在 7–12、泳道 3–5', () => {
        expect(nodeIds.size).toBe(flow.nodes.length);
        expect(laneIds.size).toBe(flow.lanes.length);
        expect(flow.nodes.length).toBeGreaterThanOrEqual(7);
        expect(flow.nodes.length).toBeLessThanOrEqual(12);
        expect(flow.lanes.length).toBeGreaterThanOrEqual(3);
        expect(flow.lanes.length).toBeLessThanOrEqual(5);
      });

      it('所有 edge.from/to 指向存在的節點、node.lane 指向存在的泳道', () => {
        for (const e of flow.edges) {
          expect(nodeIds.has(e.from), `edge.from ${e.from}`).toBe(true);
          expect(nodeIds.has(e.to), `edge.to ${e.to}`).toBe(true);
          expect(e.from).not.toBe(e.to);
        }
        for (const n of flow.nodes) expect(laneIds.has(n.lane), `node ${n.id} lane ${n.lane}`).toBe(true);
      });

      it('每個節點皆連通；至少一個帶標籤分支的判斷節點與一個稽核節點；有起點與終點', () => {
        for (const n of flow.nodes) {
          expect(flow.edges.some((e) => e.from === n.id || e.to === n.id), `node ${n.id} 未連接`).toBe(true);
        }
        const decisions = flow.nodes.filter((n) => n.kind === 'decision');
        expect(decisions.length).toBeGreaterThanOrEqual(1);
        for (const d of decisions) {
          const outs = flow.edges.filter((e) => e.from === d.id);
          expect(outs.length, `decision ${d.id} 需 ≥2 條出邊`).toBeGreaterThanOrEqual(2);
          for (const o of outs) expect(o.label, `decision ${d.id} → ${o.to} 缺標籤`).toBeTruthy();
        }
        expect(flow.nodes.some((n) => n.kind === 'audit')).toBe(true);
        expect(flow.nodes.some((n) => n.kind === 'start')).toBe(true);
        expect(flow.nodes.some((n) => n.kind === 'end')).toBe(true);
        for (const n of flow.nodes) if (n.route) expect(n.route.startsWith('/')).toBe(true);
      });

      it('版面：每個節點有唯一（泳道, 欄）位置，前向邊皆由左至右', () => {
        const layout = layoutFlow(flow, { laneLabelW: 110, laneH: 96, nodeW: 150, nodeH: 56, decisionH: 70, gap: 40, padX: 12, padY: 8, font: 13, lineH: 16, edgeFont: 11 });
        const slots = new Set<string>();
        for (const n of flow.nodes) {
          const p = layout.placed.get(n.id)!;
          expect(p).toBeDefined();
          const key = `${p.laneIdx}:${p.col}`;
          expect(slots.has(key), `重疊 ${key}`).toBe(false);
          slots.add(key);
        }
        const order = new Map(flow.nodes.map((n, i) => [n.id, i]));
        for (const e of flow.edges) {
          if (order.get(e.from)! < order.get(e.to)!) {
            expect(layout.placed.get(e.to)!.col, `${e.from}→${e.to}`).toBeGreaterThan(layout.placed.get(e.from)!.col);
          }
        }
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBe(16 + flow.lanes.length * 96);
      });
    });
  }
});

describe('ScenarioFlow 渲染', () => {
  for (const flow of flows) {
    it(`${flow.id}：渲染 SVG、所有節點與邊標籤皆出現、無 console.error`, () => {
      const errors: unknown[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => errors.push(args));
      const el = mount(<ScenarioFlow flow={flow} />);
      spy.mockRestore();

      const svg = el.querySelector('svg[role="img"]');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('aria-label')).toContain(flow.title);
      expect(svg!.getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
      expect(svg!.getAttribute('preserveAspectRatio')).toBe('xMinYMin meet');

      const text = (el.textContent ?? '').replace(/\s+/g, ' ');
      expect(text).toContain(flow.title);
      for (const n of flow.nodes) {
        expect(svg!.querySelector(`[data-node-id="${n.id}"]`), `節點 ${n.id} 未渲染`).not.toBeNull();
        expect(text, `節點標籤「${n.label}」未出現`).toContain(n.label.replace(/\n/g, ' '));
        if (n.route) {
          const a = svg!.querySelector(`a[href="#${n.route}"]`);
          expect(a, `節點 ${n.id} 應為連結`).not.toBeNull();
        }
      }
      for (const e of flow.edges) if (e.label) expect(text, `邊標籤「${e.label}」未出現`).toContain(e.label);
      for (const l of flow.lanes) expect(text).toContain(l.label.slice(0, 3));

      // 箭頭 marker 與邊路徑數量
      expect(svg!.querySelectorAll('marker').length).toBe(5);
      expect(svg!.querySelectorAll('path[marker-end]').length).toBe(flow.edges.length);
      // 圖例與文字版流程
      expect(el.querySelector('ul[aria-label="圖例"]')).not.toBeNull();
      expect(el.querySelector('details summary')?.textContent).toContain('以文字檢視流程');
      expect(el.querySelectorAll('details ol li').length).toBe(flow.nodes.length);

      expect(errors, JSON.stringify(errors.slice(0, 2))).toHaveLength(0);
    });
  }

  it('compact 模式亦可渲染', () => {
    const el = mount(<ScenarioFlow flow={GUIDE_FLOWS.welcome} compact />);
    expect(el.querySelector('svg[role="img"]')).not.toBeNull();
  });
});

describe('wrapLabel', () => {
  it('依 \\n 換行並在超過最大行數時截斷加上 …', () => {
    expect(wrapLabel('甲\n乙', 10, 3)).toEqual(['甲', '乙']);
    const lines = wrapLabel('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五', 10, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith('…')).toBe(true);
  });
  it('英文字詞盡量在空白處斷行', () => {
    const lines = wrapLabel('檢查 key.create 允許', 6, 3);
    expect(lines.join('|')).not.toMatch(/key\.cr\|/);
  });
});
