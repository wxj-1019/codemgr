import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 深灰底
        base: { 900: '#0f1419', 800: '#1a2028', 700: '#242c38', 600: '#2f3947' },
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
