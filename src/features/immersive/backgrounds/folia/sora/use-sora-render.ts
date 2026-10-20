import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  createBufferInfoFromArrays,
  createProgramInfo,
  drawBufferInfo,
  getContext,
  resizeCanvasToDisplaySize,
  setBuffersAndAttributes,
  setUniforms,
  type BufferInfo,
  type ProgramInfo
} from 'twgl.js'

import { parseColorChannels, type RgbChannels } from '../shared/color'
import { useWebglFallback } from '../shared/use-webgl-fallback'
import { markWebgl2Unavailable, releaseWebglContext } from '../shared/webgl-support'
import { SORA_FRAGMENT_SHADER, SORA_PARTICLE_COUNT, SORA_VERTEX_SHADER } from './sora-shaders'

/**
 * sora 的渲染层 —— 150 个 `gl.POINTS` 的星空，一次 draw call。
 *
 * ## 时间推进：为什么不是直接用绝对时间
 *
 * `u_time` 由 `performance.now()` 的**增量**累加，而不是 `now / 1000`。
 * 暂停时把 `lastTimestamp` 置 null，恢复后第一帧只记时间戳、不加时间 ——
 * 于是「暂停 10 分钟再恢复」不会让星空瞬移（用绝对时间就会跳这一大段）。
 *
 * 暂停期间**不是完全不动**：尺寸变化与主题变化仍会触发一次补画
 * （否则暂停时改窗口大小会看到被拉伸的旧帧）。补画用的是当前 `u_time`，不是残影。
 *
 * ## 与 Folia 的差异（本仓库必须补的一条）
 *
 * Folia 卸载时只 `deleteProgram` + `deleteBuffer`，**不 lose context**（§11 风险 5 的补充）。
 * 这里统一走 `releaseWebglContext(canvas)`，且顺序是「先删资源 → 再 lose」——
 * `releaseWebglContext` 内部会检查 `canvas.isConnected`，顺序反了就不会生效。
 *
 * ## 音频
 *
 * **sora 完全不读音频**（规格 §6.4 末尾）：闪烁是纯 `u_time` 的函数。
 * 不要「顺手」把 audioPower 接进 blink —— 那不是 Folia 的行为。
 */

export interface UseSoraRenderOptions {
  theme: Ref<{ primaryColor: string; accentColor: string }>
  isDaylight: Ref<boolean>
  /** 冻结（`paused || staticMode` 在宿主层已合并） */
  paused: Ref<boolean>
}

interface SoraState {
  gl: WebGLRenderingContext | WebGL2RenderingContext
  programInfo: ProgramInfo
  bufferInfo: BufferInfo
}

/**
 * 主题色 → 0–1 的 vec3；解析失败时按明暗回退黑/白（规格 §6.1）。
 *
 * 强调色解析失败**退回主色**而不是黑白：缺失时保持单色星空，比整片星空里
 * 突然混进 10% 的黑点（深色主题下等于隐形）正常得多。
 */
export function resolveSoraParticleColor(
  theme: { primaryColor: string; accentColor: string },
  isDaylight: boolean
): { particle: number[]; accent: number[]; background: number[] } {
  const fallback: RgbChannels = isDaylight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
  const primary = parseColorChannels(theme.primaryColor) ?? fallback
  const accent = parseColorChannels(theme.accentColor) ?? primary
  const toUnit = (channels: RgbChannels): number[] => [
    channels.r / 255,
    channels.g / 255,
    channels.b / 255
  ]
  return {
    particle: toUnit(primary),
    accent: toUnit(accent),
    background: isDaylight ? [1, 1, 1] : [0, 0, 0]
  }
}

export function useSoraRender(options: UseSoraRenderOptions) {
  const canvas = ref<HTMLCanvasElement | null>(null)
  const state = shallowRef<SoraState | null>(null)
  const time = ref(0)
  /** 上一帧时间戳；暂停或首帧时为 null（决定这一帧要不要累加时间） */
  let lastTimestamp: number | null = null
  let animationId: number | null = null
  let disposed = false
  /** 暂停时唯一能触发重画的外界信号：尺寸变化（播放中由帧循环自己 resize） */
  let resizeObserver: ResizeObserver | null = null
  /** 缓存当前颜色，避免每帧同步读 ref（rAF 回调里读 ref 是纯浪费） */
  let currentColors = resolveSoraParticleColor(options.theme.value, options.isDaylight.value)

  const { showFallback } = useWebglFallback({ hasMount: () => state.value !== null })

  function invalidate(): void {
    if (animationId !== null || disposed) return
    animationId = requestAnimationFrame(render)
  }

  function render(now: number): void {
    animationId = null
    const current = state.value
    const target = canvas.value
    if (!current || !target) return

    const isPaused = options.paused.value
    if (!isPaused && lastTimestamp !== null) {
      time.value += (now - lastTimestamp) / 1000
    }
    lastTimestamp = isPaused ? null : now

    const { gl, programInfo, bufferInfo } = current
    resizeCanvasToDisplaySize(target)
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)

    const [r, g, b] = currentColors.background
    gl.clearColor(r, g, b, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // 片元输出的是预乘 alpha，所以是 ONE + ONE_MINUS_SRC_ALPHA（不是纯加法）
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    gl.useProgram(programInfo.program)
    setBuffersAndAttributes(gl, programInfo, bufferInfo)
    setUniforms(programInfo, {
      u_resolution: [gl.canvas.width, gl.canvas.height],
      u_time: time.value,
      u_particle_color: currentColors.particle,
      u_particle_accent_color: currentColors.accent
    })
    drawBufferInfo(gl, bufferInfo, gl.POINTS)

    if (!isPaused) invalidate()
  }

  function disposeState(): void {
    const current = state.value
    if (!current) return
    current.gl.deleteProgram(current.programInfo.program)
    const attribute = current.bufferInfo.attribs?.a_index
    if (attribute?.buffer) current.gl.deleteBuffer(attribute.buffer)
    state.value = null
  }

  /** 建 context / 编译程序 / 建缓冲。失败一律走全局降级标记，不抛错。 */
  function mount(): void {
    const target = canvas.value
    if (!target || state.value || disposed) return

    const gl = getContext(target, {
      alpha: false,
      depth: false,
      antialias: false
    }) as WebGLRenderingContext | null
    if (!gl) {
      markWebgl2Unavailable('sora', new Error('sora 无法创建 WebGL context'))
      return
    }

    let programInfo: ProgramInfo | null
    try {
      programInfo = createProgramInfo(gl, [SORA_VERTEX_SHADER, SORA_FRAGMENT_SHADER])
    } catch (error) {
      // 着色器编译失败（驱动差异 / 精度问题）走同一条降级链，不要冒泡给宿主
      markWebgl2Unavailable('sora', error)
      return
    }
    if (!programInfo) {
      markWebgl2Unavailable('sora', new Error('sora 着色器程序创建失败'))
      return
    }

    // 粒子「索引」是唯一个顶点属性：其余随机量都在 GPU 里按这个索引现算
    const indices = new Float32Array(SORA_PARTICLE_COUNT)
    for (let index = 0; index < SORA_PARTICLE_COUNT; index += 1) indices[index] = index
    const bufferInfo = createBufferInfoFromArrays(gl, {
      a_index: { numComponents: 1, data: indices }
    })

    state.value = { gl, programInfo, bufferInfo }
    lastTimestamp = null
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => invalidate())
      resizeObserver.observe(target)
    }
    invalidate()
  }

  /** 卸载：先停 rAF，再删资源，最后（且必须最后）丢 context。 */
  function unmount(releaseContext: boolean): void {
    if (animationId !== null) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    resizeObserver?.disconnect()
    resizeObserver = null
    const target = canvas.value
    disposeState()
    if (releaseContext) releaseWebglContext(target)
  }

  watch(canvas, () => {
    if (canvas.value) mount()
    else unmount(true)
  })

  watch(
    () => [
      options.theme.value.primaryColor,
      options.theme.value.accentColor,
      options.isDaylight.value
    ],
    () => {
      currentColors = resolveSoraParticleColor(options.theme.value, options.isDaylight.value)
      invalidate()
    }
  )

  watch(options.paused, () => invalidate())

  onBeforeUnmount(() => {
    disposed = true
    unmount(true)
  })

  return {
    canvas,
    time,
    // context 没建起来且全局标记已置位 → 主题底色渐变兜底（规格 §10.4 降级链）
    showFallback,
    /** 调试/测试用 */
    hasContext: (): boolean => state.value !== null,
    invalidate
  }
}
