/**
 * 副字幕底距 —— 跟随控制条的显隐（上游 `usePlayerSubtitleBottomPx`）。
 *
 * ## 上游的两档底距
 *
 * Folia 的基线是 32px（`PLAYER_BOTTOM_BAR_BASE_OFFSET_PX`），字幕在它之上再留
 * 80px 净空（`PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX`）—— 控制条在场时合计 **112px**。
 * 控制条**隐藏**时净空不再需要，底距掉回基线 **32px**，走一组 spring 过渡
 * （`stiffness: 280, damping: 28`）。
 *
 * 本项目控制条比上游矮，所以在场档按「**控制条高 + 22px 净空**」算：
 * 控制条 90px 时正好也是上游那个 112px（22 就是由此来的），2026-10-20 控制条降到
 * 76px 后跟着变成 **98px**。隐藏档仍取基线 32px。
 *
 * 净空写成 JS 常量、控制条高度取 `BOTTOMBAR_HEIGHT`（controls/use-controls-idle.ts）
 * 而不是在 CSS 里 `calc()`：底距是内联变量、要 rAF 插值（见下），拿不到 CSS 里的
 * `--bottombar-height`。代价是这里与 CSS 各存一份高度 —— 改控制条高度时两处都要动。
 *
 * ## 为什么不做成 CSS 过渡
 *
 * 底距是**内联的 CSS 变量**（各皮肤在自己的定位容器上设），CSS 过渡要写在变量上，
 * 而 `transition` 对自定义属性只在注册了 `@property` 时才有插值 —— 注册 `@property`
 * 在 Electron 的 Chromium 上可用，但会让这个变量在整棵子树里强制类型检查，
 * 得不偿失。用一个 rAF 插值把值算好、直接写变量，行为与上游的 spring 一致且无副作用。
 *
 * ## 为什么直接读 idle 状态而不是调 `useControlsIdle()`
 *
 * 「控制条现在隐没隐」是**全局**状态（`use-immersive-player` 的 idle + 用户的
 * alwaysShowBottomBar / presentationMode 设置），不是每个皮肤各自的事。
 *
 * `useControlsIdle()` 除了返回 `hidden`，还会**注册窗口监听**（它自己注释里写明
 * 「外壳组件调用」）—— 皮肤再调一次会让 mousemove / wheel 监听挂两遍、
 * 计时器互相 reset，表现为 idle 永远不触发。所以这里只复刻它的 `hidden` 判据
 * （读同一份模块级 idle 与设置），不碰它的监听。
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { BOTTOMBAR_HEIGHT, useControlsHidden } from '../../controls/use-controls-idle'

/** 副字幕与控制条之间的净空（px）—— 上游拆法里的 22，本项目沿用 */
const SUBTITLE_GAP_ABOVE_BAR_PX = 22

/**
 * 控制条在场时的字幕底距（px）= 控制条高 + 净空。
 *
 * 取值跟着控制条高度走：控制条 90px 时是上游那个 112px；2026-10-20 控制条降到 76px，
 * 这里同步成 98px —— 否则控制条变矮、字幕不动，两者之间会凭空多出一截空隙。
 */
export const SUBTITLE_BOTTOM_VISIBLE_PX = BOTTOMBAR_HEIGHT + SUBTITLE_GAP_ABOVE_BAR_PX
/** 控制条隐藏时的字幕底距（px）—— 上游的基线 32px */
export const SUBTITLE_BOTTOM_HIDDEN_PX = 32

/**
 * 过渡时长（毫秒）。上游是 spring（`stiffness: 280, damping: 28`），
 * 按二阶系统估算其整定时间约 300ms；这里用等长的缓动近似 ——
 * 观感差别在"控制条隐没时字幕抬不抬"这件事上不可辨，但实现简单得多。
 */
const TRANSITION_MS = 300

/** 缓出曲线（与上游 spring 的收尾手感一致：起步快、末端稳） */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export interface UseSubtitleBottomResult {
  /** 当前底距（px，四舍五入到整数） */
  bottomPx: Readonly<ReturnType<typeof ref<number>>>
}

/**
 * 创建副字幕底距（跟随控制条显隐，带过渡）。
 *
 * **必须在组件 setup 中调用**（会注册 rAF 与卸载钩子）。
 */
export function useSubtitleBottom() {
  const hidden = useControlsHidden()

  const target = computed(() =>
    hidden.value ? SUBTITLE_BOTTOM_HIDDEN_PX : SUBTITLE_BOTTOM_VISIBLE_PX
  )
  const bottomPx = ref(target.value)

  let rafId: number | null = null
  let fromPx = bottomPx.value
  let startedAt = 0

  function step(now: number): void {
    const elapsed = now - startedAt
    const progress = Math.min(elapsed / TRANSITION_MS, 1)
    bottomPx.value = fromPx + (target.value - fromPx) * easeOutCubic(progress)
    if (progress < 1) {
      rafId = requestAnimationFrame(step)
    } else {
      rafId = null
      // 收尾取整：插值的最后一帧可能停在 111.998，肉眼看不出来但会让
      // 「是否等于 98」这类断言失败
      bottomPx.value = target.value
    }
  }

  watch(target, (next) => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    fromPx = bottomPx.value
    startedAt = performance.now()
    // 目标已经等于当前值时不必起动画（避免多余的 rAF）
    if (Math.abs(next - fromPx) < 0.5) {
      bottomPx.value = next
      rafId = null
      return
    }
    rafId = requestAnimationFrame(step)
  })

  onBeforeUnmount(() => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
  })

  return { bottomPx }
}
