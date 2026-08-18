import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      // Only expose explicitly client-prefixed keys — never leak GEMINI_API_KEY / OPENAI_API_KEY to the browser.
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY ?? ''),
      'import.meta.env.VITE_OPENAI_API_KEY': JSON.stringify(env.VITE_OPENAI_API_KEY ?? ''),
      'import.meta.env.VITE_AI_PROVIDER': JSON.stringify(env.VITE_AI_PROVIDER ?? ''),
      'import.meta.env.VITE_OPENAI_MODEL': JSON.stringify(env.VITE_OPENAI_MODEL ?? 'gpt-4o-mini'),
      'import.meta.env.VITE_GEMINI_MODEL': JSON.stringify(env.VITE_GEMINI_MODEL ?? ''),
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${env.API_PORT ?? '3001'}`,
          changeOrigin: true,
        },
      },
    },
  };
});
