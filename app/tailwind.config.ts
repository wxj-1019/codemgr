import type { Config } from 'tailwindcss';

const opaque = (token: string) => `rgb(var(--${token}-rgb) / <alpha-value>)`;
const translucent = (token: string) =>
  `rgb(var(--${token}-rgb) / calc(var(--${token}-alpha) * <alpha-value>))`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          canvas: opaque('surface-canvas'),
          panel: translucent('surface-panel'),
          raised: translucent('surface-raised'),
          overlay: translucent('surface-overlay'),
        },
        content: {
          primary: opaque('content-primary'),
          secondary: opaque('content-secondary'),
          muted: opaque('content-muted'),
        },
        line: translucent('line'),
        focus: opaque('focus'),
        success: opaque('success'),
        info: opaque('info'),
        'on-accent': opaque('on-accent'),

        accent: {
          DEFAULT: opaque('accent'),
          hover: opaque('accent-hover'),
          muted: opaque('accent-muted'),
          data: opaque('accent-data'),
        },
        danger: opaque('danger'),
        warn: opaque('warn'),
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', // macOS/iOS 原生 SF
          'SF Pro Text',                          // 显式 SF
          'Segoe UI Variable', 'Segoe UI',        // Windows 11/10（可变字体，苹果风）
          'PingFang SC', 'Microsoft YaHei',       // 中文
          'system-ui', 'sans-serif',
        ],
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
