/**
 * 按插入序淘汰的**有界缓存**写入 —— 颜色解析与文本测量共用的一个小地基。
 *
 * 「流光 / 浮名」都会缓存「归一化输入 → 算好的结果」这类派生量（颜色通道、
 * 逐字素前缀宽度）。这些缓存的键空间**没有天然上界**（歌词文本、主题色都来自
 * 用户数据），若不做淘汰，长会话下会一路吃掉内存 —— 于是统一走这条规则：
 * 满了就先删**最旧的一条**（Map 的插入序天然就是 LRU 的近似），再写入。
 *
 * 为什么不记录访问时间做真 LRU：这些缓存命中的对象在一次播放里高度集中
 * （同一行反复测量、同一个颜色反复解析），插入序淘汰已经够用，而真 LRU
 * 要给每次读也写字，反而把读路径变贵。
 *
 * 本文件是纯函数（只操作传入的 Map），不碰 DOM、不引入 Vue，可在 node 单测。
 */

/**
 * 把 `value` 写进 `cache[key]`，若写入会超出容量则先淘汰最旧的一条。
 *
 * 返回值就是 `value`，调用方可以直接 `return rememberBounded(...)` —— 这样
 * 「算出来 → 存起来 → 返回」在调用点是一行，不会出现「忘了存」的分支。
 *
 * ## 容量的口径：**写入后最多保留 `max(1, floor(limit))` 条**
 *
 * 也就是「一条都不留」不是一种容量 —— `limit <= 0` 与非有限值一律按 **1** 处理。
 * 另外两种读法都被刻意排除：
 *
 * 1. **`limit <= 0` ⇒ 什么都不缓存**：调用点若是把容量配错（拼错常量、传了 0），
 *    表现会是「每次都要重算」而不是「缓存小一点」—— 一个静默的性能陷阱，
 *    比保留一条更难发现；
 * 2. **`limit <= 0` ⇒ 无界不淘汰**：那直接违背了本模块存在的理由（长会话内存增长）。
 *
 * 这个口径同时与上游 `textMeasureCache.rememberBounded` 的**实际行为**一致：
 * 上游是「满了先删一条再写」，所以在 `limit = 0` 时它也会保留最新的一条。
 * 换句话说本项目没有改动任何真实路径（两个调用点传的都是正的常量：512 / 2048），
 * 只是把原来那个没被定义的边界写清楚。
 */
export function rememberBounded<TKey, TValue>(
  cache: Map<TKey, TValue>,
  key: TKey,
  value: TValue,
  limit: number
): TValue {
  const capacity = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1

  if (!cache.has(key) && cache.size >= capacity) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, value)
  return value
}
