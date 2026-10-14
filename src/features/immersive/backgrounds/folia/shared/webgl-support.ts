/**
 * WebGL 降级链的全局状态（只有这一处状态，模式组件不许各自维护一份）。
 *
 * 为什么必须有：Folia 的**默认**背景就是 latent（双 shader），而 `@paper-design/shaders`
 * 的 `ShaderMount` 拿不到 `webgl2` 会直接 `throw`（`shader-mount.js:64-67`）。
 * 没有全局标记的话，「每次进入 latent 都新建一次、每次都 throw」会在模式切换时刷屏并
 * 反复申请 context。标记一旦置位，后续同模式的挂载直接走渐变兜底、不再尝试。
 *
 * 注意标记是**单向**的：不做「过一会儿再试一次」。WebGL2 在同一个渲染进程里要么一直可用，
 * 要么一直不可用；重试只会在真正不可用的机器上反复制造失败路径。
 */

import { ref, type Ref } from 'vue'

/**
 * 全局标记做成 ref 而不是普通变量：各模式要靠它把画面从「黑屏」换成兜底渐变，
 * 而它的翻转发生在**异步挂载失败**之后 —— 那时没有别的响应式变化能触发重渲染。
 * 用普通变量的话标记虽然置位了，组件却不知道，用户看到的仍是一片纯色。
 */
const webgl2Unavailable: Ref<boolean> = ref(false)
/** 已 warn 过的模式名，避免同一模式切来切去刷屏（每种模式只 warn 一次）。 */
const warnedModes = new Set<string>()

/** WebGL2 是否已被判定为不可用 —— 模式组件在挂载前先问这一句。 */
export function isWebgl2Unavailable(): boolean {
  return webgl2Unavailable.value
}

/**
 * 记录一次 WebGL2 不可用，并 `console.warn` 一次（每种模式最多一次）。
 *
 * @param mode  模式名，仅用于日志与去重
 * @param error 原始错误。`ShaderMount` 抛的是固定文案的 Error，取 message 即可；
 *              非 Error 值原样打印，不要 `String(error)` 丢掉堆栈对象
 */
export function markWebgl2Unavailable(mode: string, error: unknown): void {
  webgl2Unavailable.value = true
  if (warnedModes.has(mode)) return
  warnedModes.add(mode)
  console.warn(
    `[FoliaBackground] WebGL2 不可用，模式 ${mode} 回退到主题底色渐变（不再重试）`,
    error
  )
}

/** 仅测试用：重置全局标记，避免用例之间互相污染。 */
export function resetWebglSupportStateForTests(): void {
  webgl2Unavailable.value = false
  warnedModes.clear()
}

/**
 * 主动释放一个 WebGL context。
 *
 * 为什么需要：paper 的 `dispose()` 删程序、删纹理、把 canvas 从 DOM 移除，
 * **但从不 lose context**（`shader-mount.js:386-418`）—— 绘制缓冲要等 canvas 被 GC 才回收，
 * 而大面积 canvas 的 GC 时机非常晚，切几次模式就能堆出几百 MB（§11 风险 5）。
 * sora 自写的 GL 路径同理（twgl 不管这件事）。
 *
 * 判定条件必须包含 `canvas.isConnected === false`：只有在 canvas 真的离开文档之后才能丢，
 * 否则「DOM 还在、只是组件重建」的场景会把正在用的 context 杀掉，表现为背景变黑。
 */
export function releaseWebglContext(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  queueMicrotask(() => {
    if (!gl || canvas.isConnected || gl.isContextLost()) return
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  })
}
