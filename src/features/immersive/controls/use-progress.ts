import { computed, ref } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import { resetIdle } from '@/features/immersive/controls/use-controls-idle'

/**
 * 控制条「播放进度」共享状态 —— 模块级单例：进度条（拖拽）与右侧时间指示器读
 * 同一份 seekValue。不做成外壳 props 往返：拖动期间哪怕滞后一次 render，
 * a-slider 的受控 value 都会回跳、手柄抖动。
 *
 * 镜像 player.currentTimeMs 的 watch 由外壳组件挂载（随沉浸层 open 挂载/卸载，
 * 见 ImmersiveControls.vue）：本文件只持有模块级状态与拖拽处理。
 */
const seekValue = ref(0)
const isDragging = ref(false)
let sliderReleaseTimer: ReturnType<typeof setTimeout> | undefined

export function useControlsProgress() {
  const player = usePlayerStore()
  const song = computed(() => player.currentItem?.song ?? null)
  const totalTime = computed(() => player.durationMs || song.value?.durationMs || 0)
  // a-slider 要求 (max - min) 是 step 的整数倍，否则告警；totalTime 通常是歌曲实际时长，不保证是 100 的倍数
  const sliderMax = computed(() => Math.max(0, Math.ceil(totalTime.value / 100) * 100))

  // ── 进度条：防抖拖拽（逻辑复用自 PlayerBar） ──
  function onSliderChange(value: number | number[]): void {
    const v = Array.isArray(value) ? value[0] : value
    seekValue.value = v
    isDragging.value = true
    // 拖动进度条期间保持控制条显示:antd slider onMouseMove 调 stopPropagation,
    // window mousemove 不触发,idle 计时不被重置会导致控制条淡出(同音量条)。
    resetIdle()
  }

  function onSliderAfterChange(value: number | number[]): void {
    const v = Array.isArray(value) ? value[0] : value
    seekValue.value = v
    player.seek(v)
    resetIdle()
    if (sliderReleaseTimer) clearTimeout(sliderReleaseTimer)
    sliderReleaseTimer = setTimeout(() => {
      isDragging.value = false
      sliderReleaseTimer = undefined
    }, 150)
  }

  return { seekValue, isDragging, totalTime, sliderMax, onSliderChange, onSliderAfterChange }
}

/**
 * 关闭沉浸层时复位拖拽态（由外壳组件 onBeforeUnmount 调用）。
 * 模块级状态跨 open/close 存活：不清计时器会留下悬挂回调，不复位 isDragging
 * 则下次打开时镜像 watch 被拖动态挡住、seekValue 卡在上次拖动值。
 */
export function resetProgressDrag(): void {
  if (sliderReleaseTimer) {
    clearTimeout(sliderReleaseTimer)
    sliderReleaseTimer = undefined
  }
  isDragging.value = false
}
