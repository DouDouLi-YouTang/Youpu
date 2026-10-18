import { computed, ref } from 'vue'

import { LYRIC_TIMING_MAP, useImmersiveSettingsStore } from '../../immersive-settings.store'
import { useEffectiveDisplayMode } from '../../use-skin-context'
import { useImmersivePlayer } from '../../use-immersive-player'
import { useActiveSkin } from '../registry'

/**
 * 背景层渲染参数 —— `rootClasses` / `rootStyleVars` / `fontFamilyStyle` 的唯一来源
 * （挂在皮肤外壳的根 section 上，驱动背景、歌词、封面的全部视觉分支），并一并持有
 * 自定义字体与全屏状态。
 *
 * ⚠️ **分两档注入**：
 *
 *  - **面板外观档** —— 只在当前面板是经典时注入（`SkinDefinition.settingsKind`）。
 *    这一档回答的是「经典长什么样」：显示模式、背景类型、歌词排版动画、封面造型、
 *    自定义字体、歌词字号 / 译文倍率……Folia 三套主题有自己的外观设置，整档跳过。
 *  - **沉浸页通用档** —— **无条件**注入。这些不是面板外观，而是「这一页 / 这个播放器」
 *    的行为：明暗主题、专辑主色、底栏四项、演示模式、空闲态。换了面板它们照样该生效
 *    （用户拍板：所有面板都跟随这些）。
 *
 * 判据放在**皮肤定义**上而不是这里的 if 里：新增面板时由 `SkinDefinition.settingsKind`
 * 强制表态（编译期就要求写上），不会出现「新面板默默继承了经典的全套外观」。
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
  const activeSkin = useActiveSkin()
  const { idle } = useImmersivePlayer()
  const effectiveDisplayMode = useEffectiveDisplayMode()

  // 全屏状态 + 切换（对齐参考项目 addFullScreenButton）
  const isFullscreen = ref(false)

  /** 当前面板是否套用经典那套面板外观参数。见文件头两档说明。 */
  const usesPanelSettings = computed(() => activeSkin.value.settingsKind === 'classic')

  /**
   * Folia 三套主题的明暗是独立设置；经典继续读顶层 `colorScheme`。
   * 外壳文字色、控制条、设置面板背景都挂在同一个明暗 class 上，所以这里必须
   * 按设置种类取，而不是让 Folia 的白天/夜间只影响歌词调色板。
   */
  const activeColorScheme = computed(() =>
    activeSkin.value.settingsKind === 'folia' ? settings.folia.colorScheme : settings.colorScheme
  )

  /**
   * **沉浸页通用档**的 class —— 任何面板都注入。这些不是「面板长什么样」，
   * 而是沉浸页这一层自己的状态（明暗 / 主色 / 底栏 / 演示模式 / 全屏 / 空闲）。
   */
  const commonClasses = computed<Record<string, boolean>>(() => ({
    'rnp-presentation-mode': settings.presentationMode,
    'rnp-full-screen': isFullscreen.value,
    'rnp-idle': idle.value,
    // 底栏四项：控制条自己的行为，所有面板都跟随
    'always-show-bottombar': settings.alwaysShowBottomBar,
    'rnp-bottom-progressbar': settings.bottomProgressbar,
    // 明暗主题与专辑主色：沉浸页整体配色，与「哪个面板」无关
    [`rnp-${activeColorScheme.value}`]: true,
    [`accent-color-${settings.accentColorVariant}`]: true
  }))

  /**
   * 把参数的 CSS 变量形式注入到沉浸层根元素。子组件（背景、歌词、控制条）直接读取这些
   * 变量，无需通过 props 逐层传递 —— 与参考项目 bindSliderToCSSVariable 把滑块值写到
   * document style 的做法等价，只是作用域收到沉浸层内部。
   *
   * 全是**面板外观**参数（背景模糊 / 暗化 / 歌词字号 / 译文倍率 / 字重 / 动画曲线），
   * 所以 Folia 三套主题（`settingsKind === 'folia'`）拿到空对象：它们的歌词字号与
   * 译文倍率由各自适配层固定，不从根元素继承。
   */
  const rootStyleVars = computed(() => {
    if (!usesPanelSettings.value) return {}
    return {
      '--bg-blur': `${settings.bgBlur}px`,
      '--bg-dim': settings.bgDim / 100,
      '--bg-dim-for-gradient-bg': settings.bgDimForGradientBg / 100,
      '--bg-dim-for-fluid-bg': settings.bgDimForFluidBg / 100,
      '--bg-blur-for-none-bg-mask': `${settings.bgBlurForNoneBgMask}px`,
      '--bg-dim-for-none-bg-mask': settings.bgDimForNoneBgMask / 100,
      '--lyric-font-size': `${settings.lyricFontSize}px`,
      '--lyric-romaji-size-em': `${settings.lyricRomajiSizeEm}em`,
      '--lyric-translation-size-em': `${settings.lyricTranslationSizeEm}em`,
      '--rnp-lyric-original-weight': settings.lyricFontWeight,
      '--lyric-timing-function': LYRIC_TIMING_MAP[settings.lyricAnimationTiming]
    } as Record<string, string | number>
  })

  // 自定义字体（参考项目 font-settings.js：注入到 body，我们注入到根元素）
  // customFontFamily 是回退链数组，转 CSS font-family 列表('font1', 'font2')
  //
  // Folia 三套主题拿到空对象：**自定义字体是「经典」的设置**（Folia 外观固定），
  // 这里不注入就是「不覆盖」。倾诉自己的字体是 tilt.scss 里的内置栈
  // （'ZCOOL KuaiLe', 'M PLUS Rounded 1c', sans-serif，2026-10-11 定）；
  // 它的排版测量（use-tilt-layout 的 readFontFamily）从 DOM 读 computed style，
  // 读到的正是那个内置栈 —— 而不是「应用默认字体」（那是加内置字体之前的说法）。
  const fontFamilyStyle = computed(() => {
    if (!usesPanelSettings.value) return {}
    return settings.customFont && settings.customFontFamily.length > 0
      ? { fontFamily: settings.customFontFamily.map((f) => `'${f}'`).join(', ') }
      : {}
  })

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
   *
   * 分两档见文件头：面板外观档只在 `usesPanelSettings` 为真时并入。
   */
  const rootClasses = computed(() => {
    if (!usesPanelSettings.value) return commonClasses.value
    return {
      ...commonClasses.value,
      [`display-mode-${effectiveDisplayMode.value}`]: true,
      [`rnp-bg-${settings.backgroundType}`]: true,
      'center-lyric': settings.centerLyric,
      'rnp-shadow': settings.textShadow,
      'rnp-text-glow': settings.textGlow,
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
      'auto-hide-mini-song-info': settings.autoHideMiniSongInfo,
      'custom-font': settings.customFont && settings.customFontFamily.length > 0,
      // 贡献者显隐:show/hover/hide 三态,驱动 :deep(.rnp-contributors-inner) 显隐规则
      [`rnp-lyric-contributors-${settings.lyricContributorsDisplay}`]: true,
      [`lyric-timing-${settings.lyricAnimationTiming}`]: true
    }
  })

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
