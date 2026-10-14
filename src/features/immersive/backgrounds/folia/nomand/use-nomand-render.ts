import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { getShaderNoiseTexture, type ShaderMountUniforms } from '@paper-design/shaders'

import type { FoliaTheme } from '../types'
import { createPaperShaderMount, type PaperShaderHandle } from '../shared/paper-shader-mount'
import { useWebglFallback } from '../shared/use-webgl-fallback'
import { NOMAND_MAX_PIXEL_COUNT, resolveNomandShaderPlan } from './nomand-uniforms'
import type { NomandBackgroundTuning } from './nomand-tuning'

/**
 * nomand 的渲染层 —— 单档 Paper 图像滤镜，换 effect / 换图都整块重建。
 *
 * ## 与 Folia 的一致之处（改动会让画面走样）
 *
 * - shader 的 key 是 `${sourceUrl}:${effect}`：换图或换 effect 都会**强制重建** ShaderMount。
 *   nomand **没有** `paused` / `staticMode`（Folia `nomand/entry.tsx:17-24` 就不吃这两个 prop），
 *   它永远按 shader 自身的速度跑，所以这里也不做速度控制（`speed = 0`，
 *   五个 effect 的默认 speed 都是 0，即静态图像 —— 动画只来自图像本身的烘焙，不是 shader 时间）。
 * - 每个 shader 的 `maxPixelCount = 1920 * 1080`、`minPixelRatio = 1`。
 * - `mipmaps`：fluted-glass / paper-texture / lens-distortion 传 `['u_image']`；
 *   image-dithering / halftone-dots 不传（屏幕空间图案，mip 只会糊）。
 *
 * ## 与 Folia 的差异（本仓库必须补的一条）
 *
 * **Folia 的 nomand 没有做 WebGL context 释放**（`NomandBackgroundLayer.tsx` 全文没有
 * `createPaperShaderReleaseRef`），而它的 shader key 会在换 effect 时重建 ——
 * 每切一次 effect 漏一个 context（§11 风险 5）。这里所有卸载路径统一走
 * `createPaperShaderMount` 的 `dispose()`（内含 `releaseWebglContext`）。
 */

export interface UseNomandRenderOptions {
  theme: Ref<FoliaTheme>
  isDaylight: Ref<boolean>
  sourceUrl: Ref<string | null>
  tuning: Ref<NomandBackgroundTuning>
}

export function useNomandRender(options: UseNomandRenderOptions) {
  const host = ref<HTMLElement | null>(null)
  const mount = shallowRef<PaperShaderHandle | null>(null)
  /** 当前已挂载的 shader key（`sourceUrl:effect`），用于判断是否需要重建 */
  const mountedKey = ref<string | null>(null)

  const plan = computed(() =>
    resolveNomandShaderPlan(options.tuning.value, options.theme.value, options.isDaylight.value)
  )
  const shaderKey = computed(() =>
    options.sourceUrl.value ? `${options.sourceUrl.value}:${plan.value.effect}` : null
  )

  let disposed = false
  let mountToken = 0

  const { showFallback } = useWebglFallback({ hasMount: () => mount.value !== null })

  /**
   * paper-texture 独占的噪声纹理。
   *
   * 0.0.81 的 shader 包**内部没有任何文件 import `getShaderNoiseTexture`**
   * （已 grep 确认），只有 `shaders-react` 的 paper-texture 组件用它 ——
   * 我们不走 React 封装，就必须自己调它并塞进 `u_noiseTexture`，否则纸张颗粒会全黑。
   *
   * 放在这里而不是 `nomand-uniforms.ts`：它内部 `new Image()`，node 环境不存在该构造函数，
   * 放进纯函数里会让那份映射表无法单测。
   */
  function extraImageUniforms(effect: NomandBackgroundTuning['effect']): ShaderMountUniforms {
    return effect === 'paper-texture' ? { u_noiseTexture: getShaderNoiseTexture() } : {}
  }

  async function syncShader(): Promise<void> {
    const token = ++mountToken
    const url = options.sourceUrl.value
    const key = shaderKey.value

    // 没有图源：卸掉 shader，只留底色（Folia `:42-49` 同款行为）
    if (!url || !key) {
      if (mount.value) {
        mount.value.dispose()
        mount.value = null
      }
      mountedKey.value = null
      return
    }

    // key 没变就什么都不做（主题色变化走 setUniforms 那条路，见下）
    if (mount.value && mountedKey.value === key) return

    const target = host.value
    if (!target) return

    const previous = mount.value
    const current = plan.value
    const next = await createPaperShaderMount(
      target,
      {
        mode: 'nomand',
        fragmentShader: current.fragmentShader,
        uniforms: {
          u_image: url,
          ...current.uniforms,
          ...extraImageUniforms(current.effect)
        },
        minPixelRatio: 1,
        maxPixelCount: NOMAND_MAX_PIXEL_COUNT,
        mipmaps: current.mipmaps
      },
      () => !disposed && token === mountToken
    )

    if (disposed || token !== mountToken) {
      next?.dispose()
      return
    }

    // 先挂新的再卸旧的：两者共用同一个宿主 div，中间不留空白帧
    mount.value = next
    mountedKey.value = next ? key : null
    previous?.dispose()
  }

  /**
   * 主题色 / tuning 变化：**不重建 shader**，只写 uniform。
   *
   * 为什么能这样做而 Folia 不能：Folia 每次渲染都新建 tuning 对象，`key` 又是
   * `sourceUrl:effect`，所以它的重建只由「图源 + effect」触发；主题色变化走的是
   * `colorPropsAreEqual` 那条 props 比较 → 重新下发 uniform。这里等价。
   */
  function applyUniforms(): void {
    const current = mount.value
    if (!current) return
    // 只重下发颜色类 uniform：图像与形状参数跟 key 绑定，key 没变就说明它们也没变
    const { uniforms } = plan.value
    const colors: ShaderMountUniforms = {}
    for (const [key, value] of Object.entries(uniforms)) {
      if (key.startsWith('u_color')) colors[key] = value
    }
    if (Object.keys(colors).length > 0) current.setUniforms(colors)
  }

  watch(shaderKey, () => void syncShader(), { flush: 'post', immediate: true })
  watch(
    () => [options.theme.value, options.tuning.value],
    () => applyUniforms()
  )

  onBeforeUnmount(() => {
    disposed = true
    mount.value?.dispose()
    mount.value = null
    mountedKey.value = null
  })

  return {
    host,
    // shader 没挂上且全局标记已置位 → 主题底色渐变兜底（规格 §10.4 降级链）
    showFallback,
    /** 调试/测试用：当前是否挂着 shader */
    hasMount: computed(() => mount.value !== null),
    mountedKey
  }
}
