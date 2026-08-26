import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// vitest 独立配置(不与 electron.vite.config.ts 共用:后者含 renderer/main/preload
// 分包逻辑,对纯函数单测是干扰)。被测的解析器/mapper 都是纯 TS,用 node 环境即可,
// 无需 jsdom。alias 对齐 tsconfig 的 @/* -> src/*。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts']
  }
})
