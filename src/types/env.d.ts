/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_ENV?: string
  readonly VITE_LOG_LEVEL?: string
  /** 51.la 统计 id/ck:仅 CI 打包时通过 Actions secrets 注入,源码不含明文 */
  readonly VITE_LA_51_ID?: string
  readonly VITE_LA_51_CK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
