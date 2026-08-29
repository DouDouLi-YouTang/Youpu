/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_ENV?: string
  readonly VITE_LOG_LEVEL?: string
  /** 统计 SDK id/ck:仅 CI 打包时注入,源码不含明文 */
  readonly VITE_LA_51_ID?: string
  readonly VITE_LA_51_CK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
