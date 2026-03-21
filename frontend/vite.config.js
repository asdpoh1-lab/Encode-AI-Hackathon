import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  if (mode === 'production' && !process.env.VITE_ADMIN_TOKEN) {
    console.warn(
      '\n[build] VITE_ADMIN_TOKEN is unset — admin.html will send an empty X-Admin-Token until you set it in CI / Vercel env.\n'
    );
  }

  return {
    build: {
      rollupOptions: {
        input: { main: 'index.html', arena: 'arena.html', join: 'join.html', admin: 'admin.html' },
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
  };
});
