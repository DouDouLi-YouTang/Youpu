/**
 * 辉光模糊半径的**平台降级开关** —— 全部皮肤共享。
 *
 * 住在 `skins/shared/` 的理由与 `graphemes.ts` 相同：「流光」（DOM text-shadow）与
 * 「浮名」（canvas shadowBlur / drop-shadow）都要用它，而两个平级皮肤不该互相依赖。
 *
 * ## 它解决的真实故障
 *
 * Chromium 的 GPU 光栅器按"字形 strike"缓存字形，而 strike 的键里含**阴影的设备空间
 * 模糊半径**（CSS 半径 × 图层缩放）。半径每帧都变 → 每帧铸一个新 strike，每个 strike
 * 从 4KiB 共享内存块里拿一个可丢弃句柄且**永不归还**。Linux 上 renderer 的软限制 1024
 * 会在约 35 分钟连续播放后耗尽，合成器直接停止出帧
 * （原项目 `docs/linux-glyph-cache-fd-leak.md` 记录了完整测量）。
 *
 * 把半径**取整**解决不了：各词的图层缩放都不同，有限的 CSS 半径集仍是无限的设备 sigma
 * （Folia 实测只降 70%，不是 100%）。真正有效的是改用合成器层的 `filter: drop-shadow()`：
 * filter 作用在整层上、从不经过字形缓存，半径可以自由动画。代价是投影的那一层必须自己
 * 把字形画成彩色（`drop-shadow` 投的是"画出来的东西"的影），它正好压在正文下面，看不见。
 *
 * ## 本项目的取舍
 *
 * 照 Folia 的做法**只在 Linux 上默认开启**：其它平台的泄漏每天几 MB，不值得为它牺牲观感。
 * 与 Folia 的差别是这里**不读 localStorage**：Folia 系皮肤都没有设置面板，
 * 多一个持久化开关却不给它入口，等于埋一个永远改不动的状态。将来要暴露成设置项，
 * 在这里接 store 即可，调用方一行不用改。
 */

/** Linux 桌面端（含 Electron）—— 唯一会因字形缓存耗尽而冻结合成器的平台 */
function detectLinux(): boolean {
  // ⚠️ 判据是 **window**，不是 navigator：Node 21+ 也有全局 navigator
  // （userAgent 形如 "Node.js/22"），单测里判 navigator 会继续往下走然后读 window 抛
  // ReferenceError —— 不是 undefined，而是整个模块加载失败。
  // 没有 window 就没有渲染器，也就没有字形缓存问题，一律不降级。
  if (typeof window === 'undefined') return false
  const electronPlatform = (window as Window & { electron?: { platform?: string } }).electron
    ?.platform
  if (electronPlatform) return electronPlatform === 'linux'
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Linux/i.test(ua) && !/Android/i.test(ua)
}

/**
 * 当前是否处于降级模式。
 *
 * 用模块级变量而不是响应式 ref：它被**每个字素**的渲染读到（一个词可能十几个），
 * 做成 ref 会给每个字素挂一个 watcher，而这些 watcher 在播放期间从不触发
 * （开关不随播放变化），纯属浪费。切换后新的词读到新值 —— 与原实现一致。
 */
let glowBlurQuantized = detectLinux()

export function isGlowBlurQuantized(): boolean {
  return glowBlurQuantized
}

/** 改开关（本项目没有设置入口，保留它同时也是单测覆盖两条分支的唯一途径） */
export function setGlowBlurQuantized(enabled: boolean): void {
  glowBlurQuantized = enabled
}

/**
 * 把模糊半径量化到整像素（仅在降级模式下取整）。
 *
 * Folia 用它处理 canvas 的 `shadowBlur`；本项目「浮名」的画布渲染走同一套量化，
 * 「流光」则用它决定 text-shadow 的半径是否吸附到整像素。两处口径必须一致，
 * 否则同一个降级开关在两个皮肤上表现不同。
 */
export function quantizeShadowBlur(blurPx: number): number {
  if (!Number.isFinite(blurPx)) return 0
  const safe = Math.max(0, blurPx)
  return glowBlurQuantized ? Math.round(safe) : safe
}

/** drop-shadow 半径相对 text-shadow 半径的系数（按像素差拟合） */
export const DROP_SHADOW_RADIUS_SCALE = 0.4
/** 内层 drop-shadow 的 alpha：级联时外层也会给它投影，所以必须更弱 */
export const DROP_SHADOW_INNER_ALPHA = 0.7

/**
 * 给 canvas 设置"下一次绘制文字的光晕"。
 *
 * 普通模式用 canvas 原生 `shadowBlur` / `shadowColor`；降级模式把光晕改成
 * `context.filter` 的 `drop-shadow`（sigma = shadowBlur / 2，两者都不跟随 CTM，
 * 所以视觉上等价）。用完必须调 `clearCanvasTextGlow` —— 它也负责把 `filter` 复位，
 * 否则后面所有绘制都会带上这个滤镜。
 *
 * ⚠️ 降级模式下 `filter` 是**状态**而不是每次绘制参数：调用方必须在设置光晕后
 * 紧接着绘制那一段文字，中间不能插入别的绘制。
 */
export function setCanvasTextGlow(
  context: CanvasRenderingContext2D,
  blur: number,
  color: string
): void {
  if (!glowBlurQuantized) {
    context.shadowBlur = blur
    context.shadowColor = color
    return
  }
  context.shadowBlur = 0
  context.shadowColor = 'transparent'
  context.filter = blur > 0 ? `drop-shadow(0 0 ${blur / 2}px ${color})` : 'none'
}

/** 复位 canvas 的文字光晕（见 setCanvasTextGlow） */
export function clearCanvasTextGlow(context: CanvasRenderingContext2D): void {
  context.shadowBlur = 0
  context.shadowColor = 'transparent'
  if (glowBlurQuantized) context.filter = 'none'
}
