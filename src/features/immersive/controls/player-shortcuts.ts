/**
 * 沉浸页的**播放键盘快捷键**（方向键）。
 *
 * ## 为什么单独一层
 *
 * 挂在窗口上的监听在 `SkinShell`（ESC 分层关闭已经在那里），但「按一下该跳到哪」是
 * **纯计算**：当前进度 / 时长 / 音量都是数字，钳制边界也不需要 DOM。抽出来之后
 * 这段规则可以在 node 环境直接断言 —— 否则验它只能靠开窗口手按方向键。
 *
 * ## 键位与步长
 *
 * - `←` / `→`：进度 ∓5 秒（用户定案；主流播放器同档）；
 * - `↑` / `↓`：音量 ±5%（`player.volume` 是 0–1 的浮点，步长同样按 0.05 计）。
 *
 * 宽限：`Home` / `End` **不接** —— 沉浸页里没有「回到开头」的既有语义，
 * 顺手加上会让误按变成跳回开头（不可用撤销兜住）。要加的话先问用户。
 */

/** 左右键的进度步长（毫秒） */
export const SEEK_STEP_MS = 5000

/** 上下键的音量步长（`player.volume` 是 0–1，0.05 即 5%） */
export const VOLUME_STEP = 0.05

export type PlayerShortcut = 'seek-back' | 'seek-forward' | 'volume-up' | 'volume-down'

/**
 * 按键 → 快捷键。不认识的键返回 `null`（调用方据此放行，不 `preventDefault`）。
 *
 * 只看 `event.key` 而不看 `code`：`key` 已经处理了 Shift 组合（`Shift+ArrowRight`
 * 的 `key` 仍是 `ArrowRight`），而本项目没有给方向键配 Shift 变体。
 */
export function resolvePlayerShortcut(key: string): PlayerShortcut | null {
  switch (key) {
    case 'ArrowLeft':
      return 'seek-back'
    case 'ArrowRight':
      return 'seek-forward'
    case 'ArrowUp':
      return 'volume-up'
    case 'ArrowDown':
      return 'volume-down'
    default:
      return null
  }
}

/**
 * 新进度：当前值 ± 步长，钳进 `[0, durationMs]`。
 *
 * 时长未知（`durationMs` 非正 / 非有限）时**不跳**，原样返回：那种状态下的进度条
 * 本身是禁用态（`ProgressBar` 的 `:disabled="!song"`），跳到一个凭空的坐标只会
 * 让恢复播放时从奇怪的位置开始。
 */
export function resolveSeekTarget(
  currentMs: number,
  durationMs: number,
  direction: 'back' | 'forward'
): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return currentMs
  const base = Number.isFinite(currentMs) ? currentMs : 0
  const delta = direction === 'forward' ? SEEK_STEP_MS : -SEEK_STEP_MS
  return Math.max(0, Math.min(durationMs, base + delta))
}

/**
 * 新音量：当前值 ± 步长，钳进 `[0, 1]`。
 *
 * 非有限值按 0 起算（音量初值本就是 0–1 的有限数，走到这里说明状态被写坏了，
 * 从 0 起步比从 `NaN` 起步好 —— 后者会让 `setVolume` 把音量永久变成 NaN）。
 */
export function resolveVolumeTarget(volume: number, direction: 'up' | 'down'): number {
  const base = Number.isFinite(volume) ? volume : 0
  const delta = direction === 'up' ? VOLUME_STEP : -VOLUME_STEP
  return Math.max(0, Math.min(1, base + delta))
}

/**
 * 事件目标是否是可编辑控件 —— 是的话方向键应当归它（例如 antd 滑块上按左右是微调）。
 *
 * 判据覆盖三类：原生输入控件、`contenteditable`、以及 `role="slider"` /
 * `role="spinbutton"` 这类 ARIA 控件（antd 的 Slider 是 `div[role="slider"]`，
 * 进度条与音量都长这样）。不做这个判断的后果是：用户在进度条上按左右键，
 * 滑块与播放进度**同时**动，且两边都会认为自己是对的。
 */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  const role = target.getAttribute('role')
  return role === 'slider' || role === 'spinbutton' || role === 'textbox'
}
