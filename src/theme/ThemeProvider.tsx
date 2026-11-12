import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FluentProvider, teamsHighContrastTheme, webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';
import { zh } from '../i18n/core';

export type ThemeMode = 'light' | 'dark' | 'hc';

interface ThemeCtx {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
}

const Ctx = createContext<ThemeCtx>({ mode: 'light', setMode: () => undefined, isDark: false });

const THEMES: Record<ThemeMode, Theme> = {
  light: webLightTheme,
  dark: webDarkTheme,
  hc: teamsHighContrastTheme,
};

/** 主題標籤的字典鍵（UI 用 t(THEME_LABEL_KEYS[mode])） */
export const THEME_LABEL_KEYS: Record<ThemeMode, string> = {
  light: 'shell.theme.light',
  dark: 'shell.theme.dark',
  hc: 'shell.theme.hc',
};

/** zh-TW 主題標籤（相容舊呼叫端；新程式碼請用 THEME_LABEL_KEYS + t()） */
export const THEME_LABELS: Record<ThemeMode, string> = {
  light: zh(THEME_LABEL_KEYS.light),
  dark: zh(THEME_LABEL_KEYS.dark),
  hc: zh(THEME_LABEL_KEYS.hc),
};

const STORAGE_KEY = 'maas-demo-theme';

function readInitial(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'hc') return v;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* ignore */
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readInitial);
  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);
  const isDark = mode !== 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);
  const value = useMemo(() => ({ mode, setMode, isDark }), [mode, setMode, isDark]);
  return (
    <Ctx.Provider value={value}>
      <FluentProvider theme={THEMES[mode]} style={{ minHeight: '100%', height: '100%' }}>
        {children}
      </FluentProvider>
    </Ctx.Provider>
  );
}

export function useThemeMode() {
  return useContext(Ctx);
}
