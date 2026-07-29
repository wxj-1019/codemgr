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
        // 品牌柔紫（Linear 纪律：全场一处）+ 图表专用柔青 + 语义色。
        // 这四个色亮/暗主题不变（:root.light 不覆盖），故用 channel 写法
        // （rgb(<channels> / <alpha-value>)），让 /20、/[0.14] 等透明度修饰符
        // 能真正生效——var(--x) 字符串形式下 Tailwind v3 会静默丢弃带透明度的类。
        // CSS 变量 --accent 等仍保留在 index.css，供图表 stroke/tooltip 等非 Tailwind 场景使用。
        accent: {
          DEFAULT: 'rgb(139 147 232 / <alpha-value>)', // --accent #8B93E8
          hover: 'color-mix(in srgb, var(--accent) 85%, white)',
          muted: 'color-mix(in srgb, var(--accent) 70%, black)',
          data: 'rgb(103 232 249 / <alpha-value>)', // --accent-data #67E8F9
        },
        danger: 'rgb(251 113 133 / <alpha-value>)', // --danger #FB7185
        warn: 'rgb(252 211 77 / <alpha-value>)', // --warn #FCD34D
      },
      fontFamily: {
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
