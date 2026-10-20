/**
 * 主题生成的**确定性随机源** —— 同一首歌永远得到同一套颜色。
 *
 * ## 为什么不能用 `Math.random`
 *
 * 逐歌主题在会话里会被重算多次：切到明暗另一档、窗口尺寸变化、
 * 组件重新挂载（皮肤切换）都会重新走一遍生成。用 `Math.random` 的话，
 * 同一首歌每次重算都换一套颜色 —— 用户看到的是「歌词页面在闪颜色」，
 * 而那是纯粹的观感故障，没有任何功能意义。
 *
 * 用**歌曲 id** 当种子就没有这个问题：颜色是这首歌的属性，不是这次会话的属性。
 *
 * ## 为什么不用上游那套「每首歌重新掷骰子」
 *
 * 上游确实每首歌随机挑一次（`generateBuiltinDualTheme({ random: Math.random })`），
 * 但它的结果是**落盘缓存**的（`dual_theme_${songKey}`），所以同一首歌仍然稳定。
 * 本项目不落盘主题（那是另一套存储设计），于是把稳定性放在种子里实现 ——
 * 同样的效果，不需要新增持久化层。
 *
 * 纯函数，可在 node 单测。
 */

/**
 * 字符串 → 32 位整数散列（FNV-1a 变体，乘子取 31 而不是 FNV 的质数）。
 *
 * 这里**不是**在实现密码学哈希：主题种子只需要「不同歌曲 id 落到不同起点」，
 * 且分布均匀到肉眼看不见规律。31 乘法足够，且在 JS 上比 FNV 的
 * `Math.imul` 循环更易读。乘积用 `>>> 0` 保持在 32 位无符号范围，
 * 避免浮点误差累积。
 */
export function hashSeed(input: string | number): number {
  const text = String(input)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = (hash * 31) >>> 0
  }
  return hash >>> 0
}

/**
 * 32 位种子 → 伪随机数发生器（mulberry32）。
 *
 * 选它的原因只有两条：**状态小**（一个整数）、**分布好**（过了 gjrand 的
 * 基础测试，对「挑色相/明度」这种用量绰绰有余）。
 * 每次调用返回 `[0, 1)`。
 */
export function createSeededRandom(seed: string | number): () => number {
  let state = hashSeed(seed)

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
