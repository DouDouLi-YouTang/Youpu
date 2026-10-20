import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/**
 * 沉浸页的**实际出帧率**统计（左上角帧率显示）。
 *
 * ## 为什么统计 rAF 而不是各皮肤的绘制循环
 *
 * 「渲染帧率」指的是这一页最终出到屏幕上的帧数：背景层（Common 的流体 / 几何、
 * Monet 的 shader、Sora…）、歌词 canvas、控制条与设置面板的样式计算，全都落在
 * 同一个渲染帧里。只数某个皮肤自己的绘制循环会漏掉背景与合成开销 —— 卡顿明明
 * 来自背景，读数却还是 60。`requestAnimationFrame` 的回调频率就是浏览器当前的
 * 出帧节奏（标签页隐藏 / 窗口失焦时 Chromium 会降频或暂停，读数随之下降，是真实
 * 情况而不是 bug）。
 *
 * ## 为什么要按窗口统计而不是「上一帧间隔」
 *
 * 逐帧取 `1 / (now - last)` 会让读数在 58 / 62 / 60 之间乱跳，肉眼根本读不出来。
 * 这里按 {@link FPS_WINDOW_MS} 的窗口累计帧数再换算，数字稳定、掉帧也能立刻反映
 *（窗口内少掉几帧，换算结果就会下降）。
 *
 * ## 为什么不用 `setInterval` 采样
 *
 * 定时器本身会被节流（后台标签页 1s、窗口失焦时更低），用它算帧率会在「页面被
 * 降频」时仍然显示 60 —— 正好把最需要看到的场景掩盖掉。rAF 回调自己带时间戳，
 * 既准确又没有额外定时器。
 */

/** 统计窗口（毫秒）。500ms 是「读得清」与「掉帧能立刻反映」之间的折中。 */
export const FPS_WINDOW_MS = 500

/**
 * 帧率上限（常见显示器的最高刷新率）。
 *
 * 为什么需要它：Electron 窗口在**没有 vsync 约束**时（部分机器 / 无头环境 /
 * 关闭了帧节流的渲染层），`requestAnimationFrame` 会以远高于刷新率的频率回调 ——
 * 实测能读到 165。那不是用户看到的帧率，只是空闲的 rAF 空转；不对齐上限就会
 * 给出一个「性能极好」的假象，反而看不出卡顿。
 *
 * 240 是当前消费级显示器的最高档：比它快只可能是空转，按它夹住即可。
 */
export const FPS_CAP = 240

/** 把换算结果夹进 `[0, FPS_CAP]` 并取整。 */
export function clampFps(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(FPS_CAP, Math.round(value)))
}

/**
 * 启动帧率统计，返回当前帧率的只读 ref。
 *
 * `enabled` 为假时**不建 rAF 循环**：这是排查工具，关掉后不该继续占一帧的开销。
 * 必须在组件 setup 中调用（内部注册了 `onBeforeUnmount`）。
 */
export function useFpsMeter(enabled: Ref<boolean>): Ref<number> {
  const fps = ref(0)

  let rafId: number | null = null
  let windowStart = 0
  let framesInWindow = 0
  let disposed = false

  function tick(now: number): void {
    if (disposed) return
    rafId = requestAnimationFrame(tick)

    // 首帧只用来对齐窗口起点：`performance.now()` 与 rAF 时间戳同源，
    // 直接拿 now 当起点，不必再读一次时钟。
    if (windowStart === 0) {
      windowStart = now
      framesInWindow = 1
      return
    }

    framesInWindow += 1
    const elapsed = now - windowStart
    if (elapsed < FPS_WINDOW_MS) return

    // 用真实经过时间换算，而不是「帧数 / 固定窗口」：窗口可能因主线程被长任务
    // 阻塞而超过 500ms，按固定值算会把掉帧读成正常。
    fps.value = clampFps((framesInWindow * 1000) / elapsed)
    windowStart = now
    framesInWindow = 0
  }

  function start(): void {
    if (disposed || rafId !== null) return
    windowStart = 0
    framesInWindow = 0
    fps.value = 0
    rafId = requestAnimationFrame(tick)
  }

  function stop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    fps.value = 0
  }

  watch(
    enabled,
    (on) => {
      if (on) start()
      else stop()
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    disposed = true
    stop()
  })

  return fps
}
