import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from '@vue/eslint-config-prettier'

export default [
  {
    ignores: [
      'dist/**',
      'out/**',
      'release/**',
      'node_modules/**',
      'server/**',
      '.mcp-servers/**',
      // Claude Code agent worktree 各自携带 tsconfig.json,
      // 会导致 typescript-eslint 检测到多个 tsconfigRootDir 候选而报 parsing error。
      '.claude/**',
      // 本地工具目录(git 未追踪,CI 上不存在):恢复副本。
      // 不加忽略会导致本地 eslint . 扫描上万文件而卡死。
      '_recovery/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  eslintConfigPrettier,
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        // Browser DOM globals used in renderer code (fetch, HTMLElement, etc.).
        // Keep this list exhaustive for renderer-facing types — canvas/SVG/observer
        // globals are needed by the immersive background & lyric components.
        window: 'readonly',
        document: 'readonly',
        HTMLElement: 'readonly',
        HTMLAudioElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLStyleElement: 'readonly',
        SVGFETurbulenceElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        Image: 'readonly',
        ResizeObserver: 'readonly',
        KeyboardEvent: 'readonly',
        PointerEvent: 'readonly',
        MouseEvent: 'readonly',
        TransitionEvent: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        MediaError: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        URLSearchParams: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // 滚动/媒体/节点 API 全局类型(.vue no-undef 需显式声明,见记忆 eslint-vue-globals-list)
        IntersectionObserver: 'readonly',
        Node: 'readonly',
        MediaDeviceInfo: 'readonly'
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    rules: {
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    // Node-only CommonJS bootstrap scripts (e.g. the api-enhanced DNS preload
    // injected via NODE_OPTIONS --require). These run in the Node main process,
    // not the renderer, so they use `require`/`process` and CommonJS modules.
    files: ['**/*.cjs', 'scripts/**/*.{js,cjs}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    // Node ESM build scripts (scripts/*.mjs): 运行在 Node 而非浏览器/renderer,
    // 使用 import 语法,需要 process/console 等 Node 全局(此前漏配导致 no-undef)。
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly'
      }
    }
  },
  {
    // 安装界面宿主的前端脚本(tools/setup-host/ui/*.js):运行在 WebView2 里的普通浏览器
    // 脚本,不经打包器、没有注入全局,需要显式声明浏览器环境,否则整目录 no-undef。
    files: ['tools/setup-host/ui/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URLSearchParams: 'readonly',
        PointerEvent: 'readonly'
      }
    }
  }
]
