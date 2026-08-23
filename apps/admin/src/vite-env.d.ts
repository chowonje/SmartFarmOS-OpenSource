/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_BASE_URL?: string;
  readonly PUBLIC_ADMIN_AUTH_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
