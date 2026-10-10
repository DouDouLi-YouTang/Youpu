import { getCurrentInstance, onBeforeUnmount, ref, type Ref } from 'vue'

import { ensureGraph, getAnalyser } from '@/features/player/core/audio-graph'

/** 音频频带能量,0–1。真实频谱驱动(AnalyserNode.getByteFrequencyData 平均值 / 255)。 */
export interface AudioBands {
  low: number
  mid: number
  high: number
  power: number
}

/**
 * 全局频带能量(ref,初值全 0)。
 *
 * 契约:`audioBands` 是**只读消费方** —— 皮肤组件直接读取/watch 即可,不要写它;
 * 采样循环由 `useAudioBands()` 的 start/stop 按**订阅计数**启停
 * (多个皮肤同时订阅互不打断)。将来由 SkinShell.vue 在 `v-if="open"` 内 start、
 * 关闭时 stop。图未建起来(getAnalyser() 为 null)时保持全 0,不报错。
 */
export const audioBands: Ref<AudioBands> = ref<AudioBands>({ low: 0, mid: 0, high: 0, power: 0 })

/** 频带边界(Hz)。bin 下标按实际 ctx.sampleRate 换算,不硬编码 44100。 */
const BAND_HZ: Record<keyof AudioBands, readonly [number, number]> = {
  low: [20, 250],
  mid: [250, 2000],
  high: [2000, 8000],
  power: [20, 8000]
}

/** 订阅计数:>0 跑 rAF 循环,归 0 立即停(没有订阅者时不空转)。 */
let subscribers = 0
/** rAF 句柄(唯一):startLoop 用非空判断防重复叠加循环,stop 时 cancelAnimationFrame。 */
let rafId: number | null = null
/** 复用同一块频谱缓冲;analyser 的 binCount 变化时重建。 */
let spectrum: Uint8Array<ArrayBuffer> | null = null

/** 每次赋新对象(而非改动同一个),保证皮肤里的 watch/computed 能感知到变化。 */
function zeroBands(): AudioBands {
  return { low: 0, mid: 0, high: 0, power: 0 }
}

/** 读取一帧频带能量;analyser 缺失(图没建起来)时返回全 0。 */
function readBands(): AudioBands {
  const analyser = getAnalyser()
  if (!analyser) return zeroBands()

  const binCount = analyser.frequencyBinCount
  if (!spectrum || spectrum.length !== binCount) spectrum = new Uint8Array(binCount)
  const buf = spectrum
  analyser.getByteFrequencyData(buf)

  // binOf(hz) = round(hz / (sampleRate/2) * binCount),按实际采样率换算并夹到有效范围
  const nyquist = analyser.context.sampleRate / 2
  const binOf = (hz: number): number =>
    Math.max(0, Math.min(binCount - 1, Math.round((hz / nyquist) * binCount)))
  const average = (fromHz: number, toHz: number): number => {
    let lo = binOf(fromHz)
    const hi = binOf(toHz)
    if (hi < lo) lo = hi
    let sum = 0
    for (let i = lo; i <= hi; i++) sum += buf[i]
    return sum / (hi - lo + 1) / 255
  }

  return {
    low: average(BAND_HZ.low[0], BAND_HZ.low[1]),
    mid: average(BAND_HZ.mid[0], BAND_HZ.mid[1]),
    high: average(BAND_HZ.high[0], BAND_HZ.high[1]),
    power: average(BAND_HZ.power[0], BAND_HZ.power[1])
  }
}

function tick(): void {
  if (rafId === null) return // 已被 stop:不再续帧
  rafId = requestAnimationFrame(tick) // 只在这一处续帧,保证全局只有一条循环
  audioBands.value = readBands()
}

function startLoop(): void {
  if (rafId !== null) return
  rafId = requestAnimationFrame(tick)
}

function stopLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  // 停止后归零,避免下次打开时首帧读到上一次的残影
  audioBands.value = zeroBands()
}

/**
 * 订阅/退订频带采样循环(订阅计数:第一个订阅者启动,最后一个退订者停止)。
 * 在组件 setup 上下文中调用时,`onBeforeUnmount` 会自动 stop。
 */
export function useAudioBands(): { start: () => void; stop: () => void } {
  let active = false
  function start(): void {
    if (active) return // 同一消费者重复 start 不重复计数
    active = true
    subscribers++
    if (subscribers === 1) {
      // 建图是采样的前提。这里顺手保证,而不是要求调用方手动配对 ensureGraph()
      // —— 漏配对不会有任何报错,只会让频带恒为 0(皮肤像静态图),极难排查。
      // ensureGraph() 幂等、静默降级,且只在沉浸页打开(start 的唯一调用场景)执行,
      // 「只在沉浸页建图」的闸门仍由调用时机保证。
      ensureGraph()
      startLoop()
    }
  }
  function stop(): void {
    if (!active) return
    active = false
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0) stopLoop()
  }
  if (getCurrentInstance()) onBeforeUnmount(stop)
  return { start, stop }
}
