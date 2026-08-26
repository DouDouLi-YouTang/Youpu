import { ref, watch, type Ref } from 'vue'
import {
  Hct,
  QuantizerCelebi,
  Score,
  themeFromSourceColor
} from '@importantimport/material-color-utilities'

import { coverAccent } from '@/app/providers/theme-provider'
import { useImmersiveSettingsStore } from './immersive-settings.store'
import { argbToRgb, imageToArgbPixels, loadCrossOriginImage } from './image-color'

/**
 * 专辑主色提取 —— 逐字移植参考项目 main.js 的 calcAccentColor / useGreyAccentColor。
 *
 * 流程：封面图 → 50×50 canvas → getImageData → ARGB 打包 →
 * QuantizerCelebi 量化 128 色 → Score.score 排序 → themeFromSourceColor 生成
 * Material You 调色板 → 用 Hct 从 palette 取指定 tone → 注入 CSS 变量。
 *
 * 跨域：img.crossOrigin='anonymous'，配合主进程 onHeadersReceived 注入 ACAO。
 * canvas 被污染会抛 SecurityError，降级到灰色（对齐 useGreyAccentColor）。
 *
 * 全局跟随:提取成功且全局 settings.accentFollowsCover 时,同步主色到 coverAccent,
 * 供 useTheme 把全局 --color-primary / antd colorPrimary 染成专辑主色。
 */

/** useGreyAccentColor：中性灰降级（对齐参考项目 rgb 值）。
 *  off 变体也走此中性集：不使用专辑主色，按钮用中性灰、文字用白（dark）/暗（light 由 CSS 翻转）。 */
const GREY_VARS: Record<string, string> = {
  '--rnp-accent-color': 'rgb(170, 170, 170)',
  '--rnp-accent-color-rgb': '170, 170, 170',
  '--rnp-accent-color-on-primary': 'rgb(10, 10, 10)',
  '--rnp-accent-color-shade-2': 'rgb(255, 255, 255)',
  '--rnp-accent-color-shade-2-rgb': '255, 255, 255',
  '--rnp-accent-color-shade-2-light': 'rgb(10, 10, 10)',
  '--rnp-accent-color-shade-2-light-rgb': '10, 10, 10',
  '--rnp-accent-color-bg': 'rgb(50, 50, 50)',
  '--rnp-accent-color-bg-rgb': '50, 50, 50',
  '--rnp-accent-color-overlay': 'rgba(0, 0, 0, 1)'
}

/** ARGB int → '#rrggbb'(小写)。供全局主色同步给 antd colorPrimary(hex)。 */
function argbToHex(argb: number): string {
  const [r, g, b] = argbToRgb(argb)
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function useColorExtraction(coverUrl: Ref<string | undefined | null>) {
  const settings = useImmersiveSettingsStore()
  const accentVars = ref<Record<string, string>>({ ...GREY_VARS })
  const accentReady = ref(false)

  /** 竞态防护:快速切歌/切变体时,旧封面仍在途的异步提取不得覆盖最新结果。
   *  每次 applyGrey/extract 触发即自增;extract 在 await 恢复后校验令牌。 */
  let extractToken = 0

  function applyGrey(): void {
    extractToken++
    accentVars.value = { ...GREY_VARS }
    accentReady.value = true
    // 灰色/降级:全局跟随封面时回退预设色
    coverAccent.value = null
  }

  function buildAccentVars(
    shade2Argb: number,
    shade2DarkArgb: number,
    accentArgb: number,
    bgArgb: number
  ): Record<string, string> {
    const [r2, g2, b2] = argbToRgb(shade2Argb)
    const [r2d, g2d, b2d] = argbToRgb(shade2DarkArgb)
    const [ra, ga, ba] = argbToRgb(accentArgb)
    const [rb, gb, bb] = argbToRgb(bgArgb)
    return {
      // 基础主色（饱和中调 tone 50）：控制条按钮/播放键/滑块/设置 tab 读取，使控件染专辑主色
      '--rnp-accent-color': `rgb(${ra}, ${ga}, ${ba})`,
      '--rnp-accent-color-rgb': `${ra}, ${ga}, ${ba}`,
      // 主色填充上的文字/图标色:accent 是 tone 50 中调,按 M3 配对取 tone 100(恒纯白);
      // 灰降级(GREY_VARS)对齐参考 useGreyAccentColor 的 rgb(10,10,10) —— 深字灰底
      '--rnp-accent-color-on-primary': 'rgb(255, 255, 255)',
      // 文字色（高调 tone 90）：歌词/封面标题读取
      '--rnp-accent-color-shade-2': `rgb(${r2}, ${g2}, ${b2})`,
      '--rnp-accent-color-shade-2-rgb': `${r2}, ${g2}, ${b2}`,
      '--rnp-accent-color-shade-2-light': `rgb(${r2d}, ${g2d}, ${b2d})`,
      '--rnp-accent-color-shade-2-light-rgb': `${r2d}, ${g2d}, ${b2d}`,
      '--rnp-accent-color-bg': `rgb(${rb}, ${gb}, ${bb})`,
      '--rnp-accent-color-bg-rgb': `${rb}, ${gb}, ${bb}`,
      '--rnp-accent-color-overlay': 'rgba(0, 0, 0, 1)'
    }
  }

  async function extract(url: string): Promise<void> {
    const token = ++extractToken
    try {
      const img = await loadCrossOriginImage(url)
      // await 期间可能已切歌/切变体(令牌被后续触发改写),旧封面的结果直接丢弃
      if (token !== extractToken) return
      const pixels = imageToArgbPixels(img)
      const quantized = QuantizerCelebi.quantize(pixels, 128)
      const sorted = Array.from(quantized.entries()).sort((a, b) => b[1] - a[1])
      const top5 = sorted.slice(0, 5).map(([argb]) => argbToRgb(argb))

      // 灰色封面降级：top5 颜色 RGB 三通道极差都 < 5 → 视为无色彩
      if (top5.every((c) => Math.max(...c) - Math.min(...c) < 5)) {
        applyGrey()
        return
      }

      const ranked = Score.score(new Map(sorted.slice(0, 50)))
      const top = ranked[0]
      const theme = themeFromSourceColor(top)

      // variant='off'：不使用专辑主色，走中性灰降级（按钮中性灰、文字白/暗由 CSS 翻转）
      if (settings.accentColorVariant === 'off') {
        applyGrey()
        return
      }
      const palette = theme.palettes[settings.accentColorVariant]
      const secondary = theme.palettes.secondary

      const shade2Argb = Hct.from(palette.hue, palette.chroma, 90).toInt()
      const shade2DarkArgb = Hct.from(palette.hue, palette.chroma, 20).toInt()
      // 基础主色取同 palette 的饱和中调（tone 50），供控件填充/播放键/滑块读取
      const accentArgb = Hct.from(palette.hue, palette.chroma, 50).toInt()
      const bgArgb = Hct.from(secondary.hue, secondary.chroma, 20).toInt()

      accentVars.value = buildAccentVars(shade2Argb, shade2DarkArgb, accentArgb, bgArgb)
      accentReady.value = true
      // 始终同步提取色到全局,是否采用由 useTheme 根据 accentFollowsCover 决定
      coverAccent.value = argbToHex(accentArgb)
    } catch {
      // 跨域污染 / 加载失败 / 解码失败 → 灰色降级，保证不崩。过期请求不降级,
      // 避免旧封面的失败把当前封面已提取好的主色打回灰色
      if (token !== extractToken) return
      applyGrey()
    }
  }

  watch(
    () => coverUrl.value,
    (url) => {
      if (url) void extract(url)
      else applyGrey()
    },
    { immediate: true }
  )

  // 主题色变体切换需重新提取（不同 variant 取不同 palette 的 tone；
  // off 在 extract 内部走中性灰）。立即按当前封面重算。
  watch(
    () => settings.accentColorVariant,
    () => {
      if (coverUrl.value) void extract(coverUrl.value)
      else applyGrey()
    }
  )

  return { accentVars, accentReady }
}
