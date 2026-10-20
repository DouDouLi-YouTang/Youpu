import { getAudioElement } from '@/app/providers/player-provider'

/**
 * Web Audio 图的唯一所有者(模块级单例)。
 *
 * 图结构固定为 `MediaElementSource → Analyser → destination`:
 *  - 唯一用途是给沉浸式皮肤提供真实频谱数据(AnalyserNode),不改变其它播放语义;
 *  - 叶子模块:只依赖 `getAudioElement`(共享单例音频元素),不 import 任何 store / API,
 *    因此播放器组合式函数、沉浸式皮肤都可以安全引用它。
 *
 * 静默降级契约:任何一步失败(ctx 不可用、元素未初始化、createMediaElementSource 异常等)
 * 都返回 false / null **不抛错**,绝不能让播放报错或中断。
 *
 * ⚠️ 已知语义变化(建图后):
 *  1. 音频输出改由 `AudioContext.destination` 决定,元素自己的 `setSinkId()` 失效
 *     → 输出设备统一走 `setOutputDevice()` 的「双路径」;
 *  2. 建图前在元素上设过的 sinkId 会被静默丢弃 → 此处记住最后一次请求的 deviceId,
 *     建图成功后重放到 ctx 上,避免输出设备莫名跳回默认。
 */

/** 模块级单例 ctx(惰性创建,创建后永不 close —— 其它消费者可能还在用)。 */
let ctx: AudioContext | null = null
/** 图已完成(analyser 已接上 destination)才置 true,作为幂等快速路径。 */
let graphReady = false
/**
 * 元素 → 图 的 source 节点。`createMediaElementSource` 对同一元素**只能调用一次**,
 * 第二次抛 InvalidStateError;用非空判断做结构性防重(即使上一次建图中途失败也不重复创建)。
 */
let mediaSource: MediaElementAudioSourceNode | null = null
let analyser: AnalyserNode | null = null
/**
 * 最后一次请求的输出设备 id(空串=系统默认);null = 用户从未请求过。
 * 建图成功后重放到 ctx 上(见 ensureGraph)。
 */
let requestedDeviceId: string | null = null

/** 惰性创建共享 AudioContext(幂等);不可用时返回 null。 */
export function ensureAudioContext(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  } catch {
    // AudioContext 不可用(极少见)→ 静默降级,播放走元素原生输出
    return null
  }
}

/** 把 deviceId 应用到 AudioContext 上(Chrome 110+ 的 AudioContext.setSinkId;
 *  TS lib.dom 未声明,按元素版的断言写法处理)。失败静默回退默认输出。 */
async function applySinkIdToContext(context: AudioContext, deviceId: string): Promise<void> {
  const target = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }
  if (!target.setSinkId) return
  try {
    await target.setSinkId(deviceId)
  } catch {
    // 设备不存在 / 已被拔出 → 保持默认输出,不打断播放
  }
}

/**
 * 惰性建图 source→analyser→destination(幂等);成功返回 true。
 *
 * 失败(含元素未初始化、未设 crossOrigin、ctx 不可用)一律返回 false 静默降级,
 * 此时没有频谱,但播放完全不受影响。
 */
export function ensureGraph(): boolean {
  if (graphReady) return true
  try {
    const el = getAudioElement()
    // 护栏:没设 crossOrigin 的跨源元素接入 Web Audio 图后会被当作跨域资源,
    // 分析数据恒为 0 且元素输出被静音 —— 白建图还可能听不到声音。
    // player-provider 已无条件设置 crossOrigin='anonymous'(三类音源均有 ACAO)。
    if (!el.crossOrigin) return false
    const context = ensureAudioContext()
    if (!context) return false
    // 先建好 analyser 并设好参数,再执行不可逆的 createMediaElementSource。
    // 元素一旦进图,原生直出就被永久改道(无任何 API 可还原),此后只能靠图内
    // 接到 destination 出声。把可能抛错的节点创建放在改道之前,改道后就只剩两次
    // connect(活 context 下不会抛),从而杜绝「已改道但没接回 destination = 全应用
    // 静音」的半成品状态。
    if (!analyser) {
      analyser = context.createAnalyser()
      analyser.fftSize = 2048 // → frequencyBinCount = 1024
      analyser.smoothingTimeConstant = 0.8
    }
    // 结构性幂等:同一元素只允许 createMediaElementSource 一次,第二次抛
    // InvalidStateError。连线也一并放进这个分支,避免重试时重复 connect。
    if (!mediaSource) {
      mediaSource = context.createMediaElementSource(el)
      mediaSource.connect(analyser)
    }
    // 必须接到 destination:元素进图后声音只从图里出来,漏掉这条线 = 彻底静音。
    analyser.connect(context.destination)
    graphReady = true
    // 建图前用户可能已切过输出设备(当时走元素 setSinkId),建图后该设置被丢弃
    // → 重放最后一次请求,避免输出设备莫名跳回默认。
    if (requestedDeviceId !== null) void applySinkIdToContext(context, requestedDeviceId)
    // 自动播放策略下 ctx 可能是 suspended(挂起时图不出声),尽力 resume,
    // 失败也无妨(后续 play/onPlaying 的用户手势路径还会再 resume 一次)。
    resumeAudioContext()
    return true
  } catch {
    // createMediaElementSource 失败(如元素已被其它图占用)/ 元素未初始化等
    return false
  }
}

/** 频谱分析节点;图未建起来时为 null。 */
export function getAnalyser(): AnalyserNode | null {
  return analyser
}

/**
 * 切换音频输出设备(deviceId 来自 enumerateDevices,空串=系统默认)。
 *
 * 双路径:
 *  - 未建图 → 元素级 `el.setSinkId()`(Chrome 扩展 API,TS lib.dom 未声明,用类型断言);
 *  - 已建图 → `ctx.setSinkId()`(建图后输出走 AudioContext.destination,元素级已失效)。
 *
 * 无论走哪条路径都记住最后一次请求,供 ensureGraph 建图成功后重放。
 */
export function setOutputDevice(deviceId: string): Promise<void> {
  requestedDeviceId = deviceId
  if (graphReady && ctx) return applySinkIdToContext(ctx, deviceId)
  try {
    const el = getAudioElement() as HTMLAudioElement & {
      setSinkId?: (sinkId: string) => Promise<void>
    }
    return el.setSinkId ? el.setSinkId(deviceId) : Promise.resolve()
  } catch {
    // 元素尚未初始化 → 静默忽略;deviceId 已记录,建图时会重放
    return Promise.resolve()
  }
}

/** ctx 当前状态(供 resume 判断);未创建时返回 null。 */
export function getContextState(): AudioContextState | null {
  return ctx?.state ?? null
}

/** 尽力恢复被自动播放策略挂起的 ctx;失败静默(ctx 未创建时为空操作)。 */
export function resumeAudioContext(): void {
  if (!ctx || ctx.state !== 'suspended') return
  ctx.resume().catch(() => {
    // 无用户手势等导致 resume 被拒 → 等下一次手势再试
  })
}
