<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useSlots, watch } from 'vue'

import type { LyricLine, LyricWord } from '@/domain/lyric'

const DEFAULT_DURATION = 500

interface LineTransform {
  top: number
  scale: number
  blur: number
  opacity: number
  delay: number
  duration: number
  /** lyric-rotate 曲率旋转角度（2D rotate），0 表示不旋转 */
  rotate: number
  /** 旋转后绕远点产生的垂直位移补偿，叠加到 top */
  extraTop: number
  /** 旋转后绕远点产生的水平位移补偿，叠加到 left */
  left: number
  /** 距当前行过远，旋转模式下隐藏 */
  hidden: boolean
}

const props = defineProps<{
  lines: LyricLine[]
  activeIndex: number
  /** 歌词基准字号 px，驱动行间距 SPACE = fontSize * 1.2 与 CSS font-size */
  fontSize?: number
  /** 当前行垂直锚定位置百分比（30=居上，50=居中） */
  alignmentPercentage?: number
  /** 远离当前行的缩放效果总开关（参考项目 lyric-zoom） */
  enableZoom?: boolean
  /** 远离当前行的模糊效果总开关（参考项目 lyric-blur） */
  enableBlur?: boolean
  /** 远离当前行的透明度渐隐总开关（参考项目 lyric-fade） */
  enableFade?: boolean
  /** 行间错位滚动动画总开关（参考项目 lyric-stagger，控制 delay 与 200ms 提前量） */
  enableStagger?: boolean
  /** 歌词曲率旋转总开关（参考项目 lyric-rotate，2D rotate + 位移补偿） */
  enableRotate?: boolean
  /** 曲率强度，单位 deg（参考项目 lyric-rotate-curvature，10–80，默认 30） */
  rotateCurvature?: number
  /** 逐字动画：float=逐词上浮 / slide=逐词滑入。需 line.words(YRC 逐字时间戳)才生效。 */
  karaokeAnimation?: 'float' | 'slide'
  /** 当前播放时间 ms,驱动逐字动画的 per-word transition-delay。未传则不启用逐字。 */
  currentTimeMs?: number
  /** 长音发光动画：只对当前行 trailing word 按 word.timeMs 延迟生效，由沉浸页 lyricGlow 设置驱动。 */
  enableLyricGlow?: boolean
  /** 播放状态：暂停时定格逐字过渡并冻结长音发光的 CSS 动画时钟，恢复时从暂停点续跑。 */
  isPlaying?: boolean
}>()

const emit = defineEmits<{
  seek: [timeMs: number]
}>()

const fontSize = computed(() => props.fontSize ?? 32)
const alignmentPercentage = computed(() => props.alignmentPercentage ?? 50)
const SPACE = computed(() => fontSize.value * 1.2)
const enableZoom = computed(() => props.enableZoom ?? true)
const enableBlur = computed(() => props.enableBlur ?? true)
const enableFade = computed(() => props.enableFade ?? true)
// 默认 true：对齐参考项目 getSetting('lyric-stagger', true) 与 store 默认值。
// 独立消费者（如 LyricPanel）不传该 prop 时也启用错位滚动，避免回归丢失逐行级联动画。
const enableStagger = computed(() => props.enableStagger ?? true)
const enableRotate = computed(() => props.enableRotate ?? false)
const rotateCurvature = computed(() => props.rotateCurvature ?? 30)
const enableLyricGlow = computed(() => props.enableLyricGlow ?? false)
const isPlaying = computed(() => props.isPlaying ?? true)

const containerEl = ref<HTMLElement | null>(null)
const lineEls = ref<HTMLElement[]>([])
const containerHeight = ref(0)
const lineHeights = ref<number[]>([])
const transforms = ref<LineTransform[]>([])
const reducedMotion = ref(false)
// contributors 具名 slot 是否被父填充 —— 决定 transforms 是否多算一项(末项)驱动其滚动。
const slots = useSlots()
const hasContributorsSlot = computed(() => Boolean(slots.contributors))
let previousFocusedLine = 0
let hasLaidOut = false
let shouldAnimateNext = false

// 用户滚轮浏览歌词:滚轮改变 anchorLineIndex(视觉焦点行),触发 recalc 让该行
// 居中并应用 offset=0 的放大/清晰样式,周围行按距焦点行距离缩放/模糊/渐隐 --
// 与播放切行完全相同的层次动画,而非整体平移。播放行(activeLineIndex)仍驱动
// :offset 透明度高亮与逐字,所以滚动浏览时也能看到播到哪一行。停止滚动 2s 后
// anchor 回到当前播放行,平滑恢复跟随。
// 用 window capture 监听而非在 .rnp-lyrics 绑 @wheel:沉浸层 .immersive-content
// pointer-events:none(让底部进度条可点),.rnp-lyrics 继承 none 收不到事件;
// 容器若改 auto 会挡住进度条。capture 阶段按容器 rect 命中判定,不破坏现有穿透。
const isUserScrolling = ref(false)
// 视觉焦点行:驱动 recalcTransforms 的 top 锚点与 scale/blur/opacity。正常跟随
// activeLineIndex;滚轮时由用户改变,2s 后回到 activeLineIndex。初始 0,由
// activeIndex watcher immediate 同步到真实播放行。
const anchorLineIndex = ref(0)
let scrollResumeTimer: number | null = null
// deltaY 累积器:触摸板/鼠标滚轮 deltaY 不整除行高,累积到阈值(100px)滚一行。
let wheelAccumulator = 0

function resetUserScroll(): void {
  isUserScrolling.value = false
  wheelAccumulator = 0
  anchorLineIndex.value = activeLineIndex.value
  if (scrollResumeTimer !== null) {
    window.clearTimeout(scrollResumeTimer)
    scrollResumeTimer = null
  }
}

function isInsideContainer(e: globalThis.WheelEvent): boolean {
  const el = containerEl.value
  if (!el) return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  return (
    e.clientX >= rect.left &&
    e.clientX <= rect.right &&
    e.clientY >= rect.top &&
    e.clientY <= rect.bottom
  )
}

function isInsideFloatingOverlay(target: EventTarget | null): boolean {
  // Element 涵盖 HTMLElement 与 SVGElement:图标 <svg> 也是 Element,
  // 用 HTMLElement 会漏判 svg target(如音量图标),导致滚音量时歌词误滚
  let node = target instanceof Element ? target : null
  while (node && node !== document.body) {
    if (
      node.classList.contains('immersive-settings') ||
      node.classList.contains('immersive-controls') ||
      node.classList.contains('ant-drawer') ||
      node.classList.contains('ant-modal') ||
      node.classList.contains('ant-popover') ||
      node.classList.contains('ant-dropdown') ||
      node.classList.contains('ant-select-dropdown') ||
      node.classList.contains('ant-cascader-dropdown') ||
      node.classList.contains('ant-picker-dropdown')
    ) {
      return true
    }
    const style = window.getComputedStyle(node)
    if (
      (style.overflowY === 'auto' ||
        style.overflowY === 'scroll' ||
        style.overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight
    ) {
      return true
    }
    node = node.parentElement
  }
  return false
}

function onWheel(e: globalThis.WheelEvent): void {
  if (isInsideFloatingOverlay(e.target)) return
  if (props.lines.length === 0 || !isInsideContainer(e)) return
  e.preventDefault()
  isUserScrolling.value = true
  // 滚轮切焦点行要有和播放切行一样的层次过渡动画
  shouldAnimateNext = true
  // deltaY>0(向下滚)-> anchor 增大 -> 焦点行下移 -> 看到下方歌词,符合自然滚动方向
  wheelAccumulator += e.deltaY
  const step = 100
  while (Math.abs(wheelAccumulator) >= step) {
    const dir = wheelAccumulator > 0 ? 1 : -1
    wheelAccumulator -= dir * step
    const next = Math.max(0, Math.min(props.lines.length - 1, anchorLineIndex.value + dir))
    if (next === anchorLineIndex.value) {
      // 到边界,丢弃剩余累积,避免松开滚轮后残量在下次触发跳行
      wheelAccumulator = 0
      break
    }
    anchorLineIndex.value = next
  }
  if (scrollResumeTimer !== null) window.clearTimeout(scrollResumeTimer)
  scrollResumeTimer = window.setTimeout(() => {
    scrollResumeTimer = null
    isUserScrolling.value = false
    wheelAccumulator = 0
    // 回到当前播放行,要平滑过渡(anchor watch 触发 recalc)
    shouldAnimateNext = true
    anchorLineIndex.value = activeLineIndex.value
  }, 2000)
}

if (typeof window !== 'undefined') {
  window.addEventListener('wheel', onWheel, { passive: false, capture: true })
}

const activeLineIndex = computed(() =>
  Math.max(0, Math.min(props.activeIndex, props.lines.length - 1))
)

function setLineRef(el: Element | null, i: number): void {
  if (el) lineEls.value[i] = el as HTMLElement
}

function recalcContainerSize(): void {
  const el = containerEl.value
  if (!el) return
  containerHeight.value = el.clientHeight
}

function recalcLineHeights(): void {
  lineHeights.value = props.lines.map((_, i) => lineEls.value[i]?.clientHeight || 0)
}

function scaleByOffset(offset: number): number {
  const d = Math.abs(offset)
  const value = Math.max(1 - d * 0.2, 0)
  return value * value * value * 0.3 + 0.7
}

function blurByOffset(offset: number): number {
  const d = Math.abs(offset)
  if (d === 0) return 0
  return Math.min(0.5 + d, 4.5)
}

function opacityByDistance(distance: number): number {
  // ponytail: 渐隐范围随可视歌词容器高度缩放，半个容器高度处完全透明。
  return Math.max(1 - (Math.abs(distance) * 2) / containerHeight.value, 0)
}

function delayByOffset(offset: number, current: number): number {
  // 参考项目 lyric-stagger 关闭时直接返回 0：行间无错位延迟
  if (!enableStagger.value) return 0
  if (!hasLaidOut || !shouldAnimateNext || reducedMotion.value || current === previousFocusedLine)
    return 0
  const sign = current - previousFocusedLine > 0 ? 1 : -1
  return (Math.max(-4, Math.min(4, offset)) * sign + 4) * 50
}

/**
 * lyric-rotate 曲率变换 —— 逐字移植参考项目 lyrics.js setRotateTransform。
 *
 * 名为「曲率」实为 2D rotate：行距当前行越远，旋转角度越大（上限 90°）。
 * 因旋转中心是屏幕外的一个远点（由 RotateCurvature 决定），旋转后元素会
 * 产生位移，故用 extraTop / left 把元素拉回到视觉正确位置。
 * 旋转模式还会用基于距离的 opacity 衰减覆盖 lyric-fade 的透明度，并把
 * 过远的行标记为 hidden。
 */
function setRotateTransform(t: LineTransform, yOffset: number, height: number): void {
  if (!enableRotate.value) return
  const originX = -120 + (rotateCurvature.value - 25)
  const originY = -(yOffset + height / 2)
  const len = Math.sqrt(originX * originX + originY * originY)
  t.rotate = Math.min((yOffset / window.innerHeight) * -rotateCurvature.value, 90)
  const deg = t.rotate + (Math.atan2(originY, originX) * 180) / Math.PI
  t.extraTop = Math.sin((deg * Math.PI) / 180) * len - originY
  t.left = Math.cos((deg * Math.PI) / 180) * len - originX
  const opacity = 1 - Math.abs((yOffset * 2) / window.innerHeight) ** 1.15 * 1.2
  t.opacity = Math.max(opacity, 0)
  t.hidden = opacity <= -1.5
}

async function recalcTransforms(): Promise<void> {
  await nextTick()
  recalcContainerSize()
  recalcLineHeights()
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const count = props.lines.length
  const hasContributors = hasContributorsSlot.value
  if ((count === 0 && !hasContributors) || containerHeight.value === 0) {
    transforms.value = []
    return
  }

  const heights = lineHeights.value
  // activeIndex=-1 表示播放进度还没到第一句,但视觉上仍应把第一句当作焦点。
  // 否则开头阶段会关闭 zoom/blur/fade,所有歌词平铺且无层次,直到第一句开始才突然生效。
  const hasVisualFocus = count > 0
  const current = anchorLineIndex.value
  const motionOk = hasVisualFocus && !reducedMotion.value
  const useScale = motionOk && enableZoom.value
  const useBlur = motionOk && enableBlur.value
  const useFade = hasVisualFocus && enableFade.value
  const shouldAnimate = hasVisualFocus && shouldAnimateNext && hasLaidOut && !reducedMotion.value
  const transformCount = count + (hasContributors ? 1 : 0)
  const nextTransforms: LineTransform[] = Array.from({ length: transformCount }, () => ({
    top: 0,
    scale: 1,
    blur: 0,
    opacity: hasVisualFocus ? 1 : 0.4,
    delay: 0,
    duration: shouldAnimate ? DEFAULT_DURATION : 0,
    rotate: 0,
    extraTop: 0,
    left: 0,
    hidden: false
  }))

  if (count === 0) {
    // 参考项目无歌词时把 contributors 单独居中；这里没有 slotted DOM 高度可测，
    // 以歌词锚点位置作为 top，保证仍可见且不落入控制条固定底部。
    nextTransforms[0].top = containerHeight.value * (alignmentPercentage.value * 0.01)
    nextTransforms[0].opacity = 1
    transforms.value = nextTransforms
    hasLaidOut = true
    shouldAnimateNext = false
    return
  }

  nextTransforms[current].top =
    containerHeight.value * (alignmentPercentage.value * 0.01) - (heights[current] || 0) / 2
  nextTransforms[current].scale = 1
  nextTransforms[current].blur = 0
  nextTransforms[current].opacity = hasVisualFocus ? 1 : 0.4
  nextTransforms[current].delay = delayByOffset(0, current)
  const focusCenter = nextTransforms[current].top + (heights[current] || 0) / 2

  for (let i = current - 1; i >= 0; i--) {
    const offset = i - current
    const scale = useScale ? scaleByOffset(offset) : 1
    nextTransforms[i].scale = scale
    nextTransforms[i].blur = useBlur ? blurByOffset(offset) : 0
    nextTransforms[i].top = nextTransforms[i + 1].top - (heights[i] || 0) * scale - SPACE.value
    nextTransforms[i].opacity = useFade
      ? opacityByDistance(nextTransforms[i].top + (heights[i] || 0) / 2 - focusCenter)
      : 1
    nextTransforms[i].delay = delayByOffset(offset, current)
    nextTransforms[i].duration = shouldAnimate ? DEFAULT_DURATION : 0
    // rotate 在 scale/opacity 设好后调用：它会用基于距离的 opacity 覆盖 fade 的值
    setRotateTransform(
      nextTransforms[i],
      nextTransforms[current].top - nextTransforms[i].top,
      (heights[i] || 0) * scale
    )
  }

  for (let i = current + 1; i < count; i++) {
    const offset = i - current
    const scale = useScale ? scaleByOffset(offset) : 1
    const previous = nextTransforms[i - 1]
    nextTransforms[i].scale = scale
    nextTransforms[i].blur = useBlur ? blurByOffset(offset) : 0
    nextTransforms[i].top = previous.top + (heights[i - 1] || 0) * previous.scale + SPACE.value
    nextTransforms[i].opacity = useFade
      ? opacityByDistance(nextTransforms[i].top + (heights[i] || 0) / 2 - focusCenter)
      : 1
    nextTransforms[i].delay = delayByOffset(offset, current)
    nextTransforms[i].duration = shouldAnimate ? DEFAULT_DURATION : 0
    setRotateTransform(
      nextTransforms[i],
      nextTransforms[current].top - nextTransforms[i].top,
      (heights[i] || 0) * scale
    )
  }

  // contributors line —— 对齐参考项目 lyrics.js:372-386:把 contributors 当作
  // 歌词数组末项,跟随最后一行继续向下滚动,而不是固定在底部控制条附近。
  if (hasContributors) {
    const index = count
    const offset = count - current
    const scale = useScale ? scaleByOffset(offset) : 1
    const previous = nextTransforms[count - 1]
    nextTransforms[index].scale = scale
    nextTransforms[index].blur = useBlur ? blurByOffset(offset) : 0
    const contributorHeight = (heights[count - 1] || SPACE.value) * scale
    nextTransforms[index].top =
      previous.top + (heights[count - 1] || 0) * previous.scale + Math.min(SPACE.value * 1.5, 90)
    nextTransforms[index].opacity = useFade
      ? opacityByDistance(nextTransforms[index].top + contributorHeight / 2 - focusCenter)
      : 1
    nextTransforms[index].delay = delayByOffset(count - current, current)
    nextTransforms[index].duration = shouldAnimate ? DEFAULT_DURATION : 0
    setRotateTransform(
      nextTransforms[index],
      nextTransforms[current].top - nextTransforms[index].top,
      contributorHeight
    )
  }

  transforms.value = nextTransforms
  previousFocusedLine = current
  hasLaidOut = true
  shouldAnimateNext = false
}

/**
 * 当前行逐字 style 快照。
 *
 * 关键:per-word 的 transitionDelay/Duration 必须在「行变为当前行」的瞬间计算一次并固定,
 * 不能响应 currentTimeMs 每 ~250ms 重算 —— 否则每次 tick 重写 inline style 会重置正在播放的
 * transition,词永远停留在初始透明度、亮不起来,表现为「逐字动画没有」。
 *
 * 故用 watch(activeLineIndex + lines + currentTimeMs 的切行时机) 快照当前行所有 word 的 style,
 * 存入 karaokeSnapshot。模板只读快照,currentTime 后续变化不重写 → transition 只启动一次,
 * 各词按快照里的 delay 逐个亮起。seek 时 currentTimeMs 跳变触发重新快照,对齐新进度。
 */
const karaokeSnapshot = ref<{
  lineIndex: number
  /** word index → 固化的 style */
  styles: Record<number, Record<string, string | number>>
} | null>(null)
const forceRefreshLineIndex = ref<number | null>(null)
let forceRefreshTimer: number | null = null

function forceRefreshKaraoke(lineIndex: number): void {
  if (forceRefreshTimer !== null) window.clearTimeout(forceRefreshTimer)
  forceRefreshLineIndex.value = lineIndex
  // 对齐参考项目:当前行先强制回到 idle 状态一个极短 tick,再移除 force-refresh,
  // 浏览器才会从 opacity:.4/translateY(0) 过渡到当前行目标态。
  forceRefreshTimer = window.setTimeout(() => {
    if (forceRefreshLineIndex.value === lineIndex) forceRefreshLineIndex.value = null
    forceRefreshTimer = null
  }, 6)
}

/** CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1)。.rnp-karaoke-word 的 transform 过渡
 *  走该曲线,暂停定格必须按同曲线取进度插值,否则定格瞬间会从 ease 位置跳回线性位置
 *  (slide 模式词中段最大约 2.4px 的可见回跳)。二分反解 x(u)=t 再取 y(u)。 */
function cssEase(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const axis = (p1: number, p2: number, u: number): number =>
    3 * p1 * u * (1 - u) * (1 - u) + 3 * p2 * u * u * (1 - u) + u * u * u
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (axis(0.25, 0.25, mid) < t) lo = mid
    else hi = mid
  }
  const u = (lo + hi) / 2
  return axis(0.1, 1, u)
}

function rebuildKaraokeSnapshot(options?: { forceRefresh?: boolean }): void {
  if (!props.karaokeAnimation || props.currentTimeMs === undefined) {
    karaokeSnapshot.value = null
    return
  }
  const current = activeLineIndex.value
  const line = props.lines[current]
  if (!line?.words || line.words.length === 0) {
    karaokeSnapshot.value = null
    return
  }
  const now = props.currentTimeMs
  const previous = karaokeSnapshot.value

  // 长音发光的 CSS 动画时钟只在 force-refresh(下方 animation:none 规则)时归零重建。
  // forceRefresh:false 表示本次重建不重置时钟(暂停/恢复瞬间)——此时 --rnp-long-tone-*
  // 必须沿用上一快照原值:动画时钟已累计,重写 delay 只是 retiming,会让发光提前
  // 「已累计时长」触发甚至整段跳过。反之(切行/seek/重同步)时钟归零,须按 now 重算;
  // delay 允许为负 = 直接进入发光中段(冻结态则定格在对应帧)。
  const keepAnimationClock = options?.forceRefresh === false
  const longToneVars = (w: LyricWord, i: number): Record<string, string | number> => {
    const prev =
      keepAnimationClock && previous?.lineIndex === current ? previous.styles[i] : undefined
    if (prev?.['--rnp-long-tone-delay'] !== undefined) {
      return {
        '--rnp-long-tone-delay': prev['--rnp-long-tone-delay'],
        '--rnp-long-tone-duration': prev['--rnp-long-tone-duration']
      }
    }
    if (!w.trailing) return {}
    // 参考项目用 WAAPI animation.currentTime = currentTime - word.time 同步进度;
    // 这里用 CSS 负/正 delay 达成同样效果(前提是时钟刚被 force-refresh 归零)。
    return {
      '--rnp-long-tone-delay': `${w.timeMs - now}ms`,
      '--rnp-long-tone-duration': `${Math.max(w.durationMs + 500, 800)}ms`
    }
  }

  // 暂停:CSS transition 的 delay/duration 按墙钟倒计时,无法像 animation 那样被
  // play-state 冻结 —— 暂停后词会继续亮起。故暂停时改为「定格快照」:按暂停时刻的
  // 进度把每个词的 opacity/transform 写死为中间值(transition:none)。恢复播放/
  // 暂停中 seek 都会重进本函数,按新时刻重新定格或续跑。
  if (!isPlaying.value) {
    const styles: Record<number, Record<string, string | number>> = {}
    line.words.forEach((w, i) => {
      const progress =
        w.durationMs > 0
          ? Math.max(0, Math.min(1, (now - w.timeMs) / w.durationMs))
          : now >= w.timeMs
            ? 1
            : 0
      const eased = cssEase(progress)
      styles[i] = {
        transition: 'none',
        // opacity 过渡是 linear,线性插值;transform 过渡是 ease,须按 ease 取进度
        opacity: 0.4 + 0.6 * progress,
        transform:
          props.karaokeAnimation === 'slide'
            ? `translateX(${(-8 * (1 - eased)).toFixed(2)}px)`
            : `translateY(${(-2 * eased).toFixed(2)}px)`,
        ...longToneVars(w, i)
      }
    })
    karaokeSnapshot.value = { lineIndex: current, styles }
    // 暂停中的切行/seek/重同步同样要 force-refresh:长音动画经 animation:none 重建后
    // 被 .playback-paused 冻结在新 delay 对应的帧(负 delay = 定格在发光中段),
    // 与逐字亮度的定格保持一致。暂停瞬间(forceRefresh:false)则绝不能重置,
    // 否则冻结中的发光进度会丢失。
    if (!keepAnimationClock) forceRefreshKaraoke(current)
    return
  }

  const styles: Record<number, Record<string, string | number>> = {}
  line.words.forEach((w, i) => {
    // 已过的词 delay 钳 0(立即亮),未来词按 word.timeMs - now 正延迟逐个亮。
    // 进行中的词用剩余时长:暂停恢复/行中 seek 后从当前定格值平滑续跑,而非重播全程
    // (对齐参考项目 WAAPI 的 animation.currentTime 直接跳进度)。
    const delay = Math.max(0, w.timeMs - now)
    const duration = now > w.timeMs ? Math.max(0, w.timeMs + w.durationMs - now) : w.durationMs
    styles[i] = {
      transitionDuration: `${duration}ms`,
      transitionDelay: `${delay}ms`,
      ...longToneVars(w, i)
    }
  })
  karaokeSnapshot.value = { lineIndex: current, styles }
  // force-refresh 先把整行打回 idle 再启动过渡,切行/seek 需要;暂停恢复时跳过,
  // 否则已定格的词会闪回暗态再重新亮起。
  if (options?.forceRefresh !== false) forceRefreshKaraoke(current)
}

let transformQueued = false
function queueRecalcTransforms(animate: boolean): void {
  shouldAnimateNext = shouldAnimateNext || animate
  if (transformQueued) return
  transformQueued = true
  void nextTick(() => {
    transformQueued = false
    void recalcTransforms()
  })
}

watch(
  () => props.lines,
  () => {
    lineEls.value = []
    hasLaidOut = false
    previousFocusedLine = 0
    resetUserScroll()
    queueRecalcTransforms(false)
  }
)

watch(
  () => props.activeIndex,
  () => {
    // 用户滚动浏览期间不跟随播放(anchor 停在用户滚到的焦点行),2s 后恢复跟随
    if (isUserScrolling.value) return
    anchorLineIndex.value = activeLineIndex.value
    queueRecalcTransforms(true)
  },
  { flush: 'post', immediate: true }
)
// anchor 变化(用户滚轮改焦点行 / 播放切行同步):recalc 让新焦点行居中 + 周围行
// 按距焦点行距离应用 scale/blur/opacity,与播放切行同套层次动画。animate 交由调用
// 方(activeIndex=true / onWheel 设 shouldAnimateNext / lines=false)决定,此处 false。
watch(anchorLineIndex, () => queueRecalcTransforms(false), { flush: 'post' })

// 逐字快照:切行时重建(新行变为当前,基于此刻 currentTime 计算 per-word delay 并固化)。
// 这是逐字动画能亮起的关键 —— 见 karaokeSnapshot 注释。
// flush:'pre'(默认):快照必须在渲染前就绪,否则渲染先用 fallback delay:0ms 启动过渡,
// 快照更新后再改 delay 会重置 transition → 词闪暗。pre 让一次渲染到位。
watch(
  [activeLineIndex, () => props.lines, () => props.karaokeAnimation, () => props.enableLyricGlow],
  () => rebuildKaraokeSnapshot(),
  { immediate: true }
)
// seek 检测:currentTimeMs 跳变幅度 > 800ms(远超正常 250ms 增量)视为 seek,重建快照
// 对齐新播放进度重新计算各词 delay。正常播放的连续小幅增量不触发,避免重置正在播放的过渡。
let lastTimeForSeek = 0
watch(
  () => props.currentTimeMs,
  (t) => {
    if (t === undefined) return
    if (Math.abs(t - lastTimeForSeek) > 800) {
      rebuildKaraokeSnapshot()
    }
    lastTimeForSeek = t
  }
)
// 暂停/恢复:暂停时快照切为定格模式(CSS transition 无法被 play-state 冻结),
// 恢复时按恢复时刻重建过渡快照、从定格值续跑剩余时长;不 force-refresh,
// 避免整行闪回暗态再亮起。
watch(isPlaying, () => rebuildKaraokeSnapshot({ forceRefresh: false }))

// 字号 / 锚定位置 / stagger / rotate 曲率 / 渐隐 / 模糊 / 缩放 变化需重排（不动画，直接跳到新布局）。
// enableZoom/enableBlur/enableFade 必须在此监听：否则设置面板勾选后 computed 已变 true，
// 但无 watcher 触发 recalcTransforms，transforms 维持旧值，要等下一句 activeIndex 变化才出现，体感即「开启无效」。
// （对齐参考项目 lyrics.js 主 useEffect 依赖数组显式含 lyricFade/lyricZoom/lyricBlur）
watch(
  () =>
    [
      props.fontSize,
      props.alignmentPercentage,
      props.enableStagger,
      props.enableRotate,
      props.rotateCurvature,
      props.enableZoom,
      props.enableBlur,
      props.enableFade
    ] as const,
  () => queueRecalcTransforms(false)
)

watch(containerEl, (el, oldEl) => {
  if (oldEl) resizeObserver?.unobserve(oldEl)
  if (el) resizeObserver?.observe(el)
})

let resizeObserver: globalThis.ResizeObserver | null = null
if (typeof globalThis.ResizeObserver !== 'undefined') {
  resizeObserver = new globalThis.ResizeObserver(() => {
    hasLaidOut = false
    queueRecalcTransforms(false)
  })
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (forceRefreshTimer !== null) window.clearTimeout(forceRefreshTimer)
  if (scrollResumeTimer !== null) window.clearTimeout(scrollResumeTimer)
  if (typeof window !== 'undefined') {
    window.removeEventListener('wheel', onWheel, { capture: true })
  }
})

function lineTransform(index: number): LineTransform {
  return (
    transforms.value[index] ?? {
      top: 0,
      scale: 1,
      blur: 0,
      opacity: 0,
      delay: 0,
      duration: 0,
      rotate: 0,
      extraTop: 0,
      left: 0,
      hidden: false
    }
  )
}

function transformStyle(index: number): Record<string, string | number> {
  const t = lineTransform(index)
  // 变换顺序逐字对齐参考项目 lyrics.js 行组件：
  // translateX(left) → translateY(top+extraTop) → scale → rotate
  const translateX = t.left ? `translateX(${t.left}px) ` : ''
  const rotate = t.rotate ? ` rotate(${t.rotate}deg)` : ''
  const style: Record<string, string | number> = {
    transform: `${translateX}translateY(${t.top + t.extraTop}px) scale(${t.scale})${rotate}`,
    transitionDelay: `${t.delay}ms`,
    transitionDuration: `${t.duration}ms`,
    // 把模糊与阴影/辉光合并在同一 filter 声明，避免内联 filter 覆盖 :deep 类规则
    // （参考项目 blur 与 shadow 作用在不同元素故无冲突；我们同元素需合并）。
    // --rnp-drop-shadow 由沉浸层 rnp-shadow/rnp-text-glow 注入；独立使用时无值回退 none。
    //
    // 关键修复:blur 存在时,drop-shadow 的 fallback 必须是「空」而非 `none`。
    // `blur(Npx) none` 是非法 filter 列表(none 不能与 filter 函数并列),Chromium 会
    // 丢弃整条 filter 声明(computed 变为 none),导致开阴影关闭时远处行完全不模糊。
    // 空 fallback 让未开阴影时解析为纯 `blur(Npx)`;blur=0 时才用 `none` fallback,
    // 此时整条就是 `none`(合法)。已用 Electron getComputedStyle 实测验证。
    filter: t.blur ? `blur(${t.blur}px) var(--rnp-drop-shadow, )` : 'var(--rnp-drop-shadow, none)',
    opacity: t.opacity
  }
  // 距当前行过远：visibility 隐藏占位，不破坏布局（对齐参考 outOfRangeHidden）
  if (t.hidden) style.visibility = 'hidden'
  return style
}

function lineStyle(index: number): Record<string, string | number> {
  return transformStyle(index)
}

const contributorsStyle = computed(() => transformStyle(props.lines.length))

function offsetOf(index: number): number {
  // activeIndex=-1(未到首句)时仍以第一句为视觉焦点,让 offset=0 的当前行样式、
  // blur/zoom/fade 与逐字容器从开头就生效,而不是等第一句时间戳命中后才突然启用。
  return index - activeLineIndex.value
}

function romajiVisible(index: number): boolean {
  return Boolean(props.lines[index]?.romaji)
}

function transVisible(index: number): boolean {
  return Boolean(props.lines[index]?.translation)
}

function isLongToneWord(
  lineIndex: number,
  words: LyricWord[] | undefined,
  wordIndex: number
): boolean {
  if (!enableLyricGlow.value || !words) return false
  // 对齐参考项目 lyricGlow:只对 parseYrc 标记出的 trailing 词发光。
  // trailing 不一定是整行最后一个词,也可能是逗号/空格分段前的拖长音。
  // class 只给当前行,真正的发光启动时机由 karaokeSnapshot 注入的
  // --rnp-long-tone-delay 同步到 word.timeMs,避免整行刚成为当前行时句末长音提前发光。
  return lineIndex === activeLineIndex.value && Boolean(words[wordIndex]?.trailing)
}

/** 该行是否用逐字渲染(有 words 且距当前行不太远,对齐参考 outOfRangeKaraoke 阈值) */
function useKaraokeLine(index: number): boolean {
  const line = props.lines[index]
  if (!line?.words || line.words.length === 0) return false
  if (!props.karaokeAnimation || props.currentTimeMs === undefined) return false
  return Math.abs(offsetOf(index)) <= 10
}

/**
 * 逐字 style 取值:当前行从快照取(固化的 delay,不随 tick 重算);
 * 非当前行固定 200ms/0ms(无逐字效果,仅切回当前时才动画)。
 */
function karaokeWordStyle(
  word: LyricWord,
  wordIndex: number,
  lineIndex: number
): Record<string, string | number> {
  if (lineIndex !== activeLineIndex.value) {
    return { transitionDuration: '200ms', transitionDelay: '0ms' }
  }
  const snap = karaokeSnapshot.value
  if (snap && snap.lineIndex === lineIndex) {
    return (
      snap.styles[wordIndex] ?? {
        transitionDuration: `${word.durationMs}ms`,
        transitionDelay: '0ms'
      }
    )
  }
  return { transitionDuration: `${word.durationMs}ms`, transitionDelay: '0ms' }
}

function handleSeek(timeMs: number): void {
  emit('seek', timeMs)
}

defineExpose({
  /** 强制重建逐字快照(force-refresh,长音动画时钟归零重算)。供父组件在
   *  lyricOffset 等外部时钟偏移变化时调用 —— 偏移滑块 step=100ms,单次变化
   *  远低于内部 800ms 的 seek 检测阈值,不重同步则当前行 per-word delay
   *  仍按旧 offset 固化,逐字高亮与新时间轴失配。 */
  resyncKaraoke: (): void => rebuildKaraokeSnapshot(),
  /** 重测行高并重排。翻译/罗马音字号等只经 CSS 变量注入(非 prop),字号变化
   *  改变行高但不触发内部 prop watcher;ResizeObserver 观察的是 100% 尺寸的
   *  容器,行内字号变化也不会触发 —— 需父组件显式调用,否则行位置按旧高度
   *  推算,带翻译的行会重叠/出现空隙,直到下一次切行才自愈。 */
  remeasure: (): void => queueRecalcTransforms(false)
})
</script>

<template>
  <div
    ref="containerEl"
    class="rnp-lyrics"
    :class="{
      'pre-play': activeIndex < 0,
      'karaoke-float': karaokeAnimation === 'float',
      'karaoke-slide': karaokeAnimation === 'slide',
      'playback-paused': !isPlaying
    }"
  >
    <button
      v-for="(line, index) in lines"
      :key="`${line.timeMs}-${index}`"
      :ref="(el) => setLineRef(el as Element | null, index)"
      type="button"
      class="rnp-lyrics-line"
      :class="{ passed: index < activeLineIndex }"
      :offset="offsetOf(index)"
      :style="lineStyle(index)"
      :aria-label="`跳转到歌词：${line.text}`"
      @click="handleSeek(line.timeMs)"
    >
      <div
        v-if="useKaraokeLine(index)"
        class="rnp-lyrics-line-karaoke"
        :class="{ 'force-refresh': forceRefreshLineIndex === index }"
      >
        <span
          v-for="(w, wi) in line.words"
          :key="wi"
          class="rnp-karaoke-word"
          :class="{ 'rnp-karaoke-long-tone': isLongToneWord(index, line.words, wi) }"
          :style="karaokeWordStyle(w, wi, index)"
          >{{ w.word }}</span
        >
      </div>
      <div v-else class="rnp-lyrics-line-original">
        {{ line.text }}
      </div>
      <div v-if="romajiVisible(index)" class="rnp-lyrics-line-romaji">
        {{ line.romaji }}
      </div>
      <div v-if="transVisible(index)" class="rnp-lyrics-line-translated">
        {{ line.translation }}
      </div>
    </button>
    <slot name="contributors" :ctx="{ contributorsStyle }" />
  </div>
</template>

<style lang="scss" scoped>
.rnp-lyrics {
  /* 主色 / 动画曲线 / 阴影变量均直接继承父级（沉浸页 .immersive-root 注入），
     不在此重声明——自引用 var(--x, fallback) 会被 CSS 视为循环而永远取 fallback，
     截断父级注入值。独立使用时各使用点就地写 fallback。 */
  position: relative;
  width: calc(100% - 10px);
  height: 100%;
  flex: 1;
  overflow: hidden;
  box-sizing: border-box;
  margin-left: -25px;
  padding-right: 30px;
  padding-left: 30px;
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  font-size: var(--lyric-font-size, 32px);
  text-align: left;
  -webkit-mask-image: linear-gradient(
    0deg,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 1) 3%,
    rgba(0, 0, 0, 1) 97%,
    rgba(0, 0, 0, 0) 100%
  );
  mask-image: linear-gradient(
    0deg,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 1) 3%,
    rgba(0, 0, 0, 1) 97%,
    rgba(0, 0, 0, 0) 100%
  );

  &.playback-paused {
    .rnp-karaoke-word.rnp-karaoke-long-tone {
      animation-play-state: paused;
    }
  }
}

.rnp-lyrics-line {
  position: absolute;
  display: block;
  width: max-content;
  max-width: calc(100% - 60px);
  /* 父级 .immersive-content 设 pointer-events:none 后,歌词行需显式 auto 才能接收 @click 跳转 */
  pointer-events: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.2;
  text-align: left;
  cursor: pointer;
  transform-origin: left center;
  transition:
    transform 0.5s var(--lyric-timing-function, cubic-bezier(0.18, 0.77, 0.58, 0.99)),
    filter 0.5s ease,
    opacity 0.5s ease;
  will-change: transform, filter, opacity;

  &::before {
    content: '';
    position: absolute;
    inset: -15px;
    z-index: 0;
    display: block;
    border-radius: 10px;
    background-color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
    opacity: 0;
    pointer-events: none;
    transform: scale(1.05);
    transition:
      opacity 0.2s ease,
      inset 0.15s ease,
      transform 0.2s ease;
  }

  &:hover::before {
    opacity: 0.08;
    transform: scale(1);
  }

  &:focus-visible::before {
    opacity: 0.08;
    transform: scale(1);
  }

  &:active::before {
    inset: -10px -10px -8px -8px;
    opacity: 0.16;
    transform: scale(1);
  }

  > div {
    position: relative;
    z-index: 1;
    transition: opacity 0.5s ease;

    &:not(:last-child) {
      margin-bottom: 0.3em;
    }
  }

  &[offset='0'] {
    > div {
      opacity: 0.8;
    }

    > .rnp-lyrics-line-original {
      opacity: 1;
    }

    > .rnp-lyrics-line-karaoke {
      /* 逐字容器不继承上面的行级 opacity:.rnp-karaoke-word 自身的 0.4/1 已是完整明暗,
     再叠加会让当前行字最亮仅 0.8(纯文本是 1)、非当前行字仅 0.16(纯文本是 0.4),
     与纯文本模式不一致、且让逐字效果发暗。故容器恒为 1,明暗完全交给 per-word。 */
      opacity: 1;
    }

    .rnp-karaoke-word.rnp-karaoke-long-tone {
      /* 长音发光动画：ImmersivePlayer 通过 enableLyricGlow prop 控制是否打上
     rnp-karaoke-long-tone class。只绑定当前行 trailing 词；启动时间由
     --rnp-long-tone-delay 同步到 word.timeMs，避免还没唱到该字就提前发光。 */
      animation: rnp-long-tone-glow var(--rnp-long-tone-duration, 1500ms) linear
        var(--rnp-long-tone-delay, 0ms) both;
    }
  }

  &:not([offset='0']) {
    > div {
      opacity: 0.4;
    }

    > .rnp-lyrics-line-karaoke {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    transition: opacity 0.1s ease !important;
    filter: none !important;

    &[offset='0'] .rnp-karaoke-word.rnp-karaoke-long-tone {
      /* 取消发光动画但保留静态低透明度光晕:减少动态效果 ≠ 丢失长音视觉提示 */
      animation: none !important;
      text-shadow: 0 0 8px rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.35);
    }
  }
}

.rnp-lyrics-line-karaoke {
  /* 字重对齐参考项目 lyrics.scss:88-94 —— karaoke 与 original 必须读同一个
   --rnp-lyric-original-weight,否则当前行(逐字)与非当前行(行级文本)字重脱节,
    表现为「歌词一开始粗体、开始播放后当前行变细」。参考项目把两者放同一规则统一控制。 */
  font-weight: var(--rnp-lyric-original-weight, 700);
  /* 逐字卡拉OK动画(对齐参考 lyrics.scss rnp-karaoke-animation-float/slide):
   word 默认 opacity:0.4 + 静止;当前行[offset='0'] opacity:1 + 上浮/滑入。
   per-word 的 transitionDelay/Duration 由 inline style 注入(word.timeMs - currentTime),
    使各词按时间逐个亮起。float=上浮,slide=左滑入。 */
  display: inline;

  &.force-refresh {
    > .rnp-karaoke-word {
      /* force-refresh 同时重置长音发光动画的时钟:animation:none 一拍销毁动画,类移除后按
     新 --rnp-long-tone-delay 重建(负 delay 直接进入发光中段;暂停态则冻结在对应帧)。
     没有这一拍,同行内 seek/重同步只改 delay 变量属于 retiming —— 动画已累计的时钟
     不会归零,发光会提前「已累计时长」触发甚至整段跳过。 */
      animation: none !important;
    }
  }
}

.rnp-lyrics-line-original {
  /* --rnp-lyric-original-weight 由 ImmersivePlayer rootStyleVars 注入(lyricFontWeight 字重滑块)；
      独立使用(非沉浸层)时回退到 700（加粗），符合单行歌词默认加粗的直觉 */
  font-weight: var(--rnp-lyric-original-weight, 700);
}

.rnp-lyrics-line-romaji {
  font-size: var(--lyric-romaji-size-em, 0.6em);
  font-weight: 500;
  /* 保留词间空格(英文翻译/罗马音);避免父级 white-space 继承或窄容器把空格挤没 */
  white-space: pre-wrap;
}

.rnp-lyrics-line-translated {
  font-size: var(--lyric-translation-size-em, 1em);
  font-weight: 500;
  /* 同 romaji:英文翻译词间空格必须可见 */
  white-space: pre-wrap;
}

.pre-play {
  .rnp-lyrics-line {
    transition-duration: 0ms;
  }
}

.rnp-karaoke-word {
  display: inline-block;
  /* pre-wrap 保留 w.word 的首尾空格(英文单词间隙)。inline-block 内部自成 line box,
      默认 normal 会移除 line box 尾空白 → 英文单词尾空格被吞、单词揉一起。
      中文逐字 w.word 无空格,不受影响。 */
  white-space: pre-wrap;
  opacity: 0.4;
  transform: translateY(0);
  transition-property: opacity, transform;
  transition-timing-function: linear, ease;
  will-change: opacity, transform;
}

.karaoke-float {
  .rnp-lyrics-line[offset='0'] {
    .rnp-karaoke-word {
      /* float:当前行逐词上浮亮起 */
      opacity: 1;
      transform: translateY(-2px);
    }
  }

  .rnp-lyrics-line-karaoke.force-refresh {
    > .rnp-karaoke-word {
      opacity: 0.4 !important;
      transform: translateY(0) !important;
      transition: all 0s !important;
    }
  }
}

.karaoke-slide {
  .rnp-karaoke-word {
    /* slide:当前行逐词从左滑入亮起 */
    transform: translateX(-8px);
  }

  .rnp-lyrics-line[offset='0'] {
    .rnp-karaoke-word {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .rnp-lyrics-line-karaoke.force-refresh {
    > .rnp-karaoke-word {
      opacity: 0.4 !important;
      transform: translateX(-8px) !important;
      transition: all 0s !important;
    }
  }
}

@keyframes rnp-long-tone-glow {
  0% {
    text-shadow: 0 0 0 rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0);
  }

  60%,
  82% {
    text-shadow:
      0 0 8px rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.85),
      0 0 18px rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.45);
  }

  100% {
    text-shadow: 0 0 0 rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0);
  }
}
</style>

<!-- 原 package-0.1.21 的 rnp-lyrics 族样式。置于内联块之后：同特异性按源顺序后者胜，
     复刻原「#app 前缀(0,1,0 更高)压过内联 scoped」的层叠关系。内联块保持不动。 -->
<style scoped lang="scss" src="./rnp-lyrics.scss"></style>
