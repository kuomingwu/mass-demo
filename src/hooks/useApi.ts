import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { ApiError, ApiResult } from '../server/api';
import { useSession } from '../app/SessionContext';

export interface ApiState<T> {
  loading: boolean;
  data: T | null;
  /** 伺服器回傳的錯誤（401/403/404/409） */
  apiError: ApiError | null;
  /** 網路層錯誤（例如模擬錯誤） */
  networkError: Error | null;
  reload: () => void;
  requestId: string | null;
}

/**
 * 封裝「呼叫 api.ts → 載入中 / 成功 / API 錯誤 / 網路錯誤」的狀態機。
 * 會在角色切換（session.version）時自動重新載入。
 */
export function useApi<T>(fn: () => Promise<ApiResult<T>>, deps: DependencyList): ApiState<T> {
  const { version } = useSession();
  const [state, setState] = useState<Omit<ApiState<T>, 'reload'>>({ loading: true, data: null, apiError: null, networkError: null, requestId: null });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mySeq = ++seq.current;
    setState((s) => ({ ...s, loading: true, apiError: null, networkError: null }));
    fn()
      .then((res) => {
        if (mySeq !== seq.current) return;
        if (res.ok) setState({ loading: false, data: res.data, apiError: null, networkError: null, requestId: res.requestId });
        else setState({ loading: false, data: null, apiError: res, networkError: null, requestId: res.requestId });
      })
      .catch((e: unknown) => {
        if (mySeq !== seq.current) return;
        setState({ loading: false, data: null, apiError: null, networkError: e instanceof Error ? e : new Error(String(e)), requestId: null });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
