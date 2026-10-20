/**
 * 「用户正在动控制条」→ 控制条不自动隐藏。两个入口，覆盖两类场景：
 *
 * - `useIdleHoldWhile(() => 弹层展开)` —— **查看/调节某个弹层期间**：音量、倍速、
 *   音质三个悬停弹层向上弹出 120px，鼠标一旦停在弹层里就离开了屏幕底部那条
 *   「悬停唤出区」，1.5s 后整条控制条（弹层是它的子元素）会连带消失，正在调的音量
 *   就断在半路。播放队列面板、设置面板同理。
 * - `useIdleHoldOnPointerPress()` —— **按住/拖动期间**：拖动滑块时指针常常一动不动
 *   （没有 mousemove 可用来重置计时），`resetIdle()` 那套「把计时推后」就不管用了。
 *   按住期间持有、抬起释放，与鼠标是否移动无关。
 *
 * 都只是 `holdIdle()` 的薄封装 —— 真正的状态机在 use-controls-idle.ts。
 */
import { onBeforeUnmount, watch } from 'vue'

import { holdIdle } from './use-controls-idle'

/**
 * 条件为真期间持有 idle；转假立即释放（并重新开始 1.5s 计时）；组件卸载兜底释放。
 *
 * 传函数而不是 ref：调用点常常是 `() => popup.visible` 这类派生条件。
 */
export function useIdleHoldWhile(active: () => boolean): void {
  let release: (() => void) | null = null

  function sync(on: boolean): void {
    if (on && !release) release = holdIdle()
    else if (!on && release) {
      release()
      release = null
    }
  }

  watch(active, sync, { immediate: true })
  onBeforeUnmount(() => sync(false))
}

/**
 * 指针按住期间持有 idle —— 把返回的处理函数绑到容器（控制条、贴底进度条）的
 * `pointerdown` 上即可；抬起或取消在 window 上收尾，指针甩出容器/窗口也能释放。
 *
 * 不用 `pointerup` 绑容器：antd 滑块拖动会 `setPointerCapture`，事件被重定向到
 * 手柄——虽然仍会冒泡到容器，但指针在窗外抬起时容器收不到，绑定 window 最稳。
 */
export function useIdleHoldOnPointerPress(): { onPointerDown: () => void } {
  let release: (() => void) | null = null

  function end(): void {
    release?.()
    release = null
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
  }

  function onPointerDown(): void {
    if (!release) release = holdIdle()
    // 可重入：重复 pointerdown（多指、连点）不会漏掉任何一次释放
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  onBeforeUnmount(end)
  return { onPointerDown }
}
