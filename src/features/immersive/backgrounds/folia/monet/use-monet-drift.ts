import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

import { buildMonetDriftTrack } from './monet-background-drift'

/**
 * 给一个元素挂上 monet 的漂移轨道（Web Animations API）。
 *
 * 三条与 Folia 一致的行为：
 *  1. 只有 `enabled && 强度 > 0 && !reduceMotion` 时才播 —— 关掉漂移的容器同时**不带
 *     `will-change: transform`**（Folia 用 `driftStyle` 做这件事）。常驻 `will-change`
 *     会白占一个合成层，静态背景没必要。
 *  2. 参数变化时先 `cancel()` 再重建轨道，不是「改现有动画」—— 轨道是整段关键帧，
 *     改强度等于换一整条轨道。
 *  3. 元素不支持 `animate`（旧环境）时静默不播，背景仍然显示，只是不漂。
 *
 * `reduceMotion` 的来源：Folia 读 `useMotionSettingsStore.resolveReducedMotion(state, surface)`，
 * 本项目没有 per-surface 的动效设置，用全局 `prefers-reduced-motion` 媒体查询等价替代
 * （与 `GeometricBackground.vue` 的做法一致，规格 §12 第 9 条已记录该差异）。
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
  } catch {
    return false
  }
}

export interface UseMonetDriftOptions {
  /** 漂移容器（full-overlay 下包住图，half-pane 下在蒙版窗内部） */
  target: Ref<HTMLElement | null>
  enabled: () => boolean
  strength: () => number
}

export function useMonetDrift(options: UseMonetDriftOptions) {
  const reduceMotion = ref(readPrefersReducedMotion())
  let animation: Animation | null = null
  /** 媒体查询的监听在第一次用到时才挂，避免 headless / node 环境下不必要的副作用 */
  let mediaQuery: MediaQueryList | null = null
  let removeMediaQueryListener: (() => void) | null = null

  function ensureMediaQuery(): void {
    if (mediaQuery || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (event: MediaQueryListEvent): void => {
      reduceMotion.value = event.matches
    }
    mediaQuery.addEventListener('change', onChange)
    // 卸载时**必须**摘掉监听：这是模块外的全局对象，留着会一直持有组件闭包
    removeMediaQueryListener = () => mediaQuery?.removeEventListener('change', onChange)
  }

  function stop(): void {
    animation?.cancel()
    animation = null
  }

  function start(): void {
    stop()
    const element = options.target.value
    const strength = options.strength()
    if (!element || !options.enabled() || strength <= 0) return
    if (reduceMotion.value) return
    if (typeof element.animate !== 'function') return

    const track = buildMonetDriftTrack(strength)
    animation = element.animate(track.keyframes, {
      duration: track.durationMs,
      iterations: Infinity,
      easing: 'linear'
    })
  }

  watch(
    () => [options.target.value, options.enabled(), options.strength(), reduceMotion.value],
    () => {
      ensureMediaQuery()
      start()
    },
    { flush: 'post', immediate: true }
  )

  onBeforeUnmount(() => {
    stop()
    removeMediaQueryListener?.()
    removeMediaQueryListener = null
    mediaQuery = null
  })

  return {
    reduceMotion,
    /** 调试/测试用：当前是否有动画在跑 */
    isDrifting: (): boolean => animation !== null
  }
}
