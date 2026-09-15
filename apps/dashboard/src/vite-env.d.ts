/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PRICE_PRO?: string
  readonly VITE_STRIPE_PRICE_BUSINESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
