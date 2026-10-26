/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_CLOUD_SYNC_ALLOWED_ORIGINS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
