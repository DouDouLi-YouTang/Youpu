import { describe, expect, it } from 'vitest'

import {
  createDefaultSettings,
  FLUID_BLUR_MAP,
  FLUID_FPS_MAP,
  LYRIC_TIMING_MAP,
  PERSIST_KEY,
  type ImmersiveSettings
} from './immersive-settings.model'

/**
 * 沉浸设置**纯数据层**的单测。这一层刻意不依赖 pinia / localStorage（vitest 是 node
 * 环境，没有 jsdom），所以可以直接断言；store 侧的接线（水合 / 迁移 / 写回）连同
 * localStorage stub 一起在 `immersive-settings.migrate.test.ts`。
 *
 * 锁三件容易在重构里悄悄坏掉的事：
 *  1. `createDefaultSettings()` 每次都要造出**互相独立**的一份 —— 默认值若是模块级共享的
 *     数组，「改一份」会串到所有以默认值起步的地方（store 的每一次水合、以后别处的新实例）；
 *  2. 字段集合必须与 `ImmersiveSettings` 类型严丝合缝（多一个未声明的键 / 少一个已声明的
 *     键都在这里炸，而不是等用户设置丢了才发现）。注意 `skin` **不在**设置里：
 *     它是「当前在放哪个面板」的全局项，只属于 store（见 model 顶部说明）；
 *  3. 常量表是渲染层与迁移层的单一真源，既存档位必须查得到值。
 */

/**
 * 与 `ImmersiveSettings` 接口一一对应的字段清单（保持字典序）。
 * `satisfies` 在**编译期**挡下清单里写错的键；下面的运行期断言再挡下模型里漏写的键。
 * Folia 三套主题不读经典外观字段（背景 / 封面 / 歌词排版 / 字体），但它们仍属这份设置，
 * 不因为 Folia 不读而少一行 —— 所以清单是整份接口，不是某个面板的消费清单。
 */
const EXPECTED_KEYS = [
  'accentColorVariant',
  'albumSize',
  'alwaysShowBottomBar',
  'autoHideMiniSongInfo',
  'backgroundType',
  'bgBlur',
  'bgBlurForNoneBgMask',
  'bgDim',
  'bgDimForFluidBg',
  'bgDimForGradientBg',
  'bgDimForNoneBgMask',
  'bottomProgressbar',
  'centerLyric',
  'colorScheme',
  'coverBlurryShadow',
  'coverHAlign',
  'coverVAlign',
  'currentLyricAlignmentPercentage',
  'customFont',
  'customFontFamily',
  'displayMode',
  'enableProgressbarPreview',
  'fluidBlur',
  'fluidMaxFramerate',
  'folia',
  'gradientBgDynamic',
  'karaokeAnimation',
  'lyricAnimationTiming',
  'lyricBlur',
  'lyricContributorsDisplay',
  'lyricFade',
  'lyricFontSize',
  'lyricFontWeight',
  'lyricGlow',
  'lyricOffset',
  'lyricRomajiSizeEm',
  'lyricRotate',
  'lyricStagger',
  'lyricTranslationSizeEm',
  'lyricZoom',
  'presentationMode',
  'rectangleCover',
  'rotateCurvature',
  'songInfoAlign',
  'staticFluid',
  'subtitleContentMode',
  'textGlow',
  'textShadow',
  'timeIndicator'
] as const satisfies readonly (keyof ImmersiveSettings)[]

describe('createDefaultSettings 每份设置互相独立', () => {
  it('每次调用都是全新对象，改一份不影响另一份', () => {
    const a = createDefaultSettings()
    const b = createDefaultSettings()
    expect(a).not.toBe(b)
    a.lyricFontSize = 1
    expect(b.lyricFontSize).toBe(32) // 另一份仍是默认值
  })

  it('customFontFamily 是各自的新数组（共享同一数组会让两份设置互相串改）', () => {
    const a = createDefaultSettings()
    const b = createDefaultSettings()
    expect(a.customFontFamily).not.toBe(b.customFontFamily)
    a.customFontFamily.push('OnlyA')
    expect(b.customFontFamily).not.toContain('OnlyA')
  })
})

describe('createDefaultSettings 字段集合与 ImmersiveSettings 类型一致', () => {
  it('键集合逐字等于维护的清单（多键 / 漏键都会在这里失败）', () => {
    expect(Object.keys(createDefaultSettings()).sort()).toEqual(EXPECTED_KEYS)
    // skin 是 store 的全局项（当前在放哪个面板），绝不能混进设置 —— 混进来就等于又按面板分家了
    expect(Object.keys(createDefaultSettings())).not.toContain('skin')
  })
})

describe('createDefaultSettings 与其他模块耦合的默认值（改动属于产品决策，同步改本测试）', () => {
  it('字号基准 32 / 不限帧 / 最高模糊档 / 流体背景 / 封面 800', () => {
    const s = createDefaultSettings()
    // 经典面板的歌词字号默认 32px（倾诉不读这一项，它的字号是 tilt-adapter 的内置 clamp 档）
    expect(s.lyricFontSize).toBe(32)
    // 默认最高档：帧率不限（FLUID_FPS_MAP[4] = Infinity）、模糊 128px
    expect(s.fluidMaxFramerate).toBe(4)
    expect(s.fluidBlur).toBe(7)
    // 背景默认流体（对齐参考实现 getSetting('background-type', 'fluid')）
    expect(s.backgroundType).toBe('fluid')
    expect(s.bgDim).toBe(55)
    // 封面默认 800（ImmersiveCover 会再与视口取 min，不易撑破布局）
    expect(s.albumSize).toBe(800)
  })

  it('字体回退链默认是数组（use-backdrop 会对它 .map，字符串会直接抛 TypeError）', () => {
    expect(createDefaultSettings().customFontFamily).toEqual([
      'Microsoft JhengHei UI',
      'Microsoft JhengHei'
    ])
  })

  it('副字幕默认「罗马音 + 译文」两行（2026-10-15 用户定：保留两行，但要能关）', () => {
    // 上游默认是 'translation'（只译文），本项目刻意取 'both' —— 这条断言的作用是
    // 拦住「顺手对齐上游默认值」的改动：那会让底栏悄悄少一行，且没有任何报错。
    expect(createDefaultSettings().subtitleContentMode).toBe('both')
  })

  it('Folia 专属设置默认跟随歌曲、原生背景、逐词着色，且与经典设置互相独立', () => {
    const s = createDefaultSettings()
    expect(s.folia).toEqual({
      colorScheme: 'dark',
      subtitleContentMode: 'both',
      subtitleBlur: true,
      colorMode: 'song',
      backgroundModes: {
        tilt: 'native',
        glow: 'native',
        fume: 'native'
      },
      fonts: {
        tilt: { custom: false, families: [], weight: null },
        glow: { custom: false, families: [], weight: null },
        fume: { custom: false, families: [], weight: null }
      },
      backgroundOpacity: 100,
      backgroundBlur: 0,
      wordColoring: true,
      showFps: false
    })
    // 改动 Folia 的明暗或副字幕不会污染经典字段
    s.folia.colorScheme = 'light'
    s.folia.subtitleContentMode = 'none'
    expect(s.colorScheme).toBe('dark')
    expect(s.subtitleContentMode).toBe('both')
  })

  it('Folia 默认对象每次都是新对象（共享嵌套对象会让多个实例串改）', () => {
    const a = createDefaultSettings()
    const b = createDefaultSettings()
    expect(a.folia).not.toBe(b.folia)
    expect(a.folia.backgroundModes).not.toBe(b.folia.backgroundModes)
    expect(a.folia.fonts).not.toBe(b.folia.fonts)
    expect(a.folia.fonts.tilt).not.toBe(a.folia.fonts.glow)
    expect(a.folia.fonts.tilt).not.toBe(a.folia.fonts.fume)
    expect(a.folia.fonts.glow).not.toBe(a.folia.fonts.fume)
    expect(a.folia.fonts.tilt.families).not.toBe(a.folia.fonts.glow.families)
    expect(a.folia.fonts.tilt.families).not.toBe(a.folia.fonts.fume.families)
    expect(a.folia.fonts.glow.families).not.toBe(a.folia.fonts.fume.families)
    for (const skin of ['tilt', 'glow', 'fume'] as const) {
      expect(a.folia.fonts[skin]).not.toBe(b.folia.fonts[skin])
      expect(a.folia.fonts[skin].families).not.toBe(b.folia.fonts[skin].families)
    }
    a.folia.colorMode = 'mono'
    a.folia.backgroundModes.tilt = 'sora'
    a.folia.fonts.tilt.custom = true
    a.folia.fonts.tilt.families.push('OnlyA')
    expect(b.folia.colorMode).toBe('song')
    expect(b.folia.backgroundModes.tilt).toBe('native')
    expect(b.folia.fonts.tilt).toEqual({ custom: false, families: [], weight: null })
  })
})

describe('常量表', () => {
  it('LYRIC_TIMING_MAP：四个键都有值、均为 cubic-bezier、互不相同', () => {
    expect(Object.keys(LYRIC_TIMING_MAP).sort()).toEqual(['easeout', 'lazy', 'sharp', 'smooth'])
    const values = Object.values(LYRIC_TIMING_MAP)
    for (const value of values) expect(value).toMatch(/^cubic-bezier\(/)
    // 四条曲线若出现重复，等于某个选项名存实亡
    expect(new Set(values).size).toBe(4)
  })

  it('LYRIC_TIMING_MAP 的曲线值与参考实现逐字一致（改值 = 改动画观感）', () => {
    expect(LYRIC_TIMING_MAP).toEqual({
      smooth: 'cubic-bezier(0.18, 0.77, 0.58, 0.99)',
      sharp: 'cubic-bezier(0.54, 0, 0.16, 1)',
      lazy: 'cubic-bezier(0.32, 0.72, 0, 1)',
      easeout: 'cubic-bezier(0, 0.55, 0.45, 1)'
    })
  })

  it('FLUID_FPS_MAP：档位 0–4，逐档升高，最高档不限帧', () => {
    expect(FLUID_FPS_MAP).toEqual({ 0: 5, 1: 10, 2: 30, 3: 60, 4: Infinity })
    const fps = [0, 1, 2, 3, 4].map((level) => FLUID_FPS_MAP[level])
    for (let index = 1; index < fps.length; index++) {
      expect(fps[index]).toBeGreaterThan(fps[index - 1])
    }
    // 「不限帧」用 Infinity 表达：渲染层据此跳过帧率节流，改成大数字就失去这个语义
    expect(FLUID_FPS_MAP[4]).toBe(Infinity)
  })

  it('FLUID_BLUR_MAP：档位 5–7 → 32/64/128px，逐档变强', () => {
    expect(FLUID_BLUR_MAP).toEqual({ 5: 32, 6: 64, 7: 128 })
    expect(FLUID_BLUR_MAP[7]).toBeGreaterThan(FLUID_BLUR_MAP[6])
    expect(FLUID_BLUR_MAP[6]).toBeGreaterThan(FLUID_BLUR_MAP[5])
  })

  it('默认档位在常量表里查得到（改了默认值却忘改表 → 渲染层拿到 undefined）', () => {
    const s = createDefaultSettings()
    expect(FLUID_FPS_MAP[s.fluidMaxFramerate]).toBeTypeOf('number')
    expect(FLUID_BLUR_MAP[s.fluidBlur]).toBeTypeOf('number')
    expect(LYRIC_TIMING_MAP[s.lyricAnimationTiming]).toBeTruthy()
  })

  it('PERSIST_KEY 保持历史值（迁移按它直读旧数据，改名就读不到）', () => {
    expect(PERSIST_KEY).toBe('immersive-settings')
  })
})
