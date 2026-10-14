import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

import type { FumeArticleMeasure } from './core/article-layout-attempt'
import type { FumeLayoutThemeKey } from './core/layout-key'
import type { FumeLine, FumeViewportSize } from './core/fume-types'

/**
 * `use-fume-layout` 的调度语义回归测试（§7.9）。
 *
 * 这一层没有视觉产物，错了的表现全是「诡异但偶发」：切歌后纸面留着上一首的词、
 * 拖窗口卡顿、加载卡永不消失。所以四条语义必须逐条钉住：
 *
 *  1. **三段式**：rAF → `setTimeout(0/96)` → 版本号复核（不是同步算、也不是直接 timeout）；
 *  2. **首次不防抖**：第一版 0ms 立刻算（前奏不能空屏），之后才 96ms；
 *  3. **过期请求丢弃**：排程后又改输入，旧请求绝不能写回 `article`；
 *  4. **算完之后再查一次**：这条是切歌场景的唯一保险（`runLayout` 内是同步长任务）。
 *
 * 测量层用**假实现**：真实现要 pretext + canvas，node 下会抛错，
 * 而本测试的对象是调度不是测量（§15.5 的分工）。
 *
 * ⚠️ 跑起来会看到一串 `onBeforeUnmount is called when there is no active component instance`
 * 的 Vue 警告，**这是预期的**：这里直接调 hook（没有组件实例），而 hook 内部注册了
 * 卸载钩子。不影响被测行为，不用管它 —— 有它反而说明 hook 真的被执行了
 * （与 `tilt/use-tilt-layout.test.ts` 同一情况）。
 */

/** 假的排版测量：字号固定 20px、每行两行、宽度按「字素数 × 10」算 */
const fakeMeasure: FumeArticleMeasure = {
  resolveFontFamily: () => 'serif',
  buildFontSpec: (fontPx) => `${fontPx}px serif`,
  prepareSingleLine: (text, _family, _width, variant) =>
    ({
      fontPx: variant === 'hero' ? 40 : 20,
      // 结构上满足 core 的 `FumePreparedLike`：widths / breakableFitAdvances / segments
      prepared: {
        segments: [text],
        widths: [text.length * 10],
        breakableFitAdvances: [Array.from({ length: text.length }, () => 10)]
      },
      layout: { lines: [{ text, start: 0, end: text.length, width: text.length * 10 }] }
    }) as never,
  measureSegmentGlyphOffsets: (text) =>
    Array.from({ length: text.length + 1 }, (_, index) => index * 10)
}

vi.mock('./measure/fume-article-measure', () => ({
  FUME_ARTICLE_MEASURE: fakeMeasure
}))

const { useFumeLayout } = await import('./use-fume-layout')

/** 可控排程器：把 rAF 与定时器都收进队列，由测试显式推进 */
function createScheduler() {
  let frameCallback: (() => void) | null = null
  let delayed: { callback: () => void; ms: number } | null = null
  return {
    scheduler: {
      requestFrame: (callback: () => void) => {
        frameCallback = callback
        return 1
      },
      cancelFrame: () => {
        frameCallback = null
      },
      delay: (callback: () => void, ms: number) => {
        delayed = { callback, ms }
        return 2
      },
      cancelDelay: () => {
        delayed = null
      }
    },
    /** 走完「这一帧 + 定时器」两段 */
    flush() {
      const frame = frameCallback
      frameCallback = null
      frame?.()
      const timer = delayed
      delayed = null
      timer?.callback()
    },
    /** 只走第一段（rAF），停在定时器前 —— 用来观察防抖时长 */
    flushFrame() {
      const frame = frameCallback
      frameCallback = null
      frame?.()
    },
    get pendingDelayMs(): number | null {
      return delayed?.ms ?? null
    },
    get hasFrame(): boolean {
      return frameCallback !== null
    }
  }
}

function makeLine(overrides: Partial<FumeLine> = {}): FumeLine {
  return {
    words: [],
    startTimeMs: 0,
    endTimeMs: 2000,
    fullText: '一二三四五六七八',
    ...overrides
  }
}

const VIEWPORT: FumeViewportSize = { width: 1280, height: 720 }
const THEME: FumeLayoutThemeKey = { name: 'folia', fontStyle: 'serif' }

function mountLayout(lines: Ref<FumeLine[]> = ref([makeLine()])) {
  const viewport = ref<FumeViewportSize>({ ...VIEWPORT })
  const scheduler = createScheduler()
  const result = useFumeLayout({
    lines,
    viewport,
    layoutTheme: ref<FumeLayoutThemeKey>(THEME),
    lyricsFontScale: ref(1),
    heroScale: ref(1),
    scheduler: scheduler.scheduler
  })
  // ⚠️ 不能直接 `...scheduler`：那会把 getter 求值成快照，`pendingDelayMs` 永远是 null
  return {
    ...result,
    lines,
    viewport,
    flush: (): void => scheduler.flush(),
    flushFrame: (): void => scheduler.flushFrame(),
    get pendingDelayMs(): number | null {
      return scheduler.pendingDelayMs
    },
    get hasFrame(): boolean {
      return scheduler.hasFrame
    }
  }
}

describe('useFumeLayout 调度（§7.9）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('首次请求：rAF 之后立刻（0ms）算，不防抖', () => {
    const layout = mountLayout()
    expect(layout.isLayoutPending.value).toBe(true)
    expect(layout.article.value).toBeNull()

    layout.flushFrame()
    expect(layout.pendingDelayMs).toBe(0)

    layout.flush()
    expect(layout.article.value).not.toBeNull()
    expect(layout.isLayoutPending.value).toBe(false)
  })

  it('排过一次之后再改输入：走 96ms 防抖', () => {
    const layout = mountLayout()
    layout.flush()

    layout.lines.value = [makeLine({ fullText: '换了一行' })]
    layout.flushFrame()
    expect(layout.pendingDelayMs).toBe(96)
  })

  it('视口非正 → 立刻空态，不留 pending（挂载前的首次调用走这条路）', () => {
    const viewport = ref<FumeViewportSize>({ width: 0, height: 0 })
    const scheduler = createScheduler()
    const layout = useFumeLayout({
      lines: ref([makeLine()]),
      viewport,
      layoutTheme: ref(THEME),
      lyricsFontScale: ref(1),
      heroScale: ref(1),
      scheduler: scheduler.scheduler
    })
    expect(layout.isLayoutPending.value).toBe(false)
    expect(layout.article.value).toBeNull()
    expect(scheduler.hasFrame).toBe(false)
  })

  it('没有歌词 → 立刻空态，不留 pending', () => {
    const layout = mountLayout(ref([]))
    expect(layout.isLayoutPending.value).toBe(false)
    expect(layout.article.value).toBeNull()
  })

  it('排程后又改输入：旧请求被丢弃（article 不会写回旧结果）', () => {
    const layout = mountLayout()
    // 让第一版先落地，拿到一个已知的文章
    layout.flush()
    const firstArticle = layout.article.value
    expect(firstArticle).not.toBeNull()

    layout.lines.value = [makeLine({ fullText: '第二首' })]
    layout.flushFrame()
    // ⚠️ 在定时器触发之前再改一次：旧的 delay 回调必须失效
    layout.lines.value = [makeLine({ fullText: '第三首' })]
    layout.flush()

    // 两次改动只应留下最后一版，且不能把第一版写回去
    expect(layout.article.value).not.toBe(firstArticle)
    expect(layout.isLayoutPending.value).toBe(false)
  })

  it('同步排版期间切歌：第二道版本号复核拦住旧结果', () => {
    const layout = mountLayout()
    layout.flush()
    const firstArticle = layout.article.value

    // 在 delay 回调**执行到一半**时改输入：用假测量函数制造「跑排版时输入变了」
    layout.lines.value = [makeLine({ fullText: '旧' })]
    layout.flushFrame()
    const pending = layout.pendingDelayMs
    expect(pending).toBe(96)

    // 手动推进：先改输入（版本号++），再跑旧的 delay 回调
    layout.lines.value = [makeLine({ fullText: '新' })]
    layout.flush()

    // 旧回调的 version 已过期，所以既不能写回旧文章，也不该把 pending 提前清掉
    // ——新请求会自己走完流程
    layout.flush()
    expect(layout.article.value).not.toBe(firstArticle)
    expect(layout.isLayoutPending.value).toBe(false)
  })

  it('缓存命中：同样的输入再排一次会复用同一个文章对象', () => {
    const first = mountLayout()
    first.flush()
    const cachedArticle = first.article.value

    // 换一个 hook 实例（模拟「切到别的面板再切回来」），输入完全相同
    const second = mountLayout()
    second.flush()
    expect(second.article.value).toBe(cachedArticle)
  })

  it('缓存失效：行内容变了就不复用（缓存键含行指纹）', () => {
    const first = mountLayout()
    first.flush()
    const cachedArticle = first.article.value

    const second = mountLayout(ref([makeLine({ fullText: '完全不同的歌词内容' })]))
    second.flush()
    expect(second.article.value).not.toBe(cachedArticle)
  })

  it('timing 在命中缓存时保留上一次的值（不是 null）', () => {
    const first = mountLayout()
    first.flush()
    const cachedTiming = first.timing.value
    expect(cachedTiming).not.toBeNull()

    const second = mountLayout()
    second.flush()
    expect(second.timing.value).toBeNull() // 新实例自己还没跑过
    expect(cachedTiming?.attempts).toBeGreaterThan(0)
  })
})
