import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  plugins: [
    {
      name: 'clean-build-assets',
      buildStart() {
        rmSync(resolve(__dirname, 'dist/assets'), {
          recursive: true,
          force: true,
        });
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.xip.made.frl', 'velocity-pitch.localhost'],
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: false,
  },
});
