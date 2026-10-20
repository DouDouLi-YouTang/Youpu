import { ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `use-tilt-layout` 的**测量缓存失效**回归测试（2026-10-11）。
 *
 * 防的是一个完全静默的 bug：`@chenglou/pretext` 按 **(文本, font string)** 缓存测量结果，
 * 而**字体文件加载完成并不会改变 font string** —— CSS 字体栈一个字都没变，只是同一个栈
 * 从「兜底字」换成了「真字形」。于是「字体就绪 → 重测」如果不清缓存，就只是把同一个键
 * 再问一遍，拿回兜底字量出的旧宽度：排版永久按错误的宽度缩放，不报错、不白屏，
 * 只是字号一直偏小。
 *
 * 实测（pretext 0.0.9，开发渲染层，前后用**同一个** font string）：
 *   未就绪 1120.00 → 就绪后不清缓存重测 1120.00 → 就绪后清缓存重测 1030.40，差 8%。
 *
 * 这里用**与 pretext 同构的假缓存**复现该机制，而不是断言源码里有没有 `clearCache`：
 * 「缓存命中与否」是行为，断言源码文本只是同义反复，改个写法就失效。
 *
 * ⚠️ 跑起来会看到一条 `onBeforeUnmount is called when there is no active component instance`
 * 的 Vue 警告，**这是预期的**：这里直接调 hook（没有组件实例），而 hook 内部注册了卸载钩子。
 * 不影响被测行为，不用管它 —— 有它反而说明 hook 真的被执行了。
 */

/** 与 pretext 同构的假测量层：宽度按 (文本, font string) 缓存 */
const spy = vi.hoisted(() => ({
  log: [] as string[],
  /** 当前「真实字体」的宽度。字体加载完成前，canvas 量到的是兜底字的宽度 */
  width: 1600,
  /** key = `${font}|${text}` —— 与 pretext 的 (文本, font) 两级缓存同构 */
  cache: new Map<string, number>()
}))

vi.mock('@chenglou/pretext', () => ({
  clearCache: (): void => {
    spy.log.push('clearCache')
    spy.cache.clear()
  },
  prepareWithSegments: (text: string, font: string): { key: string } => {
    spy.log.push('prepareWithSegments')
    return { key: `${font}|${text}` }
  },
  measureNaturalWidth: (prepared: { key: string }): number => {
    let width = spy.cache.get(prepared.key)
    if (width === undefined) {
      width = spy.width
      spy.cache.set(prepared.key, width)
    }
    return width
  }
}))

import { useTiltLayout } from './use-tilt-layout'

/** 兜底字宽度：1200px 可用宽下溢出比 1.33 → 缩放 0.75 */
const FALLBACK_FONT_WIDTH = 1600
/** 真字体宽度：溢出比 1.083 → 缩放 0.923（比兜底字窄，缩放更少 = 字号更大） */
const REAL_FONT_WIDTH = 1300
const PANEL_WIDTH = 1200

const LINE_TEXT = '把所有的春天都揉进了一个清晨'

/** 造一个布局 hook 实例。stage 高度给足，避免纵向缩放盖住横向缩放的变化 */
function createLayout(fontScale: Ref<number>) {
  return useTiltLayout({
    source: () => ({ text: LINE_TEXT, timeMs: 0, endMs: 5000 }),
    fontScale,
    fontKey: ref<'pending' | 'ready'>('pending'),
    // 只用到 clientWidth / clientHeight 两个属性，不必真造 DOM
    panel: ref({ clientWidth: PANEL_WIDTH } as unknown as HTMLElement),
    stage: ref({ clientHeight: 5000 } as unknown as HTMLElement)
  })
}

beforeEach(() => {
  spy.log.length = 0
  spy.cache.clear()
  spy.width = FALLBACK_FONT_WIDTH
  // use-tilt-layout 只读这几个全局：视口尺寸、根字号、元素字体族。
  // 不装 ResizeObserver：hook 用 `typeof` 守卫，缺了就不观察，正好适合纯函数式验证。
  const g = globalThis as Record<string, unknown>
  g.window = { innerWidth: 1440, innerHeight: 900 }
  g.document = { documentElement: {} }
  g.getComputedStyle = () => ({ fontSize: '16px', fontFamily: "'ZCOOL KuaiLe', sans-serif" })
})

describe('字体标识变化 → 先清测量缓存再重测', () => {
  it('fontKey 变化时重测拿到新字体的宽度（不清缓存会命中旧条目、字号原地不动）', () => {
    const fontKey = ref<'pending' | 'ready'>('pending')
    const { layout } = useTiltLayout({
      source: () => ({ text: LINE_TEXT, timeMs: 0, endMs: 5000 }),
      fontScale: ref(1),
      fontKey,
      panel: ref({ clientWidth: PANEL_WIDTH } as unknown as HTMLElement),
      stage: ref({ clientHeight: 5000 } as unknown as HTMLElement)
    })

    const before = layout.value
    expect(before, '布局应能测出来（宽度、文本都齐）').not.toBeNull()
    expect(before!.measured, 'pretext 被 mock 成可用，measured 应为 true').toBe(true)

    // 「字体加载完成」：真字形比兜底字窄，同时 fontKey 从 pending 翻到 ready
    spy.width = REAL_FONT_WIDTH
    spy.log.length = 0
    fontKey.value = 'ready'

    const after = layout.value
    expect(after).not.toBeNull()

    // 关键断言一：清缓存必须发生在重测**之前**。顺序错了（例如 flush 从 sync 改回 pre）
    // 这里就是 'prepareWithSegments' —— 那次重测量到的仍是兜底字宽度。
    expect(spy.log[0], 'fontKey 变化后必须先清缓存').toBe('clearCache')
    expect(spy.log).toContain('prepareWithSegments')

    // 关键断言二：结果真的变了。窄字 → 溢出少 → 缩放更少 → 字号更大。
    expect(after!.scale).toBeGreaterThan(before!.scale)
    expect(after!.fontPx).toBeGreaterThan(before!.fontPx)
  })

  it('字号倍率变化（字体没变）不清缓存 —— 否则窗口缩放的重测全都白测', () => {
    const fontScale = ref(1)
    const { layout } = createLayout(fontScale)
    const before = layout.value
    expect(before).not.toBeNull()

    spy.log.length = 0
    fontScale.value = 0.8
    const scaled = layout.value
    expect(scaled).not.toBeNull()

    // 重测发生了（字号倍率是测量入参），但缓存不该被清
    expect(spy.log).toContain('prepareWithSegments')
    expect(spy.log, '字体没变就不该清缓存').not.toContain('clearCache')
    expect(scaled!.fontPx).toBeLessThan(before!.fontPx)
  })
})
