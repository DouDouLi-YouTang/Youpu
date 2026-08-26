import { ref } from 'vue'

/**
 * 迷你模式开关状态。模块级单例:TitleBar 触发、AppFrame 读取切换布局。
 * 主进程 window:mini-change 推送时同步更新。
 */
const isMiniMode = ref(false)

export function useMiniMode() {
  function toggle(): void {
    const api = window.muiceDesktop
    if (!api) return
    void api.window.toggleMini()
  }

  function init(): () => void {
    const api = window.muiceDesktop
    if (!api) return () => undefined
    return api.window.onMiniChange((v) => {
      isMiniMode.value = v
    })
  }

  return { isMiniMode, toggle, init }
}
