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
      // Supabase Auth tourne dans le navigateur : il lui faut l'URL du projet et la clé
      // *anonyme*, qui est publique par conception (c'est la RLS qui protège les données,
      // pas le secret de cette clé). On retombe sur les variables non préfixées pour éviter
      // de les dupliquer dans .env. La service_role, elle, ne sort jamais du serveur.
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? ''),
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
