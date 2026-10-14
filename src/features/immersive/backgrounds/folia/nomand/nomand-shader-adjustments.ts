/**
 * nomand 的固定形状参数、明暗自适应反色、以及两个 overscan 反解 —— 规格 §5.3 / §5.4 的算法重写。
 *
 * 为什么这些数不能散在组件里：overscan 的系数**依赖同一批形状参数的取值**
 * （纸张纹理的图像位移上界 = 各项系数 × 各项幅度），形状参数一改，预放大倍率必须跟着重算，
 * 否则拖动滑块时图像边缘会露底。放在一起才看得见这条耦合。
 */

/** 预放大的上限。再高只是把封面裁没，而极端 bulge 下 shader 自己就会把四角淡出，放大也救不回来。 */
const MAX_OVERSCAN = 1.8
/** 在反解出的最小倍率之上留的余量，避免浮点误差在边缘留下一像素缝。 */
const OVERSCAN_MARGIN = 0.01
/**
 * 估算可见区域用的宽高比。shader 里的边角半径同时取决于画布与图片的宽高比，
 * 运行时拿不到图片原始尺寸，这里取常见宽屏做保守估计：更窄的画布只会多裁一点，不会重新露边。
 */
const REFERENCE_ASPECT = 16 / 9

/**
 * paper-texture 的固定形状参数 —— **按 0.0.81 的片元逐项重推，不是 Folia 的 0.0.80 参数表**（§5.6）。
 *
 * 0.0.80 → 0.0.81 是整段重写（249 → 528 行），参数表全换。下表逐项给出**推导依据**，
 * 因为这是本模式唯一做不到逐像素一致的地方。所有「对齐」都按**幅度上界相等的原理**做，
 * 不是凭观感拍数：
 *
 * | 0.0.80 | 0.0.81 | 推导 |
 * | ------ | ------ | ---- |
 * | `fiberSize: 0.2` | `fiberSize: 0.2` | 同名同义（`mix(4., 1., u_fiberSize)`），且 0.0.80 的 `2./u_fiberSize` 就是同一个尺度参数 |
 * | `crumples: 0.35` | `crumples: 0.35` | 同名同义（0–1 幅度） |
 * | `crumpleSize: 0.35` | `crumpleCount: 8` | 0.0.80 的 crumpleSize 是**频率**（`fract(patternUV*.02/u_crumpleSize)*32.`，尺度 ≈ 粒度/32）；0.0.81 换成**片数**（2–15）。取 8 让 `warpNoise` 的下采样尺度（0.1 / 片数）与 0.0.80 的 0.02/0.35≈0.057 同量级 |
 * | `folds: 0.65` | `folds: 0.65` | 同名同义（0–1 幅度） |
 * | `foldCount: 5` | `foldSizeX/Y: 0` | 0.0.81 的折痕数是 `mix(3., .5, u_foldSize)`，取值域 **0.5–3**，够不到 5。取 0 拿到该参数允许的最多折痕（3 条）—— 这是能力上限，不是映射误差 |
 * | `drops: 0.2` | `drops: 0.2` | 同名同义 |
 * | `seed: 5.8` | `seed: 5.8` | 同名同义（0–1000） |
 * | `contrast: 0.32`（调参） | `blending: 0.32` | 两者都是「图像与纸的融合强度、0–1」，同名量纲 —— 曲线是否一致**未确认** |
 * | `fade: 0` | （删除） | Folia 的取值本来就是 0（不淡出），删除无影响 |
 * | — | `colorPaper` | 0.0.80 没有对应项。Folia 的 `u_colorBack` 同时承担「纸背后的颜色」与「图外露出的底色」，0.0.81 把纸本体拆成独立的 `colorPaper`，取与 `colorBack` 同值最保守 |
 * | — | `wrinkles / wrinkleSize` | 0.0.81 新增。幅度按 `0.38 × wrinkles × 0.5` 参与位移，取 0.3 让该项与 folds 项同量级（见下） |
 * | — | `roughnessSize / roughnessRows` | 拆分项。尺寸取自 0.0.80 的粗糙度尺度（`p/vec2(2,4)`）、行化取 0（均匀散布） |
 * | — | `distortion` | **最重要的翻译**，见下 |
 *
 * ## `distortion` 为什么不是 0
 *
 * 0.0.80 无条件做 `imageUV += .02 * normalImage`，即「图像跟着纸面起伏一起弯曲」。
 * 0.0.81 把这件事收成显式开关：`imageUV` 的三处位移**全部乘 `u_distortion`**。
 * 所以 `u_distortion = 0` 会整条丢掉 Folia 的这个效果，必须给非零值。
 *
 * 取值按**位移上界对齐**反推：
 *  0.0.80 位移上界 = `.02 × (2×folds + 1.5×crumples + .2×drops + .75×roughness + .2×fiber)`
 *                 = `.02 × (1.3 + .525 + .04 + .315 + .06) ≈ 4.5e-2`
 *  0.0.81 位移上界 = `d × (.15×crumples×.5 + .38×wrinkles×.5 + .05×foldDepth + .002×drops + .02×(roughness+fiber)×.5)`
 *                 ≈ `d × (.026 + .057 + .05 + .0004 + .0066) ≈ d × 0.14`
 *  取 `d = 0.32` → `≈ 4.5e-2`，与 0.0.80 同量级。
 *
 * ⚠️ 以上是**幅度对齐**，不是曲线对齐：0.0.81 的纸纹图案本身（`pattern` 的噪声构成）
 * 与 0.0.80 完全是两套噪声，观感只能做到「同一类纸纹」。这一条已在交付报告里标注为已知偏差。
 */
export const NOMAND_PAPER_TEXTURE_SHAPE = {
  fiberSize: 0.2,
  crumples: 0.35,
  crumpleCount: 8,
  folds: 0.65,
  foldSizeX: 0,
  foldSizeY: 0,
  foldOffsetX: 0,
  foldOffsetY: 0,
  wrinkles: 0.3,
  wrinkleSize: 0.5,
  roughnessSize: 0.4,
  roughnessRows: 0,
  drops: 0.2,
  seed: 5.8,
  distortion: 0.32
} as const

/** lens-distortion 里固定的镜头形状参数；overscan 需要读 `focusEdges`。 */
export const NOMAND_LENS_SHAPE = {
  perspective: 0.4,
  count: 20,
  focusCenter: 0.55,
  focusEdges: 0.8,
  swirl: 0.08,
  lensCircle: 0.1
} as const

/**
 * 非有限值一律当 0。
 * 坑：NaN 会一路污染下去 —— `Math.max(0, NaN)` 仍然是 NaN，最后 `u_scale` 拿到 NaN
 * 整屏就黑了（而且不报错）。tuning 是从外部传进来的，必须在入口挡住。
 */
const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

/** 同样是防 NaN：bulge 变 NaN 会把二分的上下界整段带成 NaN。 */
const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const clampOverscan = (scale: number): number => Math.min(MAX_OVERSCAN, Math.max(1, scale))

/** 只在确实需要放大时才补余量，免得不产生位移的参数组合也被无谓地裁掉一圈。 */
const applyOverscanMargin = (scale: number): number =>
  scale <= 1 ? 1 : clampOverscan(scale + OVERSCAN_MARGIN)

/** 图像 UV 每侧被推出去 `margin` 时，遮住裁切边所需的最小放大倍率。 */
const overscanForMargin = (margin: number): number =>
  applyOverscanMargin(1 / (1 - 2 * Math.min(Math.max(margin, 0), 0.45)))

/**
 * 明暗自适应反色。浅色主题下背景底色是亮的，沿用深色主题的亮度方向会让画面主体糊成一团，
 * 所以在非原色模式下把亮度翻转一次。像素画（dithering）一直是这个规则，半调网点沿用同一套。
 */
export function resolveDaylightInversion(
  inverted: boolean,
  originalColors: boolean,
  isDaylight?: boolean
): boolean {
  return isDaylight && !originalColors ? !inverted : inverted
}

/**
 * 半调网点的亮度约定和像素画相反：网点半径按 `mix(.25 * baseR, 0., lum)` 随亮度收缩，
 * 而网点画的是 `colorFront`。深色主题下 colorFront 比 colorBack 亮，于是图像越暗的地方越亮，
 * 整张图看起来是负片（originalColors 模式同理，亮部会缩成网点消失在底色里）。
 * 所以基准值先翻一次，让「关闭反色」得到像素画那种正常观感；明暗自适应叠加在这之上。
 */
export function resolveHalftoneInversion(
  inverted: boolean,
  originalColors: boolean,
  isDaylight?: boolean
): boolean {
  return resolveDaylightInversion(!inverted, originalColors, isDaylight)
}

/**
 * paper-texture 的预放大倍率 —— **按 0.0.81 重新推导，与 Folia 的 0.0.80 公式不是一回事**。
 *
 * 0.0.80 的 `normalImage` 五项系数（folds 2 / crumples 1.5 / drops 0.2 / roughness 0.75 /
 * fiber 0.1）在 0.0.81 里**已不存在**：位移改成三处、且全部乘在 `u_distortion` 上。
 * 现在的位移上界是
 *   `d × (.15×crumples×.5 + .38×wrinkles×.5 + .05×foldDepth + .002×drops + .02×(roughness+fiber)×.5)`
 * （`foldDepth` 取保守值 1、`|centeredUV|²` 取角点 0.5），与 `d` 成正比。
 *
 * 因为位移上界随 roughness / fiber 增长，这两个入参仍然要参与计算 —— 与 Folia 的接口保持一致，
 * 将来接设置面板时调用点不用改。
 */
export function getPaperTextureOverscan(roughness: number, fiber: number): number {
  const shape = NOMAND_PAPER_TEXTURE_SHAPE
  const distortion = Math.abs(shape.distortion)
  const scaleDistortion = 0.15 * shape.crumples * 0.5 + 0.38 * shape.wrinkles * 0.5
  const linearDistortion = 0.002 * shape.drops
  // |centeredUV|² 的最坏取值在画布四角：0.5² + 0.5² = 0.5
  const radialDistortion = 0.02 * (clamp01(roughness) + clamp01(fiber)) * 0.5
  const maxShift = distortion * (scaleDistortion + 0.05 + linearDistortion + radialDistortion)
  return overscanForMargin(maxShift)
}

/**
 * lens-distortion 的预放大倍率。
 *
 * shader 用 `lensWarp` 沿半径把采样点推出去（bulge > 0 时是 tan 映射），推到图外就露底色。
 * 反解条件是「可见区域四角被推到的位置仍落在图内」，即 `push(cornerRn) <= scale * headroom`；
 * cornerRn 随 scale 变小，所以约束随 scale 单调放松，可以直接二分。
 * 另外先把 scale 抬到 shader 开始淡出四角（`rn * bulge >= 1.45`）之前，
 * 一来避免四角被淡成透明，二来让 tan 映射停在未饱和区间，二分才是单调的。
 * bulge <= 0 是向内收缩，只需为边缘残留的色散留余量。
 *
 * 0.0.81 的 `lens-distortion.js` 与 0.0.80 **逐字节相同**（§8.7），所以这个函数可以直接沿用。
 */
export function getLensDistortionOverscan(bulge: number, spread: number): number {
  const outRadius = 0.5 * Math.hypot(REFERENCE_ASPECT, 1)
  const clampedSpread = clamp01(spread)
  const reach = 0.7 * Math.pow(clampedSpread, 1.3 + 2.7 * clampedSpread)
  // focusEdges 已经把边缘处的色散压到 (1 - focusEdges)，只需为这点残量留位置。
  const edgeReach = reach * (1 - NOMAND_LENS_SHAPE.focusEdges)
  const headroom = Math.max(0.35, 1 - edgeReach / outRadius)

  const safeBulge = finiteOr(bulge, 0)
  if (safeBulge <= 0) return applyOverscanMargin(1 / headroom)

  const bulgeAmount = Math.min(safeBulge, 1) * 1.4
  // inradius 在参考宽高比 >= 1 时恒为 .5，所以 cornerRn = cornerRadius / .5 = 2 * outRadius / scale。
  const cornerPush = (scale: number): number => {
    const cornerRn = (2 * outRadius) / scale
    return Math.tan(cornerRn * bulgeAmount) / Math.tan(bulgeAmount) / cornerRn
  }

  let low = Math.max(1, (2 * outRadius * bulgeAmount) / 1.45)
  if (low >= MAX_OVERSCAN || cornerPush(MAX_OVERSCAN) > MAX_OVERSCAN * headroom) return MAX_OVERSCAN
  if (low === 1 && cornerPush(1) <= headroom) return applyOverscanMargin(1 / headroom)

  let high = MAX_OVERSCAN
  for (let step = 0; step < 32; step += 1) {
    const mid = (low + high) / 2
    if (cornerPush(mid) > mid * headroom) low = mid
    else high = mid
  }
  return applyOverscanMargin(high)
}

/** 导出给单测用的常量（避免测试里重复字面量） */
export const NOMAND_OVERSCAN_LIMITS = Object.freeze({
  maxOverscan: MAX_OVERSCAN,
  overscanMargin: OVERSCAN_MARGIN,
  referenceAspect: REFERENCE_ASPECT
})
