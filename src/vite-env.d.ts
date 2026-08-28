/// <reference types="vite/client" />

declare module '*.wasm?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_AI_PROVIDER?: 'openai' | 'gemini' | string;
  readonly VITE_OPENAI_MODEL?: string;
  readonly VITE_GEMINI_MODEL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
