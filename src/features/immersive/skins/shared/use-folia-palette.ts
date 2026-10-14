/**
 * Folia 系皮肤（「流光」「浮名」）的**配色取值** —— Folia `Theme` 字段 → 本项目 CSS 变量。
 *
 * ## 为什么需要这一层
 *
 * Folia 的两个面板都从一个 `Theme` 对象取色：
 * `backgroundColor` / `primaryColor` / `accentColor` / `secondaryColor`。
 * 本项目没有这个对象 —— 配色分散在「全局 token」与「专辑主色（沉浸层注入的 CSS 变量）」两处。
 * 两个皮肤各自去读 = 同一首歌在两个面板里颜色不一样，所以口径收在这里。
 *
 * ## 映射表（`docs/luminous-porting-notes.md` §10.4 / `fume-porting-notes.md` §14）
 *
 * | Folia 字段 | 本项目的来源 | 用途 |
 * | --- | --- | --- |
 * | `backgroundColor` | 深色 `#09090b` / 浅色 `#f5f5f4` | 底色、副字幕辉光底 |
 * | `primaryColor` | 深色 `#f4f4f5` / 浅色 `#1c1917` | 未唱 / 唱过的字色 |
 * | `accentColor`   | 深色 `#f4f4f5` / 浅色 `#ea580c` | 正在唱的字色（无逐词配色时） |
 * | `secondaryColor`| 深色 `#71717a` / 浅色 `#44403c` | 副字幕、空态等次级文字 |
 *
 * ⚠️ `backgroundColor` / `primaryColor` / `secondaryColor` 取的是**上游那两套基础主题的字面量**
 * （`services/baseThemes.ts` 的 `DEFAULT_THEME` / `DAYLIGHT_THEME`），不是本项目的全局 token：
 * 上游那两个值直接决定 shader 的底色与文字的对比关系，换成项目的 `--color-bg-primary`
 * 会让「同一首歌在两边不是一个颜色」。
 *
 * `accentColor` 是唯一**跟随本项目**的一项：本项目有「专辑主色」（每首歌从封面提取），
 * 而 Folia 的默认主题里 accent 等于 primary（纯白/纯黑）—— 直接用会让高亮完全看不出颜色。
 * 所以这里读沉浸层注入的 `--rnp-accent-color`，读不到才回退到上游字面量。
 *
 * ## 为什么要读 CSS 变量而不是读 store
 *
 * 主色的最终值由 `use-color-extraction` 写进**根元素的内联 style**（含浅色档的翻转），
 * store 里只有"变体名"。读 computed style 才是"当前真正生效的颜色"，
 * 与「倾诉」读 `--rnp-accent-color-shade-2` 是同一种做法。
 */

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import { useImmersiveSettingsStore } from '../../immersive-settings.store'

/** 面板配色（全部是 CSS 颜色字符串） */
export interface FoliaPalette {
  /** 底色：shader 边缘兜底、副字幕辉光底 */
  background: string
  /** 正文色：未唱 / 唱过的字 */
  primary: string
  /** 高亮色：正在唱的字 */
  accent: string
  /** 次级色：副字幕 / 空态 */
  secondary: string
}

/** 上游 `DEFAULT_THEME`（午夜墨染）里的三个字面量 */
const DARK_PALETTE = {
  background: '#09090b',
  primary: '#f4f4f5',
  secondary: '#71717a',
  accent: '#f4f4f5'
} as const

/** 上游 `DAYLIGHT_THEME`（日光素白）里的三个字面量 */
const LIGHT_PALETTE = {
  background: '#f5f5f4',
  primary: '#1c1917',
  secondary: '#44403c',
  accent: '#ea580c'
} as const

/** 拿不到 computed style 时的兜底（非浏览器环境 / 元素已卸载） */
function readAccentVar(root: Element | null): string | null {
  if (!root) return null
  const value = getComputedStyle(root).getPropertyValue('--rnp-accent-color').trim()
  return value || null
}

/**
 * 取当前生效的面板配色。
 *
 * ⚠️ 明暗档由**沉浸页通用项** `settings.colorScheme` 决定（不是面板外观设置）——
 * 两个 Folia 系皮肤都没有设置面板，但明暗是这一页的行为，两边都跟随。
 * `'auto'` 按系统偏好解析，与外壳的 class 一致。
 *
 * ## 为什么把 `isDaylight` 也返回出去
 *
 * 不只是「怕调用方猜错」：`isLight` 是**明暗档的解析结果**（三态 `'dark' | 'light' | 'auto'`
 * 加系统偏好），而 `palette.background` 只是它的一个**产物**。调用方若拿底色去反推
 * （例如 `palette.background !== '#09090b'`），等于把「上游那两个十六进制字面量」
 * 变成第二个契约点：将来改动主题色值就会静默破坏这一判断。
 * 背景系统（`FoliaBackground`）需要的是语义上的「是不是浅色」，所以在这里给出。
 */
export function useFoliaPalette(): { palette: Ref<FoliaPalette>; isDaylight: Ref<boolean> } {
  const settings = useImmersiveSettingsStore()
  const palette = ref<FoliaPalette>({ ...DARK_PALETTE })
  const isDaylight = ref(false)

  /** 系统偏好（只在 `colorScheme === 'auto'` 时被读） */
  let systemDark = true
  const query =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  if (query) {
    systemDark = query.matches
    const onChange = (event: MediaQueryListEvent): void => {
      systemDark = event.matches
      refresh()
    }
    query.addEventListener('change', onChange)
    onBeforeUnmount(() => query.removeEventListener('change', onChange))
  }

  function refresh(): void {
    const isLight =
      settings.colorScheme === 'light' || (settings.colorScheme === 'auto' && !systemDark)
    isDaylight.value = isLight
    const base = isLight ? LIGHT_PALETTE : DARK_PALETTE
    // 专辑主色优先（见文件头）；读不到（无封面 / 还没提取完）时用上游字面量
    const accent = readAccentVar(document.querySelector('.immersive-root')) ?? base.accent
    palette.value = {
      background: base.background,
      primary: base.primary,
      secondary: base.secondary,
      accent
    }
  }

  // 明暗档、主色变体都会换颜色；主色是异步提取的，所以还要在挂载后补读一次
  watch(() => [settings.colorScheme, settings.accentColorVariant], refresh, { immediate: true })
  onMounted(refresh)

  return { palette, isDaylight }
}
