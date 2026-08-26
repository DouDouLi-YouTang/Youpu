import { computed, ref, watchEffect } from 'vue'
import { theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

import { ACCENT_PRESETS, useSettingsStore } from '@/stores/settings.store'

export { zhCN }

/**
 * 封面提取主色,由 use-color-extraction 在 accentFollowsCover 时写入。
 * 模块级单例,useTheme() 读取。null = 未提取/灰色降级,useTheme 回退预设色。
 */
export const coverAccent = ref<string | null>(null)

/** 系统明暗偏好(auto 模式读)。模块级注册一次,避免 useTheme 多次调用重复监听。 */
const systemLight = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
)
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    systemLight.value = e.matches
  })
}

/** dark 主题 antd token(对齐原静态 antdTheme 取值)。 */
const DARK_TOKEN = {
  colorBgContainer: '#15171a',
  colorBgElevated: '#22262b',
  colorBgLayout: '#101113',
  colorBorder: '#2a2f35',
  colorTextBase: '#f4f7f5',
  colorTextSecondary: '#a7b0aa',
  controlItemBgHover: '#23272d'
} as const

/** light 主题 antd token(与 tokens.scss 的 :root.light 对齐)。 */
const LIGHT_TOKEN = {
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgLayout: '#f5f7f6',
  colorBorder: '#e0e4e1',
  colorTextBase: '#1a1d1b',
  colorTextSecondary: '#5a635e',
  controlItemBgHover: '#f0f2f1'
} as const

/**
 * 当前解析的明暗模式。模块级响应式 ref,AppFrame/SidebarNav 可直接 import
 * 动态绑定 antd sider/menu 的 theme prop,避免硬编码 dark/light。
 * 由 useTheme() 首次调用时写入并保持同步。
 */
export const resolvedThemeMode = ref<'light' | 'dark'>('dark')

/**
 * 响应式主题 composable。基于 settings store 派生 antd theme + html 类 + 主色 CSS 变量。
 * 在 App.vue setup 调用一次,返回响应式 antdTheme 传给 a-config-provider。
 */
export function useTheme() {
  const settings = useSettingsStore()

  const resolvedMode = computed<'light' | 'dark'>(() => {
    if (settings.theme === 'auto') return systemLight.value ? 'light' : 'dark'
    return settings.theme
  })

  const accentColor = computed(() => {
    if (settings.accentFollowsCover && coverAccent.value) return coverAccent.value
    return ACCENT_PRESETS[settings.accentColor]
  })

  const antdTheme = computed<ThemeConfig>(() => {
    const isLight = resolvedMode.value === 'light'
    const token = isLight ? LIGHT_TOKEN : DARK_TOKEN
    const accent = accentColor.value
    return {
      algorithm: isLight ? theme.defaultAlgorithm : theme.darkAlgorithm,
      token: {
        colorPrimary: accent,
        colorSuccess: accent,
        colorInfo: accent,
        borderRadius: 10,
        ...token,
        controlHeight: 36
      },
      components: {
        // ant-design-vue 4.x Layout token names(见 node_modules/ant-design-vue/es/layout/style/index.js)
        Layout: {
          colorBgHeader: token.colorBgContainer,
          colorBgBody: token.colorBgLayout,
          colorBgTrigger: token.colorBgElevated
        }
      }
    }
  })

  // 同步 html 类(dark/light)+ 主色 CSS 变量 + 模块级 resolvedThemeMode。
  watchEffect(() => {
    const el = document.documentElement
    const isLight = resolvedMode.value === 'light'
    el.classList.toggle('dark', !isLight)
    el.classList.toggle('light', isLight)
    el.style.setProperty('--color-primary', accentColor.value)
    resolvedThemeMode.value = resolvedMode.value
    // 同步 nativeTheme 让 Windows 11 DWM 窗口边框颜色跟随应用主题
    window.muiceDesktop?.theme.setSource(isLight ? 'light' : 'dark')
  })

  return { antdTheme }
}

/**
 * 首屏主题类。pinia 初始化前(main.ts)调用,默认 dark,避免首屏无类闪烁。
 * useTheme() 在 App.vue setup 接管后会按设置纠正。
 */
export function installThemeProvider(): void {
  document.documentElement.classList.add('dark')
}
