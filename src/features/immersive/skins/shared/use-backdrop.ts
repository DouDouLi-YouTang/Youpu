import { computed, ref } from 'vue'

import { LYRIC_TIMING_MAP, useImmersiveSettingsStore } from '../../immersive-settings.store'
import { useEffectiveDisplayMode } from '../../use-skin-context'
import { useImmersivePlayer } from '../../use-immersive-player'

/**
 * 背景层渲染参数 —— `rootClasses` / `rootStyleVars` 的唯一来源（挂在皮肤外壳的根 section 上，
 * 驱动背景、歌词、封面的全部视觉分支），并一并持有自定义字体与全屏状态。
 *
 * 为什么全屏状态在这里：`rnp-full-screen` 是 rootClasses 的一员，而全屏按钮在
 * `SkinChromeButtons`、全屏时钟与 ESC 分层在 `SkinShell` —— 三处必须共享同一份状态，
 * 由本 hook 统一持有并向下传递。
 *
 * 注：`accentVars`（专辑主色提取）**不在**本 hook 内 —— 它同时驱动全局主题色
 * （use-color-extraction 会写 coverAccent），必须像改造前一样随 ImmersivePlayer 常驻挂载，
 * 不能只在沉浸页打开时跑；因此由 ImmersivePlayer 计算后作为 prop 传给 SkinShell。
 */
export function useBackdrop() {
  const settings = useImmersiveSettingsStore()
  const { idle } = useImmersivePlayer()
  const effectiveDisplayMode = useEffectiveDisplayMode()

  /**
   * 把全部可调参数以 CSS 变量形式注入到沉浸层根元素。子组件（背景、歌词、控制条）
   * 直接读取这些变量，无需通过 props 逐层传递 —— 与参考项目 bindSliderToCSSVariable
   * 把滑块值写到 document style 的做法等价，只是作用域收到沉浸层内部。
   */
  const rootStyleVars = computed(() => {
    const s = settings
    return {
      '--bg-blur': `${s.bgBlur}px`,
      '--bg-dim': s.bgDim / 100,
      '--bg-dim-for-gradient-bg': s.bgDimForGradientBg / 100,
      '--bg-dim-for-fluid-bg': s.bgDimForFluidBg / 100,
      '--bg-blur-for-none-bg-mask': `${s.bgBlurForNoneBgMask}px`,
      '--bg-dim-for-none-bg-mask': s.bgDimForNoneBgMask / 100,
      '--lyric-font-size': `${s.lyricFontSize}px`,
      '--lyric-romaji-size-em': `${s.lyricRomajiSizeEm}em`,
      '--lyric-translation-size-em': `${s.lyricTranslationSizeEm}em`,
      '--rnp-lyric-original-weight': s.lyricFontWeight,
      '--lyric-timing-function': LYRIC_TIMING_MAP[s.lyricAnimationTiming]
    } as Record<string, string | number>
  })

  // 自定义字体（参考项目 font-settings.js：注入到 body，我们注入到根元素）
  // customFontFamily 是回退链数组，转 CSS font-family 列表('font1', 'font2')
  const fontFamilyStyle = computed(() =>
    settings.customFont && settings.customFontFamily.length > 0
      ? { fontFamily: settings.customFontFamily.map((f) => `'${f}'`).join(', ') }
      : {}
  )

  // 全屏状态 + 切换（对齐参考项目 addFullScreenButton）
  const isFullscreen = ref(false)

  function syncFullscreenState(): void {
    isFullscreen.value = Boolean(document.fullscreenElement)
  }

  async function toggleFullScreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } finally {
      syncFullscreenState()
    }
  }

  function leaveFullscreenIfOwned(): void {
    if (!document.fullscreenElement || !document.exitFullscreen) return
    void document.exitFullscreen().finally(syncFullscreenState)
  }

  /**
   * root class 一一对应参考项目的 body class。参考项目写 document.body，是因为
   * 它要影响整个网易云页面；我们的沉浸层是独立全屏覆盖，所有可见内容都在内部，
   * 写到根元素更干净、不污染全局，关闭时随 v-if 自动消失，无需手动清理。
   */
  const rootClasses = computed(() => ({
    [`display-mode-${effectiveDisplayMode.value}`]: true,
    [`rnp-bg-${settings.backgroundType}`]: true,
    'center-lyric': settings.centerLyric,
    'rnp-shadow': settings.textShadow,
    'rnp-text-glow': settings.textGlow,
    'rnp-bottom-progressbar': settings.bottomProgressbar,
    'lyric-fade': settings.lyricFade,
    'lyric-zoom': settings.lyricZoom,
    'lyric-blur': settings.lyricBlur,
    'lyric-rotate': settings.lyricRotate,
    'lyric-stagger': settings.lyricStagger,
    'lyric-glow': settings.lyricGlow,
    'rectangle-cover': settings.rectangleCover,
    'cover-blurry-shadow': settings.coverBlurryShadow,
    'gradient-bg-dynamic': settings.gradientBgDynamic,
    'static-fluid': settings.staticFluid,
    'rnp-presentation-mode': settings.presentationMode,
    'rnp-full-screen': isFullscreen.value,
    'rnp-idle': idle.value,
    'always-show-bottombar': settings.alwaysShowBottomBar,
    'auto-hide-mini-song-info': settings.autoHideMiniSongInfo,
    'custom-font': settings.customFont && settings.customFontFamily.length > 0,
    [`rnp-${settings.colorScheme}`]: true,
    [`accent-color-${settings.accentColorVariant}`]: true,
    // 贡献者显隐:show/hover/hide 三态,驱动 :deep(.rnp-contributors-inner) 显隐规则
    [`rnp-lyric-contributors-${settings.lyricContributorsDisplay}`]: true,
    [`lyric-timing-${settings.lyricAnimationTiming}`]: true
  }))

  return {
    rootClasses,
    rootStyleVars,
    fontFamilyStyle,
    isFullscreen,
    syncFullscreenState,
    toggleFullScreen,
    leaveFullscreenIfOwned
  }
}
