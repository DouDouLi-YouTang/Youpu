import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

function fromRoot(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url))
}

const aliases = {
  '@': fromRoot('./src'),
  '@app': fromRoot('./src/app'),
  '@components': fromRoot('./src/components'),
  '@features': fromRoot('./src/features'),
  '@stores': fromRoot('./src/stores'),
  '@services': fromRoot('./src/services'),
  '@domain': fromRoot('./src/domain'),
  '@platform': fromRoot('./src/platform')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: fromRoot('./electron/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: fromRoot('./electron/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [
      vue(),
      tailwindcss(),
      // antd 组件按需 auto-import；importStyle:false → CSS-in-JS。注意：
      // electron-vite 只读取本文件，不读 ./vite.config.ts，因此 resolver 必须
      // 在这里注册，否则 <a-layout>/<a-avatar>/... 会被当成未知自定义元素。
      Components({
        resolvers: [AntDesignVueResolver({ importStyle: false })]
      })
    ],
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      hmr: {
        host: '127.0.0.1'
      }
    },
    resolve: {
      alias: aliases
    },
    css: {
      preprocessorOptions: {
        scss: {
          // 编译期 $ 变量对全局 scss/<style lang="scss"> 可用。canonical 定义在
          // src/assets/styles/index.scss 顶部(唯一归属地),这里以 additionalData
          // 内联同一份供各组件样式块使用 —— 改值时两处必须同步。组件不能 @use
          // index.scss(会把其整包 CSS 注入每个组件输出),所以采用内联注入。
          additionalData:
            '$color-danger: #ef4444;\n' +
            '$color-hot: #ff5a36;\n' +
            '$color-success: #22c55e;\n' +
            '$color-spotify: #1db954;\n' +
            '$color-white: #fff;\n' +
            '$color-black: #000;\n'
        }
      }
    },
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: fromRoot('./index.html')
      }
    }
  }
})
