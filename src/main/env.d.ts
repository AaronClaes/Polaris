/// <reference types="electron-vite/node" />

// electron-vite inlines MAIN_VITE_* env vars into the main process at build time
// (see `.env.example`). Augment the base ImportMetaEnv so they're typed here.
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}
