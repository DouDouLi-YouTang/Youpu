/**
 * 「浮名」文章排版的**调度层**（移植规格书 §7.9）。
 *
 * ## 为什么排版不能直接写在 `computed` 里
 *
 * §7.8 的顶层要跑「列数 × 8 次二分」的完整排版（最坏 32 次 measure + 1 次 render），
 * 每次都要调 pretext 换行并逐字素测量。放进 `computed` 的后果是：任何一次响应式
 * 求值（模板渲染、watch、别的 computed）都可能触发它，一帧内跑两三次 ——
 * 窗口拖动时就是几十次完整排版，主线程直接卡住。
 *
 * 所以照搬上游的三段式：
 * ```
 * 版本号++  →  rAF  →  setTimeout(0 / 96)  →  版本号复核  →  跑排版  →  版本号再复核
 * ```
 * 三段的作用各不相同：
 * - **rAF**：把工作让到下一帧，且与渲染节奏对齐（同一帧里多次改输入只跑一次）；
 * - **setTimeout**：首次 `0`（立刻算，前奏里不能等），之后 `96ms` 防抖
 *   （拖动窗口时只在停下来之后排一次）；
 * - **版本号**：丢弃过期请求。
 *
 * ## 排版本身也是可中断的（性能修复，2026-10-14）
 *
 * 三段式只决定了「什么时候**开始**排版」，不决定「开始之后占住主线程多久」。
 * 实测 50 行 ≈ 1.0s、120 行 ≈ 3.1s 的同步排版在拖动窗口 / 切歌时会整屏冻住，
 * 因为期间一帧都出不来。所以第四步改成了**分片执行**：
 * ```
 * 版本号++  →  rAF  →  setTimeout(0 / 96)  →  版本号复核  →  分片跑排版（每片 ≤ 8ms）
 *                                                        ↑____________ 让出主线程 ______|
 * ```
 * 分片由 `core/article-layout-chunked.ts` 驱动，每片结束时 `await` 一次让出主线程，
 * 画面继续出帧。**排版结果与原来逐字相同**（同一套参数、同一个顺序），
 * 变的只是「什么时候让出」。
 *
 * 取消链路沿用同一个版本号：分片每片开头问一次 `shouldAbort`，所以切歌 / 再次
 * resize 之后，旧任务最多再跑完当前这一片（≤ 8ms + 一块的溢出）就作废，
 * 绝不会写回旧结果。
 *
 * ## 版本号为什么检查两次
 *
 * `buildArticleLayout` 是**同步长任务** —— 它跑的时候主线程是死的，但跑完之后
 * 可能用户已经切歌了（新的 schedule 把版本号推高了）。所以：
 * 1. 进回调先查一次：从排程到现在这段时间里输入可能已经变了；
 * 2. 算完再查一次：**这一条才是关键**，因为「算到一半换歌」正是最坏情况 ——
 *    只有第一次检查的话，旧歌的文章会覆盖新歌的 `article`，表现为「切歌后
 *    纸面上还是上一首的词」，且不会自己恢复。
 *
 * ## 缓存为什么是模块级、只有一条
 *
 * 上游的 `lastFumeLayoutCache` 就是模块级单条（§16.1）。理由：同一时刻只有一首歌
 * 在播，而「切歌再切回来」是常见操作（上一首 → 下一首 → 上一首）——
 * 单条缓存就能让回退的那一次瞬间命中，不必重排。
 * 键（§7.1）已经精确覆盖了全部影响几何的输入，所以不需要额外的失效通知。
 *
 * ⚠️ 缓存里存的是**含 `Map` 的文章对象**，绝不能放进 `reactive`/深 `ref`（§17.3 第 10 条），
 * 所以对外暴露的是 `shallowRef`。
 *
 * ## 视口为什么由 `FumeStage` 上报，而不是这里自己观察
 *
 * §7.10 的上游做法是 ResizeObserver 观察舞台容器，并在尺寸不变时**保持同一个对象**。
 * 本项目已经有 `components/FumeStage.vue` 在做同一件事（同一个元素、同一套
 * `borderBoxSize` 回退逻辑），且它已经是绘制层与相机的共同尺寸来源。
 * 再观察一次同一个元素只会得到第二条 `ResizeObserver`，而两条的触发时机不保证一致 ——
 * 会出现「画布已按新尺寸绘制、排版还用旧尺寸」的帧。
 * 所以这里把「视口从哪来」上提成入参，本层只负责**调度与缓存**，不做第二次观察。
 */

import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'

import type { FumeArticleLayoutTiming } from './core/article-layout'
import { buildArticleLayoutChunked } from './core/article-layout-chunked'
import { buildLayoutCacheKey, type FumeLayoutThemeKey } from './core/layout-key'
import type { FumeArticleLayout, FumeLine, FumeViewportSize } from './core/fume-types'
import { FUME_ARTICLE_MEASURE } from './measure/fume-article-measure'

/**
 * 重建文章布局的防抖时长（毫秒，§7.9 的上游常量 `LAYOUT_REBUILD_DEBOUNCE_MS = 96`）。
 *
 * 为什么首次不用它：进面板时视口刚量到、文章还没有 —— 此时每一毫秒都是「背景在转、
 * 却没字」的空屏，96ms 的等待纯属浪费。所以只有**已经排过一版**（`hasResolvedArticle`）
 * 之后才防抖，那条路径对应的场景是「用户在拖窗口」，多等 96ms 完全无感。
 */
export const LAYOUT_REBUILD_DEBOUNCE_MS = 96

/**
 * 模块级布局缓存（§16.1「整篇文章布局」一行）。
 *
 * 键 = `buildLayoutCacheKey(...)`（§7.1），只留最近一条。切成两条以上会引入
 * 「哪条该淘汰」的策略问题，而这里根本没有第二个消费场景。
 */
interface FumeLayoutCacheEntry {
  /** §7.1 的排版缓存键 */
  key: string
  /**
   * 建这一版时的字体就绪信号（见 `UseFumeLayoutOptions.fontKey`）。
   *
   * ⚠️ 它**不参与** §7.1 的键，因为那个键的字段集合是上游定的契约（字体栈 / 倍率 / 行指纹）。
   * 但本项目必须额外看这一项：字体栈字符串不变、字宽却变了，只查 `key` 会命中旧文章。
   * 所以它是缓存条目的**第二个判据**，而不是键的一部分 —— 这样也就不会出现
   * 「字体就绪后缓存键变化」这种对调试日志有误导的表象。
   */
  fontKey: unknown
  article: FumeArticleLayout | null
}

let lastFumeLayoutCache: FumeLayoutCacheEntry | null = null

/** 排程函数集合：注入是为了让单测能确定性地推进 rAF / 定时器 */
export interface FumeLayoutScheduler {
  requestFrame(callback: () => void): number
  cancelFrame(id: number): void
  delay(callback: () => void, ms: number): number
  cancelDelay(id: number): void
  /**
   * 让出主线程一次（分片排版的「下一片可以跑了」信号）。
   *
   * 为什么不用 `setTimeout(0)`：定时器有 4ms 的嵌套下限，33 片就是 130ms 起步，
   * 而且它排在同优先级的定时器队列里，会被别的定时器插队。
   * 为什么不用 `requestAnimationFrame`：那样每片都要等一整帧（16.7ms），
   * 排版总时长直接翻倍，而分片的目的是「不卡」而不是「慢」。
   * `MessageChannel` 的 `postMessage` 是一次**宏任务**：让得干净（同一片里不会再被
   * 微任务续上）、又没有额外延迟。Electron 渲染进程一定有它。
   */
  yieldToMainThread(): Promise<void>
}

/**
 * 默认排程器：浏览器用 rAF + `setTimeout`；没有 rAF 的环境（node 单测）退化成
 * `setTimeout(cb, 16)`。
 *
 * ⚠️ 退化只影响**什么时候**跑，不影响跑什么：两段式（帧 → 延时）的结构、
 * `0 / 96ms` 的取值、两次版本号复核都保持原样。生产路径在 Electron 渲染进程里
 * 一定有 rAF，所以这条退化分支在线上不会被走到。
 */
export const DEFAULT_FUME_LAYOUT_SCHEDULER: FumeLayoutScheduler = {
  requestFrame(callback) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
    return setTimeout(callback, 16) as unknown as number
  },
  cancelFrame(id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id)
  },
  delay(callback, ms) {
    return setTimeout(callback, ms) as unknown as number
  },
  cancelDelay(id) {
    clearTimeout(id)
  },
  yieldToMainThread() {
    // ⚠️ 每次都新建一条 `MessageChannel`：它是一次性的（用完就丢），
    // 复用一条反而要处理「上一次的 resolve 还没被调用」这种交错状态。
    // 一条 `MessageChannel` 的开销远低于它换来的那 8ms 让出。
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        channel.port2.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
  }
}

export interface UseFumeLayoutOptions {
  /** 归一化后的整首歌（适配层产物）。为空数组 = 还没有歌词 */
  lines: Ref<readonly FumeLine[]>
  /** 舞台逻辑尺寸；宽高非正时不排版（还没挂载 / 容器被折叠） */
  viewport: Ref<FumeViewportSize>
  /** 参与缓存键的主题字段（§7.1，只有字体相关那几项） */
  layoutTheme: Ref<FumeLayoutThemeKey>
  /** 全局字号倍率（本项目恒为 1，见 §14.1） */
  lyricsFontScale: Ref<number>
  /** hero 字号倍率（本项目恒为 1；**唯一**参与排版的调参） */
  heroScale: Ref<number>
  /**
   * 「字体可能已经变了」的信号（取值本身不参与排版，只用来建立响应式依赖）。
   *
   * ⚠️ 这是本项目相对上游**多加的一条依赖**，理由是 §7.1 的键**抓不到**字体加载：
   * 内嵌字体从「兜底字形」换成「真字形」时，字体栈字符串一个字都没变，
   * 于是键也不变、缓存照常命中 —— 排版就永久按兜底字的宽度摆着。
   *
   * 之所以不用「把状态并进 `layoutTheme.name`」这种取巧写法：那个字段是**背景种子**的
   * 一部分（`${seed}:${theme.name}`），掺进一个非主题字段会让「字体加载完成 → 背景重掷形状」
   * 这种莫名其妙的副作用发生。依赖显式列出来，语义就只有一个。
   *
   * 清测量缓存由调用方在**同一个时刻**做（`SkinFume.vue` 的 watch，`flush: 'sync'`），
   * 顺序不能反：先清缓存、再重排，否则重排问到的还是旧值。
   */
  fontKey: Ref<unknown>
  /** 排程器（仅单测注入） */
  scheduler?: FumeLayoutScheduler
}

export interface UseFumeLayoutResult {
  /** 排好的文章；`null` = 还没排过 / 当前输入排不出（视口非正或没有行） */
  article: Ref<FumeArticleLayout | null>
  /** `true` = 已经受理了请求但还没出结果（用来画「正在排版」加载卡，§7.9） */
  isLayoutPending: Ref<boolean>
  /**
   * `true` = 这次 pending 只是在为**尺寸变化**重排，屏幕上已经有上一版文章可继续显示。
   *
   * resize 不是切歌：旧文章的字、时间、绘制数据全都有效，只是几何按旧视口算的。
   * 把它继续铺在画布上，等新一版在后台排完再替换，既不会露出空白，也不需要让
   * 加载卡盖住屏幕中央。首次排版 / 切歌时旧文章属于上一首，不能这样复用。
   *
   * `isLayoutPending` 保持「后台还有活」的原语义；UI 是否显示加载卡应看
   * `isLayoutPending && !isViewportRefreshPending`。
   */
  isViewportRefreshPending: Ref<boolean>
  /**
   * 最近一次**真的跑了排版**的采样（§7.8 的 timing）。
   *
   * 命中缓存时保持上一次的值而不是清空：清空会让「刚切回上一首」的调试读数变成
   * `null`，看起来像没排过。`null` 只有「从来没排过」这一种含义。
   */
  timing: Ref<FumeArticleLayoutTiming | null>
}

/** 测量失败（pretext 拿不到 canvas）只提示一次，避免每次重排刷屏 */
let measureWarningPrinted = false

/**
 * 文章布局的调度 hook（§7.9 的完整语义）。
 *
 * 依赖数组与上游一致：`[heroScale, layoutTheme, lines, lyricsFontScale, viewport]`
 * —— 也就是说**只有这五项变化才会重排**。其余调参（相机速度、辉光强度、背景不透明度）
 * 不参与排版，改了不该让整首诗重排（§7.9 第 2 条）。
 */
export function useFumeLayout(options: UseFumeLayoutOptions): UseFumeLayoutResult {
  const scheduler = options.scheduler ?? DEFAULT_FUME_LAYOUT_SCHEDULER
  const article = shallowRef<FumeArticleLayout | null>(null)
  const isLayoutPending = ref(false)
  const isViewportRefreshPending = ref(false)
  const timing = shallowRef<FumeArticleLayoutTiming | null>(null)

  /**
   * 上一次是否**排出过**文章（不是「有没有请求过」）。
   *
   * 用于两件事：决定首次是否走防抖（见 `LAYOUT_REBUILD_DEBOUNCE_MS`），
   * 以及给「空态 / 加载卡」一个可判定的语义（见 `SkinFume.vue` 的 F7）。
   * 它是普通变量而不是 ref：只有排程逻辑读它，没有任何渲染依赖它。
   */
  let hasResolvedArticle = false
  /** 请求版本号：每次 `schedule()` 递增，过期请求据此丢弃 */
  let requestVersion = 0
  let frameId: number | null = null
  let delayId: number | null = null
  let disposed = false
  /**
   * 本实例是否已经**显示过**文章。
   *
   * 不能复用 `hasResolvedArticle`：从别的面板切回来时模块级缓存可能命中，
   * 但本实例此刻画布上还没有任何文章；那种情况必须显示加载卡，不能当成 resize。
   */
  let hasVisibleArticle = false
  /**
   * 最近一次成功排版时的**非视口**输入指纹。
   *
   * 视口变化与切歌都会让缓存键失效，但两者对 UI 的语义完全不同：
   * 前者可以继续显示旧文章，后者必须立刻换成加载卡（旧文章是上一首的词）。
   * 用「去掉视口后的键」区分二者，比在 watch 里分别监听六个输入更不容易漏项 ——
   * 将来排版键新增字段时，这里自动跟着走。
   */
  let lastContentKey: string | null = null

  function cancelPending(): void {
    if (frameId !== null) {
      scheduler.cancelFrame(frameId)
      frameId = null
    }
    if (delayId !== null) {
      scheduler.cancelDelay(delayId)
      delayId = null
    }
  }

  /**
   * 真正跑一次排版（已经过了第一道版本号复核）。
   *
   * ⚠️ 是 `async` 的：排版被切成若干片，每片之间让出主线程。这让第二道版本号复核
   * 从「理论上需要」变成**真正会用到** —— 分片期间用户切歌是常态，而每一片开始时
   * 都会用版本号把过期任务拦下（见 `shouldAbort`）。
   */
  async function runLayout(version: number): Promise<void> {
    const lines = options.lines.value
    const viewport = options.viewport.value
    const layoutTheme = options.layoutTheme.value
    const lyricsFontScale = options.lyricsFontScale.value
    const heroScale = options.heroScale.value

    const key = buildLayoutCacheKey(lines, viewport, layoutTheme, lyricsFontScale, { heroScale })
    const contentKey = buildLayoutCacheKey(
      lines,
      { width: 0, height: 0 },
      layoutTheme,
      lyricsFontScale,
      { heroScale }
    )

    const fontKey = options.fontKey.value

    let next: FumeArticleLayout | null
    if (lastFumeLayoutCache?.key === key && lastFumeLayoutCache.fontKey === fontKey) {
      next = lastFumeLayoutCache.article
    } else {
      try {
        const result = await buildArticleLayoutChunked(
          {
            lines,
            viewport,
            layoutTheme,
            lyricsFontScale,
            heroScale,
            measure: FUME_ARTICLE_MEASURE
          },
          {
            yieldToMainThread: () => scheduler.yieldToMainThread(),
            // 版本号变了 = 这次的结果已经没人要了：立刻停下，别把剩下的 30 次
            // 排版白跑完（那正是「切歌后卡一下」的来源）
            shouldAbort: () => version !== requestVersion || disposed
          }
        )
        // `null` = 被中止；不写回任何东西，`isLayoutPending` 交给新请求管理
        if (!result) return
        next = result.article
        timing.value = result.timing
      } catch (error) {
        // pretext 需要 canvas：拿不到时它会抛错。**不**把异常放出去 ——
        // 它发生在 rAF 回调里，抛出去没人接，而 `isLayoutPending` 会永远停在 true，
        // 面板就永久卡在加载卡上（比"这版排不出来"更糟）。与「倾诉」的
        // use-tilt-layout 是同一条取舍：降级到「没有文章」，背景照常转，下一帧重试。
        if (!measureWarningPrinted) {
          measureWarningPrinted = true
          console.warn('[浮名] 文本测量不可用（pretext 需要 canvas），本版先不排版', error)
        }
        next = null
      }
    }

    // ⚠️ 第二道复核：上面那次排版跨了若干个宏任务，期间用户可能已经切歌
    //（分片执行让这条从「理论保险」变成真正会命中的路径：`shouldAbort` 只能拦在
    // 让出点上，最后一片跑完之后到这里之间仍有一小段窗口）
    if (version !== requestVersion) return

    lastFumeLayoutCache = { key, fontKey, article: next }
    hasResolvedArticle = next !== null
    lastContentKey = contentKey
    article.value = next
    hasVisibleArticle = next !== null
    isLayoutPending.value = false
    isViewportRefreshPending.value = false
  }

  /** 受理一次重排请求（输入变化时被 watch 调用） */
  function schedule(): void {
    if (disposed) return
    cancelPending()
    const version = ++requestVersion

    const viewport = options.viewport.value
    if (!(viewport.width > 0 && viewport.height > 0) || options.lines.value.length === 0) {
      // 没有可排的输入：立刻回到空态，不要留一个永远 pending 的加载卡
      hasResolvedArticle = false
      hasVisibleArticle = false
      lastContentKey = null
      article.value = null
      isLayoutPending.value = false
      isViewportRefreshPending.value = false
      return
    }

    const contentKey = buildLayoutCacheKey(
      options.lines.value,
      { width: 0, height: 0 },
      options.layoutTheme.value,
      options.lyricsFontScale.value,
      { heroScale: options.heroScale.value }
    )
    const isViewportOnlyChange =
      hasVisibleArticle &&
      article.value !== null &&
      lastContentKey !== null &&
      contentKey === lastContentKey

    isLayoutPending.value = true
    isViewportRefreshPending.value = isViewportOnlyChange
    /**
     * resize 没有「用户还在连续拖动」之外的歧义，直接 0ms 开跑：
     * `FumeStage` 已经把同一帧的多次 ResizeObserver 回调合并成一次，
     * 再叠 96ms 只会让旧文章多撑一版。切歌等其它重建仍保留 96ms 防抖。
     */
    const delay = hasResolvedArticle && !isViewportOnlyChange ? LAYOUT_REBUILD_DEBOUNCE_MS : 0

    frameId = scheduler.requestFrame(() => {
      frameId = null
      delayId = scheduler.delay(() => {
        delayId = null
        // ① 第一道复核：从排程到真正执行之间，输入可能已经变了
        if (version !== requestVersion) return
        // ⚠️ 不 await：`runLayout` 现在是分片执行的，它自己会在每一片开始时
        // 用版本号判断该不该继续。这里 await 只会把「谁在等谁」变得难以阅读，
        // 而没有任何调用方需要这个 Promise 的结果。
        void runLayout(version)
      }, delay)
    })
  }

  /**
   * ⚠️ `flush: 'sync'` 是**必须的**，不是"顺手写的"。
   *
   * 上游的 effect 在依赖变化时是**同步**排程的（React 在提交阶段就跑 effect），
   * 而那正是「第二道版本号复核」能拦住东西的前提：`buildArticleLayout` 是同步长任务，
   * 只有**同步**的输入变化才可能在它执行期间把版本号推高。
   *
   * 若用默认的 `'pre'`（微任务批处理），排程回调会晚于当前宏任务 ——
   * 而 `runLayout` 一整段都在同一个宏任务里，中间不可能插进微任务，
   * 于是第二道复核永远为真，成了装饰品。实测：改成 `'pre'` 之后
   * 「排版跑到一半换歌」的用例无法构造（旧结果照样写回）。
   *
   * 同步 flush 的代价可控：一次输入突变最多多调几次 `schedule()`，
   * 而它只做「取消排程 + 记版本号 + 重新 rAF」，不跑任何排版。
   */
  watch(
    [
      options.heroScale,
      options.layoutTheme,
      options.lines,
      options.lyricsFontScale,
      options.viewport,
      options.fontKey
    ],
    schedule,
    { immediate: true, flush: 'sync' }
  )

  onBeforeUnmount(() => {
    disposed = true
    cancelPending()
  })

  return { article, isLayoutPending, isViewportRefreshPending, timing }
}
