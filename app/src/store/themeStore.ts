import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
}

// 默认深色：模块加载时先打上 dark 类，避免首帧闪烁。
// （rehydrate 后若用户保存的是 light，会由 onRehydrateStorage 覆盖）
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggle: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        set({ theme: next });
      },
      setTheme: (t) => {
        applyTheme(t);
        set({ theme: t });
      },
    }),
    {
      name: 'codemgr:theme',
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        // 持久化恢复后，根据保存的 theme 重新设置 DOM class（覆盖默认的 dark）
        if (state) applyTheme(state.theme);
      },
    },
  ),
);
