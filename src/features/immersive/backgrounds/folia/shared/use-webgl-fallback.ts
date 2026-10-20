import { ref, watchEffect, type Ref } from 'vue'

import { isWebgl2Unavailable } from './webgl-support'

/**
 * 「WebGL 挂了就换成主题底色渐变」的挂载侧判定 —— 规格 §10.4 的降级链第 2/3/4 步。
 *
 * ## 为什么必须有这个标记，而不是「挂不上就算了」
 *
 * `createPaperShaderMount` 在失败时返回 `null`，此时画面上只剩各模式自己的底色层 ——
 * 对 latent / nomand 来说那基本就是一块纯色。默认背景恰好是 latent，
 * 用户看到的会是「背景变成一片黑」，而控制台里只有一条 warn。
 * `FoliaFallbackGradient` 是有层次的（底色 + 对角主色 + 角落强调色），
 * 至少还能交代「这里原本有一层会动的东西」。
 *
 * ## 为什么是「一次性」的
 *
 * 标记由 `markWebgl2Unavailable` 单向置位，不做重试（见 `webgl-support.ts` 的说明）。
 * 所以这里的判定是 `!mounted && isWebgl2Unavailable()`：同一次会话里第一次失败之后，
 * 同一模式的后续挂载**根本不会再发起**，也就不会反复刷 warn。
 *
 * 判定是「**没有**挂载成功 **并且** 全局标记已置位」两个条件同时成立 ——
 * 只看标记会让「刚切到某模式、还没开始挂」的那一帧先闪一下渐变；
 * 只看「没有挂载」则会在挂载进行中的每一帧都闪。
 */
export function useWebglFallback(options: {
  /** 当前是否已经有 shader/context 挂上了 */
  hasMount: () => boolean
}): { showFallback: Ref<boolean> } {
  const showFallback = ref(false)

  // watchEffect 会收集 `hasMount()` 里读到的所有响应式依赖（各模式的 mount ref），
  // 所以挂载成功/失败、以及全局标记翻转的那一刻都会自动重算，不用手动同步。
  watchEffect(() => {
    showFallback.value = !options.hasMount() && isWebgl2Unavailable()
  })

  return { showFallback }
}
