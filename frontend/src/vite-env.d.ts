/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute backend origin; empty means same origin. Never a secret. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
