/**
 * 判断"当前渲染进程是不是低内存模式回收后重建的"。
 *
 * 低内存模式每次唤起都新建一个渲染进程,冷启动与重建在渲染层看起来完全一样,
 * 只有 sessionStorage 能区分:同一应用运行期内它跨渲染进程存活,而应用重启后
 * 会清空。因此"标记已存在"= 这是同一个运行期内的重建。
 *
 * 键名与主进程 electron/main/memory-mode.ts 顶部「与渲染层的约定」一致(改名要同步)。
 */
export const RENDERER_SESSION_KEY = 'muice:renderer-session'

/** sessionStorage 在极端情况下(隐私模式/配额)可能抛错,失败按"冷启动"处理更安全。 */
function readMarker(): boolean {
  try {
    return window.sessionStorage.getItem(RENDERER_SESSION_KEY) !== null
  } catch {
    return false
  }
}

/**
 * 当前渲染进程是否为回收后的重建,并把本代次登记下来。
 * 必须在启动流程最开始调用一次:调用后标记即存在,后续再调用只会返回 true。
 */
export function takeRendererRecreated(): boolean {
  const recreated = readMarker()
  try {
    window.sessionStorage.setItem(RENDERER_SESSION_KEY, String(Date.now()))
  } catch {
    // 写不进去只会让下次重建被当成冷启动(不恢复队列),不影响本次启动
  }
  return recreated
}
