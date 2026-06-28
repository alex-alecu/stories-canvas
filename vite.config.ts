import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.SERVER_PORT || '3001';
  const defaultLanguage = env.APP_DEFAULT_LANGUAGE || env.VITE_DEFAULT_LANGUAGE || '';

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_APP_DEFAULT_LANGUAGE': JSON.stringify(defaultLanguage),
      'import.meta.env.VITE_APP_SITE_NAME': JSON.stringify(env.APP_SITE_NAME || ''),
      'import.meta.env.VITE_APP_SITE_SHORT_NAME': JSON.stringify(env.APP_SITE_SHORT_NAME || env.APP_SITE_NAME || ''),
      'import.meta.env.VITE_APP_SITE_DESCRIPTION': JSON.stringify(env.APP_SITE_DESCRIPTION || ''),
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'shared'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return;
            }

            if (id.includes('@supabase/')) {
              return 'supabase';
            }

            if (id.includes('@tanstack/')) {
              return 'react-query';
            }

            if (id.includes('react-router')) {
              return 'router';
            }

            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'react-vendor';
            }
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
