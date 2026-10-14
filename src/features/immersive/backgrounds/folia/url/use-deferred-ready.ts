import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/**
 * 「等容器真的有尺寸了再挂子内容」—— url 模式的延迟挂载。
 *
 * 为什么必须延迟（规格 §7.2）：嵌入页的脚本若在 0×0 的视口里初始化，
 * canvas / WebGL 会抛 `IndexSizeError`，而那一下异常发生在**子文档**里，
 * 宿主拿不到、也没法重试 —— 结果就是 iframe 永久白屏。
 * 所以先量容器，量到非零尺寸才让 iframe 出现在 DOM 里。
 *
 * 两条实现取舍：
 *  - **先同步量一次 `getBoundingClientRect()`**：正常情况下容器早就有尺寸了，
 *    不必等一帧 ResizeObserver 回调（那会让每次切 URL 都白闪一下）。
 *  - **不设重试上限**：ResizeObserver 只在尺寸真变时回调，不存在「无限 rAF 循环」，
 *    Folia 注释里提到的 retry guard 在它的代码里也不存在（规格 §7.2 已指出该注释与实现不符）。
 */
export function useDeferredReady(target: Ref<HTMLElement | null>, key: Ref<unknown>): Ref<boolean> {
  const ready = ref(false)
  let observer: ResizeObserver | null = null

  function disconnectObserver(): void {
    observer?.disconnect()
    observer = null
  }

  function measure(): void {
    disconnectObserver()
    ready.value = false

    const element = target.value
    if (!element) return

    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      ready.value = true
      return
    }
    if (typeof ResizeObserver !== 'function') {
      // 没有 ResizeObserver 的环境（理论上不会走到）直接放行：
      // 宁可让子内容面对一个 0×0，也不要永远不挂。
      ready.value = true
      return
    }
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          ready.value = true
          disconnectObserver()
          return
        }
      }
    })
    observer.observe(element)
  }

  // target 与 key 都要盯：容器挂上时量一次；换 URL 时**重新量**
  // （Folia 的 effect 依赖 selectedItem，换项时 ready 会先回到 false）
  watch([target, key], () => measure(), { flush: 'post', immediate: true })

  onBeforeUnmount(disconnectObserver)

  return ready
}
