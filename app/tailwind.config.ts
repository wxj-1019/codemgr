import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 由 CSS 变量驱动，自动适配 .dark / .light（见 index.css）
        base: {
          900: 'var(--bg-base)',
          800: 'var(--bg-panel)',
          700: 'var(--bg-elevated)',
          600: 'var(--border)',
        },
        // 青绿强调
        accent: { DEFAULT: '#2dd4bf', hover: '#14b8a6', muted: '#0d9488' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
