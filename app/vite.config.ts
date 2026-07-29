import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            // utility-host.mjs（UtilityProcess 入口，6c）作为额外入口一起打包，
            // main.ts 用 path.join(__dirname, 'utility-host.mjs') 引用它。
            rollupOptions: {
              input: {
                main: path.join(__dirname, 'electron/main.ts'),
                'utility-host': path.join(__dirname, 'electron/utility-host.mjs'),
              },
              output: { entryFileNames: '[name].js' },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: { outDir: 'dist-electron' },
        },
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
  },
});
