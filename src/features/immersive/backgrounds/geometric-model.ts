/**
 * 几何背景的形状 / 粒子生成 —— 纯函数，可在 node 环境单测。
 *
 * 视觉来源：Folia `backgrounds/common/GeometricBackground.tsx`（AGPL-3.0）的**思路**，
 * 代码为独立重写（本项目 MIT）。提炼到的规则：
 *  - 15 个形状 + 20 个粒子，位置/尺寸/时长/延迟/透明度全部随机
 *  - 形状四型：圆（只描边）、方（描边或填充）、三角（clip-path）、十字（clip-path 十二边形）
 *  - 圆/方默认 1px 描边（次要色），三角/十字填充；另有约 30% 概率给圆/方填充
 *  - 尺寸 40–140px，动画时长 30–60s，延迟 0–5s，透明度 0.11–0.19
 *  - 粒子 1–5px、20 个、透明度 0–0.3、上浮 15–35s
 *  - 形状左右漂移 ±15px、上下 ±30px、同时自转整整一圈
 *  - 每个形状绑定一个频带做缩放（圆←低音、方←中低、三角←中、十字←高音）
 *
 * **与 Folia 的差别（有意为之）**：Folia 用 `Math.random()`，每次进页面形状都不一样，
 * 且每次重渲染（React 的 useMemo 依赖）都可能重掷。这里改为**确定性种子**：
 * 同一首歌、同一次会话内布局稳定 —— 进沉浸页、切皮肤、暂停都不会让形状「跳一下」。
 * 复用「倾诉」面板已经写好并测过的哈希式 seededRandom（同一 seed + index 恒等），
 * 不引入第二套随机源。
 */
import { seededRandom } from '@/features/immersive/skins/tilt/core/seeded-random'

/** 形状类型。图标形状用 lucide 的图标名（见 BACKGROUND_ICON_NAMES） */
export type GeometricShapeType = 'circle' | 'square' | 'triangle' | 'cross' | 'icon'

/** 图标形状可用的 lucide 图标名（必须是 @lucide/vue 的真实具名导出） */
export const BACKGROUND_ICON_NAMES = [
  'Star',
  'Sparkle',
  'Cloud',
  'Triangle',
  'Hexagon',
  'Diamond',
  'Flower',
  'Leaf',
  'Zap',
  'Asterisk',
  'Heart',
  'PawPrint'
] as const

export type BackgroundIconName = (typeof BACKGROUND_ICON_NAMES)[number]

/** 形状数量 / 粒子数量（对齐 Folia 的 15 / 20） */
export const SHAPE_COUNT = 15
export const PARTICLE_COUNT = 20

/** 图标形状的数量上限（Folia 的 iconCount < 6） */
const ICON_LIMIT = 6
/** 有图标可放时，单个形状改用图标的概率（Folia 的 Math.random() > 0.7） */
const ICON_PROBABILITY = 0.3

/** 尺寸范围（px）与动画时长范围（s） */
const SHAPE_SIZE_MIN = 40
const SHAPE_SIZE_SPAN = 100
const SHAPE_DURATION_MIN = 30
const SHAPE_DURATION_SPAN = 30
const SHAPE_DELAY_SPAN = 5
const SHAPE_OPACITY_MIN = 0.11
const SHAPE_OPACITY_SPAN = 0.08
/** 圆/方被填充（而非描边）的概率 */
const FILLED_PROBABILITY = 0.3

/** 粒子：尺寸 / 上下浮动幅度 / 透明度 / 时长 */
const PARTICLE_SIZE_MIN = 1
const PARTICLE_SIZE_SPAN = 4
const PARTICLE_OPACITY_SPAN = 0.3
const PARTICLE_DURATION_MIN = 15
const PARTICLE_DURATION_SPAN = 20
const PARTICLE_DELAY_SPAN = 10

/** 漂移幅度：左右 ±15px、上下 ±30px（Folia 的 animate x/y 关键帧） */
export const SHAPE_DRIFT_X_PX = 15
export const SHAPE_DRIFT_Y_PX = 30
/** 粒子每次上浮的距离（px） */
export const PARTICLE_RISE_PX = 100

/**
 * 种子索引区段。core/seeded-random 的索引约定里 100+ 与 200 已被「倾诉」排版占用，
 * 这里从 1000 起另开一段，避免两处随机互相踩。
 */
const SEED_BASE = 1000
/** 每个形状占 10 个索引（形状位/图标位/横/纵/尺寸/时长/延迟/透明度/方向/填充） */
const SHAPE_STRIDE = 10
/** 每个粒子占 6 个索引（尺寸/横坐标/纵坐标/透明度/时长/延迟） */
const PARTICLE_STRIDE = 6
const PARTICLE_SEED_BASE = SEED_BASE + SHAPE_COUNT * SHAPE_STRIDE

/** 一个背景形状（渲染时直接映射成内联样式 + CSS 变量） */
export interface GeometricShape {
  id: number
  type: GeometricShapeType
  /** type === 'icon' 时的 lucide 图标名 */
  icon: BackgroundIconName | null
  /** 左上角位置（百分比，0–100） */
  leftPct: number
  topPct: number
  /** 边长（px）；图标同宽高 */
  sizePx: number
  /** 一轮漂移 + 自转的时长（秒） */
  durationSec: number
  delaySec: number
  opacity: number
  /** true = 反向漂移（Folia 的 reverse：先向下再向上） */
  reverse: boolean
  /** 圆/方是否填充（否则 1px 描边）；三角/十字无描边概念，恒填充 */
  filled: boolean
  /** 初始旋转角（度），自转到 +360 结束 */
  rotationDeg: number
}

/** 一个上浮粒子 */
export interface GeometricParticle {
  id: number
  leftPct: number
  topPct: number
  sizePx: number
  durationSec: number
  delaySec: number
  opacity: number
}

/**
 * 形状 → 驱动它缩放的频带。
 * Folia：圆←bass、方←lowMid、三角←mid、十字←treble、图标←vocal。
 * 本项目 `AudioBands` 只有 low / mid / high / power 四档，映射为：
 *   圆←low、方←low、三角←mid、十字←high、图标←power
 * （四档里没有 vocal，用最接近的 mid 语义位置让图标吃 power，整体最不容易「死」）。
 */
export const SHAPE_BAND: Record<GeometricShapeType, 'low' | 'mid' | 'high' | 'power'> = {
  circle: 'low',
  square: 'low',
  triangle: 'mid',
  cross: 'high',
  icon: 'power'
}

/** [0,1) 随机源：把 (seed, index) 折到 0–1。所有取随机值都走这里，便于单测替换语义 */
function rand(seed: number, index: number): number {
  return seededRandom(seed, index)
}

/** [min, max) 区间取值 */
function randRange(seed: number, index: number, min: number, max: number): number {
  return min + rand(seed, index) * (max - min)
}

/** 形状主类型（不含 icon）：四选一 */
const BASE_SHAPE_TYPES: readonly Exclude<GeometricShapeType, 'icon'>[] = [
  'circle',
  'square',
  'triangle',
  'cross'
]

/**
 * 生成一整套形状。同一 (seed, useIcons) 恒定输出同一套 —— 进页面/切皮肤不会重掷。
 *
 * @param seed     种子，约定用歌曲 id 的数值折叠（见 resolveGeometricSeed）
 * @param useIcons 是否允许放图标形状（无图标库时传 false）
 */
export function buildShapes(seed: number, useIcons: boolean): GeometricShape[] {
  const shapes: GeometricShape[] = []
  let iconCount = 0

  for (let index = 0; index < SHAPE_COUNT; index++) {
    const base = SEED_BASE + index * SHAPE_STRIDE
    const wantIcon = useIcons && rand(seed, base) < ICON_PROBABILITY && iconCount < ICON_LIMIT
    if (wantIcon) iconCount += 1

    const icon: BackgroundIconName | null = wantIcon
      ? BACKGROUND_ICON_NAMES[
          Math.floor(rand(seed, base + 1) * BACKGROUND_ICON_NAMES.length) %
            BACKGROUND_ICON_NAMES.length
        ]
      : null

    shapes.push({
      id: index,
      type: icon
        ? 'icon'
        : BASE_SHAPE_TYPES[
            Math.floor(rand(seed, base + 2) * BASE_SHAPE_TYPES.length) % BASE_SHAPE_TYPES.length
          ],
      icon,
      leftPct: rand(seed, base + 3) * 100,
      topPct: rand(seed, base + 4) * 100,
      sizePx: randRange(seed, base + 5, SHAPE_SIZE_MIN, SHAPE_SIZE_MIN + SHAPE_SIZE_SPAN),
      durationSec: randRange(
        seed,
        base + 6,
        SHAPE_DURATION_MIN,
        SHAPE_DURATION_MIN + SHAPE_DURATION_SPAN
      ),
      delaySec: rand(seed, base + 7) * SHAPE_DELAY_SPAN,
      opacity: randRange(seed, base + 8, SHAPE_OPACITY_MIN, SHAPE_OPACITY_MIN + SHAPE_OPACITY_SPAN),
      reverse: rand(seed, base + 8) > 0.5,
      filled: rand(seed, base + 9) < FILLED_PROBABILITY,
      rotationDeg: rand(seed, base + 9) * 360
    })
  }

  return shapes
}

/** 生成粒子。同一 (seed) 恒定输出同一套 */
export function buildParticles(seed: number): GeometricParticle[] {
  const particles: GeometricParticle[] = []
  for (let index = 0; index < PARTICLE_COUNT; index++) {
    const base = PARTICLE_SEED_BASE + index * PARTICLE_STRIDE
    particles.push({
      id: index,
      sizePx: randRange(seed, base, PARTICLE_SIZE_MIN, PARTICLE_SIZE_MIN + PARTICLE_SIZE_SPAN),
      leftPct: rand(seed, base + 1) * 100,
      topPct: rand(seed, base + 2) * 100,
      opacity: rand(seed, base + 3) * PARTICLE_OPACITY_SPAN,
      durationSec: randRange(
        seed,
        base + 4,
        PARTICLE_DURATION_MIN,
        PARTICLE_DURATION_MIN + PARTICLE_DURATION_SPAN
      ),
      delaySec: rand(seed, base + 5) * PARTICLE_DELAY_SPAN
    })
  }
  return particles
}

/**
 * 频带能量 → 缩放倍率。
 *
 * Folia 走 framer-motion 的 `useSpring` + `useTransform([10, 200], [0.95, 1.45])`：
 * 弹簧平滑 + 输入区 10–200（那是它自己的 0–255 量纲）。本项目频带已是 0–1 的
 * 平均值，所以：
 *  - 输入区取 [0, 0.6]：实测频带均值很少超过 0.6，再高会让形状一直顶在最大档
 *  - 输出 [0.95, 1.45] 与 Folia 相同
 *  - **不做弹簧**，改由 CSS transition 平滑（见 rnp-background-geometric 的 transition：
 *    0.12s）—— 频带本来就每帧刷新，再用 JS 弹簧只是多一层延迟
 */
export const BAND_SCALE_MIN = 0.95
export const BAND_SCALE_MAX = 1.45
export const BAND_INPUT_MAX = 0.6

export function resolveBandScale(band: number, isPlaying: boolean): number {
  if (!isPlaying) return BAND_SCALE_MIN
  // 先杀 NaN 再夹取：Math.min/Math.max 遇到 NaN 会一路传染成 NaN，
  // 而 NaN 写进 CSS 变量会让整个形状消失（比「缩放不对」严重得多）。
  // ±Infinity 走夹取路径（+Inf → 最大档、-Inf → 静止档），符合「夹进区间」的语义。
  const safe = Number.isNaN(band) ? 0 : band
  const clamped = Math.min(Math.max(safe, 0), BAND_INPUT_MAX)
  const ratio = clamped / BAND_INPUT_MAX
  return BAND_SCALE_MIN + ratio * (BAND_SCALE_MAX - BAND_SCALE_MIN)
}

/**
 * 由歌曲 id 折出一个稳定种子。**不用行起始时间** —— 背景不该随每一句歌词重掷。
 * 没有歌（列表页/未播放）时回退 0，仍是一套固定形状，不会因随机而闪。
 *
 * `Song.id` 在本项目是 `number`（src/domain/song.ts:26），字符串分支是为了容错：
 * 有些接口/session 恢复路径会把 id 传成数字字符串。两条分支必须给**同一个**种子，
 * 否则「同一首歌」在两条路径下会画出两套形状 —— 表现为切歌时形状莫名换一套。
 * 所以字符串先尝试按数字解析，解析不出（非数字 id）才退到字符哈希。
 */
export function resolveGeometricSeed(songId: string | number | null | undefined): number {
  if (songId === null || songId === undefined) return 0
  if (typeof songId === 'number') return Number.isFinite(songId) ? Math.trunc(songId) : 0
  if (songId === '') return 0
  const asNumber = Number(songId)
  if (Number.isFinite(asNumber)) return Math.trunc(asNumber)
  // 非数字 id：逐字符折叠，保证同 id 恒等
  let hash = 0
  for (let i = 0; i < songId.length; i++) {
    hash = (Math.imul(hash, 31) + songId.charCodeAt(i)) | 0
  }
  return hash
}
