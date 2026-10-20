/**
 * 沉浸页顶部那两个弹层的**互斥开关**：设置面板 ↔ 面板主题列表。
 *
 * ## 为什么要互斥
 *
 * 两个弹层都由右上角那一排按钮触发、展开后占同一片区域 —— 面板主题列表就挂在
 * 那排按钮下面，落点正好压在设置面板上（所以它的 z-index 必须高于设置面板，
 * 见 `SkinSwitcher.vue` 的注释）。两个同时开着时：列表盖住设置面板的左半边，
 * 用户以为点的是设置里的一项、实际点了主题；点「设置」按钮又关不掉已经展开的列表。
 *
 * ## 为什么写成模块级单例
 *
 * 设置面板的显隐挂在 `SkinShell`（`v-model:visible`），面板主题列表的展开状态在
 * `SkinSwitcher` —— 两个组件是平级兄弟，谁也管不到谁。把状态搬进任一组件都要
 * 再往另一头穿一层 props/emit。这里跟 `use-controls-idle` 一样放模块级单例：
 * **只有一个槽位**，所以「互斥」不是额外维护的规则，而是这份状态的形状本身
 * （后开的直接覆盖先开的，不会出现「两个都亮」）。
 *
 * ## 与 `ImmersivePlayer` 同级弹层的关系
 *
 * 只收这两个 —— 播放队列抽屉（`ImmersiveControls` 内）是从底部拉起的独立面板，
 * 与顶部这一排不重叠，用户没要求把它并进来。
 */
import { computed, ref, type ComputedRef } from 'vue'

/** 参与互斥的弹层 id */
export type ImmersivePanelId = 'settings' | 'skins'

// 模块级唯一槽位：null = 顶部没有弹层打开
const activePanel = ref<ImmersivePanelId | null>(null)

export interface UseImmersivePanelsResult {
  /** 有没有任何一个弹层开着（ESC 分层关闭用：先收弹层，再收全屏，最后才退沉浸页） */
  anyOpen: ComputedRef<boolean>
  /** 该弹层是否正开着（响应式；同 id 的另一个调用点拿到同一个 computed 语义） */
  isOpen: (id: ImmersivePanelId) => ComputedRef<boolean>
  /** 打开（自动关掉另一个） */
  open: (id: ImmersivePanelId) => void
  /** 关闭（已经是别人开着时不动 —— 避免「关自己」误伤后来者） */
  close: (id: ImmersivePanelId) => void
  /** 开着就关、关着就开（按钮点击用） */
  toggle: (id: ImmersivePanelId) => void
  /** 全部收起来（沉浸层关闭时调用，否则下次进来会带着上次的弹层状态） */
  closeAll: () => void
}

export function useImmersivePanels(): UseImmersivePanelsResult {
  return {
    anyOpen: computed(() => activePanel.value !== null),
    isOpen: (id) => computed(() => activePanel.value === id),
    open(id) {
      activePanel.value = id
    },
    close(id) {
      if (activePanel.value === id) activePanel.value = null
    },
    toggle(id) {
      activePanel.value = activePanel.value === id ? null : id
    },
    closeAll() {
      activePanel.value = null
    }
  }
}
