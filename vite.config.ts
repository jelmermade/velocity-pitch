import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.xip.made.frl', 'velocity-pitch.localhost'],
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
