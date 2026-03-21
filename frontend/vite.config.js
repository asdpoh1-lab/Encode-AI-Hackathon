import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', arena: 'arena.html', join: 'join.html' },
    },
  },
  server: {
    port: 5173,
    // Must match backend default port (see backend/index.js). Demo: always 3001.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
