import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  DitheringShapes,
  DitheringTypes,
  ditheringFragmentShader,
  getShaderColorFromString,
  meshGradientFragmentShader
} from '@paper-design/shaders'

import type { FoliaAudioBands, FoliaTheme } from '../types'
import {
  createPaperShaderMount,
  objectSizingUniforms,
  patternSizingUniforms,
  updatePaperShaderUniforms,
  type PaperShaderHandle
} from '../shared/paper-shader-mount'
import { extractRepresentativeColors } from '../shared/cover-palette'
import {
  LATENT_FRAME_STATE_INITIAL,
  resolveLatentFrameSpeeds,
  resolveLatentStaticLayerStyles,
  stepLatentFrame,
  type LatentFrameState
} from './latent-frame'
import {
  MAX_SHADER_PIXELS,
  resolveLatentShaderColors,
  resolveLatentShaderSpeed,
  type LatentBackgroundTuning
} from './latent-tuning'

/**
 * latent 的渲染层 —— 双 shader 叠层 + 封面取色 + 音频驱动。
 *
 * 为什么把渲染逻辑从 .vue 里拆出来：
 *  1. AGENTS.md 的组件硬规则（单个 .vue ≤400 行）；
 *  2. 这里全是命令式的 DOM / WebGL 生命周期（挂载竞态、rAF、样式去重），
 *     和模板放在一起会互相遮挡；拆开后 .vue 只剩「结构 + 绑定」。
 *
 * 三条来自 Folia 的行为事实（改动会直接改变画面对不上）：
 *  - **音频不经过 Vue 响应式**：`audioPower()` / `audioBands()` 每帧被调用，
 *    值写进 shader uniform 与层内联样式，永不触发组件重渲染（Folia 用 MotionValue 达到同样效果）。
 *  - `paused` 不是「静帧」：音频目标全部归零、速度降到 `base × 0.12`，rAF 继续跑；
 *    只有 `staticMode` 才 setSpeed(0) 并彻底停掉循环。
 *  - 封面取色的结果只影响**颜色**，颜色变化用 `setUniforms`（立即重画一次）——
 *    与 Folia 的 React 封装一致；逐帧的音频幅度走 `updatePaperShaderUniforms`，
 *    shader 在动的时候只写值不重画（否则每帧画两遍全屏）。
 */

export interface UseLatentRenderOptions {
  theme: Ref<FoliaTheme>
  coverUrl: Ref<string | null>
  audioPower: () => number
  audioBands: () => FoliaAudioBands
  paused: () => boolean
  staticMode: Ref<boolean>
  tuning: Ref<LatentBackgroundTuning>
}

/** 单层要写的样式属性（去重表只关心这三个） */
type LayerStyleProperty = 'opacity' | 'transform' | 'filter'

export function useLatentRender(options: UseLatentRenderOptions) {
  const meshHost = ref<HTMLElement | null>(null)
  const ditherHost = ref<HTMLElement | null>(null)
  const meshLayer = ref<HTMLElement | null>(null)
  const ditherLayer = ref<HTMLElement | null>(null)

  const meshMount = shallowRef<PaperShaderHandle | null>(null)
  const ditherMount = shallowRef<PaperShaderHandle | null>(null)

  const tuning = computed(() => options.tuning.value)
  const showMesh = computed(() => tuning.value.displayMode !== 'dithering')
  const showDithering = computed(() => tuning.value.displayMode !== 'mesh')

  /** 封面代表性色（4-bit 量化 + 加权中位切分，六色） */
  const coverColors = ref<string[]>([])
  /** 取色的竞态令牌：切歌很快时旧封面的结果不许覆盖新封面 */
  let coverToken = 0

  watch(
    options.coverUrl,
    (url) => {
      const token = ++coverToken
      if (!url) {
        coverColors.value = []
        return
      }
      void extractRepresentativeColors(url, 6).then((colors) => {
        if (token === coverToken) coverColors.value = colors
      })
    },
    { immediate: true }
  )

  const shaderColors = computed(() =>
    resolveLatentShaderColors(coverColors.value, options.theme.value, tuning.value.colorSource)
  )

  /** 层样式的上一次写入值：音频静下来后不再每帧塞同样的字符串 */
  const writtenStyles = new WeakMap<HTMLElement, Partial<Record<LayerStyleProperty, string>>>()
  function writeLayerStyle(
    element: HTMLElement | null,
    property: LayerStyleProperty,
    value: string
  ): void {
    if (!element) return
    let written = writtenStyles.get(element)
    if (!written) {
      written = {}
      writtenStyles.set(element, written)
    }
    if (written[property] === value) return
    written[property] = value
    element.style[property] = value
  }

  /**
   * 静态档的层样式（= Folia JSX 里的初始 style，也是 staticMode 下的定格值）。
   *
   * 为什么 staticMode 要把样式**写回去**而不是「不写」：暂停前那一帧可能正处在
   * 音频拉满的状态（filter 是 `saturate(1.4) brightness(1.1)`），不写回就会定格在
   * 那个被放大的中间态上 —— 视觉上像卡住，而不是「静止」。
   */
  function applyStaticLayerStyles(): void {
    const styles = resolveLatentStaticLayerStyles(tuning.value, showMesh.value)
    writeLayerStyle(meshLayer.value, 'transform', styles.meshTransform)
    writeLayerStyle(meshLayer.value, 'filter', styles.meshFilter)
    writeLayerStyle(ditherLayer.value, 'opacity', styles.ditheringOpacity)
    writeLayerStyle(ditherLayer.value, 'transform', styles.ditheringTransform)
  }

  let rafId: number | null = null
  let disposed = false
  let mountToken = 0

  function applySpeeds(): void {
    const current = tuning.value
    const paused = options.paused()
    const staticMode = options.staticMode.value
    meshMount.value?.setSpeed(
      staticMode
        ? 0
        : resolveLatentShaderSpeed(current.meshSpeed, current.meshAudioSpeed, 0, paused)
    )
    ditherMount.value?.setSpeed(
      staticMode
        ? 0
        : resolveLatentShaderSpeed(current.ditheringSpeed, current.ditheringAudioSpeed, 0, paused)
    )
  }

  function stopLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  /**
   * 逐帧音频反应。**不在响应式作用域里跑**：所有输入都是即时读取，
   * 输出只写到 WebGL uniform 与元素内联样式。
   */
  function tick(): void {
    rafId = requestAnimationFrame(tick)
    const current = tuning.value
    const isPaused = options.paused()

    // 全部音频数学在 latent-frame.ts（纯函数、有单测）：
    // 顺序敏感（onset 差分要用上一帧的能量）且系数是按 60fps 调的，放在这里没法断言。
    const frame = stepLatentFrame(
      frameState,
      options.audioBands(),
      options.audioPower(),
      current,
      isPaused,
      showMesh.value
    )
    frameState = frame.state
    const speeds = resolveLatentFrameSpeeds(current, frame.state.smoothedBeatSpeed, isPaused)

    const mesh = meshMount.value
    if (mesh) {
      mesh.setSpeed(speeds.mesh)
      updatePaperShaderUniforms(
        mesh,
        {
          // meshDistortion 的 UI 上限是 2，再加 0.62 —— 会超出 shader 文档的 0–1。
          // 这是 Folia 的既有行为（shader 侧不 clamp），照抄并在此标注为已知越界。
          u_distortion: frame.output.meshDistortion,
          u_swirl: frame.output.meshSwirl
        },
        speeds.mesh !== 0
      )
    }

    const dither = ditherMount.value
    if (dither) {
      dither.setSpeed(speeds.dithering)
      updatePaperShaderUniforms(
        dither,
        { u_pxSize: frame.output.ditheringPxSize },
        speeds.dithering !== 0
      )
    }

    writeLayerStyle(ditherLayer.value, 'opacity', String(frame.output.ditheringLayerOpacity))
    writeLayerStyle(ditherLayer.value, 'transform', frame.output.ditheringTransform)
    writeLayerStyle(meshLayer.value, 'filter', frame.output.meshFilter)
    writeLayerStyle(meshLayer.value, 'transform', frame.output.meshTransform)
  }

  /** 逐帧状态（不可变对象，每帧整体替换；只在 rAF 内读写） */
  let frameState: LatentFrameState = LATENT_FRAME_STATE_INITIAL

  function startLoop(): void {
    if (rafId !== null || disposed) return
    rafId = requestAnimationFrame(tick)
  }

  /** 颜色变化 → 两个 shader 的颜色 uniform。数量少、频率低，走 setUniforms（立即重画一次）。 */
  function applyColors(): void {
    const colors = shaderColors.value
    meshMount.value?.setUniforms({
      u_colors: colors.mesh.map(getShaderColorFromString),
      u_colorsCount: colors.mesh.length
    })
    ditherMount.value?.setUniforms({
      u_colorBack: getShaderColorFromString(colors.ditheringBack),
      u_colorFront: getShaderColorFromString(colors.ditheringFront)
    })
  }

  /** 挂载/卸载两个 shader（displayMode 改变会让某一层消失，宿主也要跟着回收到 context）。 */
  async function syncShaders(): Promise<void> {
    const token = ++mountToken
    const colors = shaderColors.value

    if (!meshHost.value && meshMount.value) {
      meshMount.value.dispose()
      meshMount.value = null
    }
    if (!ditherHost.value && ditherMount.value) {
      ditherMount.value.dispose()
      ditherMount.value = null
    }

    if (meshHost.value && !meshMount.value) {
      const host = meshHost.value
      const mount = await createPaperShaderMount(
        host,
        {
          mode: 'latent',
          fragmentShader: meshGradientFragmentShader,
          uniforms: {
            ...objectSizingUniforms(),
            u_colors: colors.mesh.map(getShaderColorFromString),
            u_colorsCount: colors.mesh.length,
            u_distortion: tuning.value.meshDistortion,
            u_swirl: tuning.value.meshSwirl,
            u_grainMixer: 0,
            u_grainOverlay: 0.01
          },
          minPixelRatio: 1,
          maxPixelCount: MAX_SHADER_PIXELS
        },
        () => !disposed && token === mountToken && meshHost.value === host
      )
      if (disposed || token !== mountToken) {
        mount?.dispose()
        return
      }
      meshMount.value = mount
    }

    if (ditherHost.value && !ditherMount.value) {
      const host = ditherHost.value
      const mount = await createPaperShaderMount(
        host,
        {
          mode: 'latent',
          fragmentShader: ditheringFragmentShader,
          uniforms: {
            ...patternSizingUniforms(),
            u_colorBack: getShaderColorFromString(colors.ditheringBack),
            u_colorFront: getShaderColorFromString(colors.ditheringFront),
            u_shape: DitheringShapes.warp,
            u_type: DitheringTypes['4x4'],
            u_pxSize: tuning.value.ditheringSize
          },
          minPixelRatio: 1,
          maxPixelCount: MAX_SHADER_PIXELS
        },
        () => !disposed && token === mountToken && ditherHost.value === host
      )
      if (disposed || token !== mountToken) {
        mount?.dispose()
        return
      }
      ditherMount.value = mount
    }

    if (options.staticMode.value) {
      applySpeeds()
      applyStaticLayerStyles()
      stopLoop()
    } else {
      applySpeeds()
      startLoop()
    }
  }

  watch([meshHost, ditherHost], () => void syncShaders(), { flush: 'post' })
  watch(shaderColors, () => void applyColors())
  watch(options.staticMode, () => void syncShaders(), { flush: 'post' })
  // paused / tuning 变化只改速度，不必重建 shader
  watch([options.paused, () => tuning.value], () => {
    applySpeeds()
    if (!options.staticMode.value) startLoop()
  })

  onBeforeUnmount(() => {
    disposed = true
    stopLoop()
    meshMount.value?.dispose()
    ditherMount.value?.dispose()
    meshMount.value = null
    ditherMount.value = null
  })

  return {
    meshHost,
    ditherHost,
    meshLayer,
    ditherLayer,
    showMesh,
    showDithering,
    /** 供单测/调试断言用（组件里不读） */
    hasMeshMount: computed(() => meshMount.value !== null),
    hasDitherMount: computed(() => ditherMount.value !== null)
  }
}
