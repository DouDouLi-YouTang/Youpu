import { ref } from 'vue'

/**
 * 沉浸式播放页的开关状态。与 use-lyric-panel 同构：模块级单一 ref
 * 撑起整个应用 —— PlayerBar 的触发按钮与 AppFrame 挂载的 ImmersivePlayer
 * 共享同一份状态。一个布尔值不值得单独开 Pinia store。
 *
 * idle 同样是模块级共享 ref:ImmersiveControls 写入(鼠标静止 1.5s 置 true、
 * 移动置 false),ImmersivePlayer 读取以让关闭按钮跟随控制条一起隐藏/唤出。
 */
const open = ref(false)
const idle = ref(false)

export function useImmersivePlayer() {
  return {
    open,
    idle,
    openPanel: () => {
      open.value = true
    },
    close: () => {
      open.value = false
    },
    toggle: () => {
      open.value = !open.value
    }
  }
}
