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
        // 前景色（文本）同样由变量驱动，随主题自适应
        fg: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        // 品牌柔紫（Linear 纪律：全场一处）+ 图表专用柔青 + 语义色
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'color-mix(in srgb, var(--accent) 85%, white)',
          muted: 'color-mix(in srgb, var(--accent) 70%, black)',
          data: 'var(--accent-data)',
        },
        danger: 'var(--danger)',
        warn: 'var(--warn)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
