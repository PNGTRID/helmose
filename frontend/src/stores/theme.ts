// 主题状态（亮/暗）：localStorage 持久化 + 系统 prefers-color-scheme 兜底 + html.dark class 驱动 CSS 变量。
// 配合 main.tsx 的 ConfigProvider darkAlgorithm（antd 组件）+ index.css html.dark（--ob-* 变量）双轨切换。

import { create } from "zustand";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = "helmose-theme";

function applyDom(t: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", t === "dark");
  }
}

function readInitial(): Theme {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === "light" || saved === "dark") return saved;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function persist(t: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* localStorage 不可用时静默（隐私模式等） */
  }
}

const initial = readInitial();
applyDom(initial);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  toggle: () =>
    set((s) => {
      const next: Theme = s.theme === "dark" ? "light" : "dark";
      applyDom(next);
      persist(next);
      return { theme: next };
    }),
  setTheme: (t) => {
    applyDom(t);
    persist(t);
    set({ theme: t });
  },
}));

// 动态跟随系统主题：系统切换深浅色时，若用户未手动设过（localStorage 空），app 跟随。
if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", (e) => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return; // 用户已手动设，不覆盖
    } catch {
      /* ignore */
    }
    const t: Theme = e.matches ? "dark" : "light";
    applyDom(t);
    useThemeStore.setState({ theme: t });
  });
}
