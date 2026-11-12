import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Popover,
  PopoverSurface,
  Text,
  makeStyles,
  tokens,
  type PositioningImperativeRef,
} from '@fluentui/react-components';
import { ArrowLeftRegular, ArrowRightRegular, CheckmarkCircleRegular, CursorClickRegular, DismissRegular, SparkleRegular } from '@fluentui/react-icons';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { GUIDES, getGuide, type Guide, type GuideStep } from '../data/guides';
import { useSession } from '../app/SessionContext';
import { tf, useT } from '../i18n';

/**
 * 互動式導覽引擎（新手指引與操作指引共用）
 * - 第一次進入時自動開啟「平台導覽」（可略過）；完成或略過後記錄在 localStorage，不再自動彈出。
 * - 任何指引都可從右上角「說明」、設定頁或「操作指引」頁啟動。
 * - 以 data-tour="<id>" 標記頁面元素作為聚焦目標；步驟可指定路由，引擎會先導頁再量測。
 * - 互動步驟（interactive）不遮擋目標，等使用者實際點擊／完成後（advanceOn）自動前進。
 * - 高大的目標（例如整張供應商卡片）只以頂端一小段作為提示框錨點，避免提示框被擠出視窗。
 */

const WELCOME_KEY = 'maas-demo-tour-v1';
const DONE_KEY = 'maas-demo-guides-done';
/** 指引完成或略過時在 window 上派發的事件；由指引開啟的抽屜監聽後自行關閉 */
export const TOUR_FINISHED_EVENT = 'maas-tour-finished';

interface TourCtx {
  /** 啟動指引；未指定 id 時播放平台導覽。可同時切換示範角色。 */
  start: (guideId?: string, opts?: { persona?: string }) => void;
  isOpen: boolean;
  activeGuideId: string | null;
  /** 平台導覽是否已看過或略過 */
  hasCompleted: boolean;
  /** 已完成（或略過）的指引 id */
  completed: string[];
}

const Ctx = createContext<TourCtx | null>(null);

export function useTour(): TourCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTour must be used within TourProvider');
  return v;
}

/**
 * 抽屜／精靈用：若此抽屜是在指引進行中被開啟的，指引完成或略過時自動關閉它（避免導覽結束後抽屜還留在畫面上）。
 * 使用者自己開的抽屜（開啟時沒有指引在跑）不受影響。可在 TourProvider 之外使用（視為沒有指引）。
 */
export function useCloseOnTourFinish(open: boolean, onClose: () => void) {
  const ctx = useContext(Ctx);
  const tourOpen = ctx?.isOpen ?? false;
  const openedDuringTour = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (open) openedDuringTour.current = tourOpen;
    // 只在開啟當下記錄；開啟期間指引才開始的情況不算「由指引開啟」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handler = () => {
      if (openedDuringTour.current) onCloseRef.current();
    };
    window.addEventListener(TOUR_FINISHED_EVENT, handler);
    return () => window.removeEventListener(TOUR_FINISHED_EVENT, handler);
  }, [open]);
}

function readCompleted(): string[] {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function readWelcomeDone(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === 'done';
  } catch {
    return false;
  }
}

function persistDone(guideId: string, completed: string[]) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(completed));
    if (guideId === 'welcome') localStorage.setItem(WELCOME_KEY, 'done');
  } catch {
    /* ignore */
  }
}

const useStyles = makeStyles({
  blocker: { position: 'fixed', inset: 0, zIndex: 900 },
  /** 聚焦區四周的遮罩（四塊面板；互動步驟時可擋住目標以外的點擊） */
  dim: { position: 'fixed', zIndex: 901, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  /** 聚焦框：z-index 高於 Drawer／Dialog，確保在抽屜內也看得到 */
  spotlight: {
    position: 'fixed',
    zIndex: 1000001,
    pointerEvents: 'none',
    borderRadius: tokens.borderRadiusMedium,
    outline: `2px solid ${tokens.colorBrandStroke1}`,
    outlineOffset: '2px',
    boxShadow: `0 0 0 4px ${tokens.colorNeutralBackground1}`,
    transitionProperty: 'top, left, width, height',
    transitionDuration: tokens.durationNormal,
  },
  surface: { maxWidth: '380px', padding: tokens.spacingVerticalM },
  stepLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  title: { display: 'block', fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, marginTop: tokens.spacingVerticalXS },
  body: { display: 'block', marginTop: tokens.spacingVerticalS, lineHeight: tokens.lineHeightBase300, whiteSpace: 'pre-line' },
  hint: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  actions: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS, marginTop: tokens.spacingVerticalM, flexWrap: 'wrap' },
  spacer: { flexGrow: 1 },
  dots: { display: 'flex', columnGap: '4px', marginTop: tokens.spacingVerticalS, flexWrap: 'wrap' },
  dot: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: tokens.colorNeutralStroke1 },
  dotActive: { backgroundColor: tokens.colorBrandBackground },
  dialogBody: { lineHeight: tokens.lineHeightBase300, whiteSpace: 'pre-line' },
});

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

type Pos = 'above' | 'below' | 'before' | 'after';

function findTarget(id: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
  if (!el) return null;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return el;
}

function routePath(route?: string): string | undefined {
  return route ? route.split('?')[0] : undefined;
}

export function TourProvider({ children, autoStart = true }: { children: ReactNode; autoStart?: boolean }) {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>(readCompleted);
  const [welcomeDone, setWelcomeDone] = useState(readWelcomeDone);
  const { setPersona } = useSession();

  const start = useCallback(
    (guideId = 'welcome', opts?: { persona?: string }) => {
      const g = getGuide(guideId) ?? GUIDES[0];
      if (opts?.persona) setPersona(opts.persona);
      setGuide(g);
      setIndex(0);
    },
    [setPersona],
  );

  // 第一次進入自動開啟平台導覽（測試環境與窄螢幕不自動開啟）
  useEffect(() => {
    if (!autoStart || welcomeDone) return;
    if (import.meta.env.MODE === 'test') return;
    if (window.innerWidth < 700) return;
    const t = window.setTimeout(() => {
      setGuide(GUIDES[0]);
      setIndex(0);
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback(() => {
    if (!guide) return;
    const next = completed.includes(guide.id) ? completed : [...completed, guide.id];
    setCompleted(next);
    persistDone(guide.id, next);
    if (guide.id === 'welcome') setWelcomeDone(true);
    setGuide(null);
    // 通知由指引開啟的抽屜關閉（延後到目前事件結束後，避免與點擊事件互相干擾）
    const guideId = guide.id;
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(TOUR_FINISHED_EVENT, { detail: { guideId } })), 0);
  }, [guide, completed]);

  const value = useMemo<TourCtx>(
    () => ({ start, isOpen: guide !== null, activeGuideId: guide?.id ?? null, hasCompleted: welcomeDone, completed }),
    [start, guide, welcomeDone, completed],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {guide && <TourOverlay guide={guide} index={index} setIndex={setIndex} onFinish={finish} />}
    </Ctx.Provider>
  );
}

function TourOverlay({ guide, index, setIndex, onFinish }: { guide: Guide; index: number; setIndex: (i: number) => void; onFinish: () => void }) {
  const s = useStyles();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [rect, setRect] = useState<Rect | null>(null);
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<Pos>('below');
  const anchorRef = useRef<Rect | null>(null);
  const [anchorVersion, setAnchorVersion] = useState(0);
  const positioningRef = useRef<PositioningImperativeRef>(null);

  const steps = guide.steps;
  const step: GuideStep = steps[Math.min(index, steps.length - 1)];
  const total = steps.length;
  const interactive = !!step.interactive;

  // 需要特定路由的步驟：先導頁
  useEffect(() => {
    const rp = routePath(step.route);
    if (rp && location.pathname !== rp) navigate(step.route!);
  }, [step, location.pathname, navigate]);

  /** 往指定方向尋找第一個可用的步驟；force 時直接前進（目標可能稍後才出現，由量測重試處理） */
  const move = useCallback(
    (dir: 1 | -1, force = false) => {
      const available = (st: GuideStep) => {
        if (!st.target) return true;
        const rp = routePath(st.route);
        if (rp && rp !== location.pathname) return true;
        if (st.lazy) return true;
        return !!findTarget(st.target);
      };
      let i = index + dir;
      if (!force) while (i >= 0 && i < total && !available(steps[i])) i += dir;
      if (i < 0) i = 0;
      // 延後到目前的點擊事件結束後再切換步驟：避免新掛載的對話框被同一個點擊事件視為「點擊背景」而關閉
      const target = i;
      window.setTimeout(() => {
        if (target >= total) onFinish();
        else setIndex(target);
      }, 0);
    },
    [index, total, steps, location.pathname, onFinish, setIndex],
  );

  // 量測目標位置（含資料載入／抽屜動畫後的重新量測）
  useLayoutEffect(() => {
    if (!step.target) {
      setRect(null);
      setTargetEl(null);
      anchorRef.current = null;
      return;
    }
    const rp = routePath(step.route);
    if (rp && location.pathname !== rp) return; // 等導頁完成
    let cancelled = false;
    let tries = 0;
    let located = false;
    const measure = (scroll = true) => {
      if (cancelled) return;
      const el = findTarget(step.target!);
      if (!el) {
        // 目標尚未渲染（例如資料載入中、抽屜開啟中）：最多等 4 秒，否則略過此步驟
        if (located) return; // 已定位過的目標暫時消失：交由互動步驟的監看處理
        if (tries++ < 40) window.setTimeout(() => measure(true), 100);
        else move(1);
        return;
      }
      located = true;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      let r = el.getBoundingClientRect();
      const tall = r.height > vh * 0.45;
      if (scroll) {
        if (tall) {
          if (r.top < 0 || r.top > vh * 0.35) el.scrollIntoView({ block: 'start', inline: 'nearest' });
        } else {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
      r = el.getBoundingClientRect();
      setRect({ top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 });
      // 提示框錨點：高大目標只取可見的頂端一段
      const visTop = Math.max(r.top, 0);
      const visBottom = Math.min(r.bottom, vh);
      anchorRef.current = tall ? { top: visTop, left: r.left, width: r.width, height: Math.min(120, Math.max(40, visBottom - visTop)) } : { top: r.top, left: r.left, width: r.width, height: r.height };
      let p: Pos = step.position ?? 'below';
      const roomLeft = r.left >= 440;
      const roomRight = vw - r.right >= 440;
      if (p === 'before' && !roomLeft) p = roomRight ? 'after' : 'below';
      else if (p === 'after' && !roomRight) p = roomLeft ? 'before' : 'below';
      if (tall) {
        // 高大目標：錨點只取頂端一段；左右有空間就維持側邊，否則往下
        if (p !== 'before' && p !== 'after') p = 'below';
      } else if (p === 'above' && r.top < 320) p = 'below';
      setPos(p);
      setTargetEl(el);
      setAnchorVersion((v) => v + 1);
    };
    measure(true);
    const onChange = () => measure(false);
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    // 版面變動（資料載入、抽屜動畫）後持續校正聚焦框位置，不再自動捲動
    const iv = window.setInterval(() => measure(false), 600);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [step, move, location.pathname]);

  useEffect(() => {
    positioningRef.current?.updatePosition();
  }, [anchorVersion]);

  // 互動步驟：等使用者實際操作後自動前進
  // 點擊後的前進計時器放在 ref：目標按鈕若立刻導頁（例如「申請試用」→ /hub/trial），location 改變會讓此 effect 重跑，
  // 若把計時器放在 effect 內部，cleanup 會把它清掉而永遠不前進；只在步驟切換時重設。
  const advanceTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = undefined;
  }, [step]);
  useEffect(() => {
    if (!step.advanceOn) return;
    const { kind, target } = step.advanceOn;
    const next = () => (index + 1 < total ? move(1, true) : onFinish());
    if (kind === 'click') {
      const handler = (e: Event) => {
        const t = e.target as Element | null;
        if (t && typeof t.closest === 'function' && t.closest(`[data-tour="${target}"]`) && !advanceTimer.current) {
          advanceTimer.current = window.setTimeout(() => {
            advanceTimer.current = undefined;
            next();
          }, 350);
        }
      };
      document.addEventListener('click', handler, true);
      return () => document.removeEventListener('click', handler, true);
    }
    const iv = window.setInterval(() => {
      if (findTarget(target)) {
        window.clearInterval(iv);
        next();
      }
    }, 200);
    return () => window.clearInterval(iv);
  }, [step, index, total, move, onFinish]);

  // 互動步驟的目標消失（例如使用者關閉抽屜）：退回上一步
  useEffect(() => {
    if (!interactive || !step.target || !targetEl) return;
    let misses = 0;
    const iv = window.setInterval(() => {
      if (findTarget(step.target!)) {
        misses = 0;
        return;
      }
      if (++misses >= 5) {
        window.clearInterval(iv);
        setTargetEl(null);
        setRect(null);
        if (index > 0) setIndex(index - 1);
      }
    }, 300);
    return () => window.clearInterval(iv);
  }, [interactive, step, targetEl, index, setIndex]);

  const virtualTarget = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const a = anchorRef.current ?? { top: 0, left: 0, width: 0, height: 0 };
        return { x: a.left, y: a.top, left: a.left, top: a.top, right: a.left + a.width, bottom: a.top + a.height, width: a.width, height: a.height, toJSON: () => ({}) } as DOMRect;
      },
      contextElement: targetEl ?? undefined,
    }),
    [targetEl],
  );

  // 資料驅動文字：guides.<guideId>.<field>、guides.<guideId>.step.<stepId>.<field>（缺鍵時退回 guides.ts 的 zh-TW 文字）
  const guideTitle = tf(t, `guides.${guide.id}.title`, guide.title);
  const stepKey = `guides.${guide.id}.step.${step.id}`;
  const stepTitle = tf(t, `${stepKey}.title`, step.title);
  const stepBody = tf(t, `${stepKey}.body`, step.body);
  const stepHint = step.hint !== undefined ? tf(t, `${stepKey}.hint`, step.hint) : t('shell.tour.hintDefault');

  const isFirst = index === 0;
  const isLast = index === total - 1;

  const actions = (
    <div className={s.actions}>
      <Text className={s.stepLabel} aria-live="polite">
        {t('shell.tour.stepOf', { n: index + 1, total })}
      </Text>
      <div className={s.spacer} />
      {!isLast && (
        <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onFinish}>
          {t('common.skip')}
        </Button>
      )}
      {!isFirst && (
        <Button appearance="secondary" size="small" icon={<ArrowLeftRegular />} onClick={() => move(-1)}>
          {t('common.prev')}
        </Button>
      )}
      {isLast ? (
        <Button appearance="primary" size="small" icon={<CheckmarkCircleRegular />} onClick={onFinish}>
          {t('common.done')}
        </Button>
      ) : interactive ? (
        <Button appearance="secondary" size="small" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => move(1, true)}>
          {t('shell.tour.skipStep')}
        </Button>
      ) : (
        <Button appearance="primary" size="small" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => move(1)}>
          {isFirst ? t('shell.tour.start') : t('common.next')}
        </Button>
      )}
    </div>
  );

  const dots = (
    <div className={s.dots} aria-hidden>
      {steps.map((st, i) => (
        <span key={st.id} className={i === index ? `${s.dot} ${s.dotActive}` : s.dot} />
      ))}
    </div>
  );

  // 置中步驟：對話框
  if (!step.target) {
    return (
      <Dialog open modalType="alert" onOpenChange={(_, d) => !d.open && onFinish()}>
        <DialogSurface aria-describedby="tour-dialog-body">
          <DialogBody>
            <DialogTitle>
              <SparkleRegular style={{ verticalAlign: '-3px', marginRight: 6 }} />
              {stepTitle}
            </DialogTitle>
            <DialogContent id="tour-dialog-body" className={s.dialogBody}>
              <Text className={s.stepLabel}>{guideTitle}</Text>
              <div style={{ marginTop: tokens.spacingVerticalS }}>{stepBody}</div>
              {dots}
            </DialogContent>
            <DialogActions fluid>{actions}</DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }

  // 聚焦步驟：遮罩 + 聚焦框掛在 body，避免被應用程式容器的堆疊層遮住
  return (
    <>
      {createPortal(
        <>
          {!interactive && <div className={s.blocker} aria-hidden onClick={(e) => e.stopPropagation()} />}
          {rect && (
            <>
              <div className={s.dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top), pointerEvents: 'none' }} aria-hidden />
              <div className={s.dim} style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }} aria-hidden />
              <div className={s.dim} style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height, pointerEvents: 'none' }} aria-hidden />
              <div className={s.dim} style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height, pointerEvents: 'none' }} aria-hidden />
              <div className={s.spotlight} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden />
            </>
          )}
        </>,
        document.body,
      )}
      {targetEl && (
        <Popover
          key={step.id} /* 只以步驟 id 重新掛載 portal（量測／定位更新不重掛）：確保提示框永遠在稍後開啟的抽屜／對話框之上 */
          open
          withArrow
          trapFocus={!interactive}
          /*
           * 互動步驟不可自動聚焦提示框：Popover 掛載時把焦點移到提示框按鈕（位於任何 Tabster modalizer 之外）會讓
           * 抽屜（Dialog modalizer）失去「作用中」狀態，之後使用者點進抽屜內的輸入框時，Tabster 會在 ~100 ms 後把焦點
           * 「還回」提示框的「跳過此步」按鈕，輸入的文字因此遺失。
           */
          unstable_disableAutoFocus={interactive}
          positioning={{ target: virtualTarget as unknown as HTMLElement, position: pos, align: 'start', offset: 12, positioningRef, autoSize: 'height-always' }}
          onOpenChange={(_, d) => {
            if (d.open) return;
            // 互動步驟允許點擊畫面其他地方（例如填表），不視為關閉導覽
            if (interactive && (d as { type?: string }).type !== 'escapeKeyDown') return;
            onFinish();
          }}
        >
          <PopoverSurface className={s.surface} role="dialog" aria-modal={!interactive} aria-labelledby={`tour-title-${step.id}`} aria-describedby={`tour-body-${step.id}`}>
            <Text className={s.stepLabel}>{guideTitle}</Text>
            <Text className={s.title} id={`tour-title-${step.id}`} as="h2">
              {stepTitle}
            </Text>
            <Text className={s.body} id={`tour-body-${step.id}`}>
              {stepBody}
            </Text>
            {interactive && (
              <div className={s.hint} role="status">
                <CursorClickRegular aria-hidden />
                {stepHint}
              </div>
            )}
            {dots}
            {actions}
          </PopoverSurface>
        </Popover>
      )}
    </>
  );
}
