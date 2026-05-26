import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isDev = mode === 'development';

  return {
    plugins: [react()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    // ── Development server ──────────────────────────────────────────────────
    server: isDev ? {
      port: 5173,
      strictPort: true,
      // Proxy API and WebSocket calls to the local backend so we avoid CORS
      // during development. The backend runs on port 3001 by default.
      proxy: {
        '/api': {
          target: env.VITE_API_URL_PROXY ?? 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: env.VITE_SOCKET_URL_PROXY ?? 'http://localhost:3001',
          changeOrigin: true,
          ws: true,
        },
      },
    } : undefined,

    build: {
      outDir:        'dist',
      sourcemap:     false,
      minify:        'esbuild',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor':  ['react', 'react-dom', 'react-router-dom'],
            'query-vendor':  ['@tanstack/react-query', 'axios'],
            'socket-vendor': ['socket.io-client'],
            'state-vendor':  ['zustand'],
          },
        },
      },
    },

    // ── Preview (local prod preview) ────────────────────────────────────────
    preview: {
      port: 4173,
      strictPort: true,
    },

    // Enable source maps in dev for debugging
    ...(isDev && { css: { devSourcemap: true } }),
  };
});