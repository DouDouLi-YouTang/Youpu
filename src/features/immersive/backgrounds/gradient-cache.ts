/**
 * 渐变背景的取色结果缓存 —— 键是封面 URL，值是算好的 CSS 渐变串。
 *
 * 为什么要跨组件实例缓存：取色是**异步**的（加载封面图 + 量化），而渐变背景子组件
 * 只在被选中时挂载。没有缓存的话，每次从别的背景切回「渐变」都会先渲染默认渐变
 * （`#666` → `#fff` 的灰白斜纹）再跳成封面配色 —— 一次肉眼可见的闪烁。
 * 改造前这份值存在常驻组件的 ref 里，切走再切回不会闪；本缓存是它在拆分后的等价物。
 *
 * 键是封面 URL 就够：同一张封面取色结果恒定（`getGradientFromPalette` 无随机源）。
 *
 * 上限 64 条：一次会话最多也就几十首封面，超了整表丢掉重建 —— 够用，且不必引 LRU。
 */
const MAX_ENTRIES = 64
const cache = new Map<string, string>()

/** 取缓存的渐变串；没有则返回 null（调用方自行回退默认渐变） */
export function readCachedGradient(coverUrl: string): string | null {
  return cache.get(coverUrl) ?? null
}

/** 写入取色结果 */
export function writeCachedGradient(coverUrl: string, gradient: string): void {
  if (cache.size >= MAX_ENTRIES) cache.clear()
  cache.set(coverUrl, gradient)
}
