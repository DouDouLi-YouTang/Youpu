import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'

/**
 * 控制条「自动隐藏」(idle)共享状态 —— 模块级单例，与 use-immersive-player.ts 的
 * idle 同构：控制条拆成多个子组件后仍共用同一套计时器。
 *
 * - 外壳组件调用 useControlsIdle()：拿 hidden / idleClass，并一次性挂载窗口监听
 *   （随沉浸层 open 挂载 / 卸载）。
 * - 进度条 / 音量 / 音质 / 倍速等子组件在交互（拖动、选择）期间直接
 *   `import { resetIdle }` 调用，保持控制条显示。
 */

// idle 是模块级共享 ref(见 use-immersive-player.ts):此处写入,
// ImmersivePlayer 的关闭按钮读取以跟随控制条一起隐藏/唤出。
const { idle, open } = useImmersivePlayer()

// ── 自动隐藏：对齐参考项目 main.js:1014-1049 IdleThreshold=1.5s ──
// 三件套 idleTimer/debounceTime/debounceTimer:防 mousemove 与 mouseout(离窗)交错闪烁。
const IDLE_THRESHOLD = 1500
// 离窗后强制 idle 的防抖下限(对齐参考 setIdle 的 325ms):距上次唤醒不足 325ms 则延后,
// 防"移动唤出→立刻移出窗口"造成的闪现。
const MOUSEOUT_DEBOUNCE_MS = 325
let idleTimer: number | null = null
let debounceTimer: number | null = null
let debounceTime = 0

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}
function clearDebounceTimer(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

/**
 * 「用户正在操作」的手动持有计数 —— 持有期间控制条**绝不**自动隐藏。
 *
 * 与 `resetIdle()` 的区别：`resetIdle` 只是把 1.5s 计时推后，而拖动滑块时指针常常
 * 一动不动（没有任何 mousemove），也没法「再推后一次」—— 计时一到就把控制条连同
 * 用户正在拖的那个弹层一起藏了。持有表达的是「直到我释放为止都不许 idle」。
 *
 * 可重入：多个来源（弹层展开、指针按住…）各持有一份，用返回的释放函数成对释放。
 */
let holdCount = 0

/**
 * 开始持有（返回释放函数，重复调用返回的函数也只释放一次）。
 *
 * 场景见 `controls/use-idle-hold.ts`；内核弹层（音量/倍速/音质）、播放队列面板、
 * 进度条与控制条上的指针按压都用它。
 */
export function holdIdle(): () => void {
  holdCount += 1
  // 已经隐没的话立刻唤出：用户刚点到控制条上的按钮，控制条却还在屏幕外
  if (idle.value) idle.value = false
  // 持有期间不留计时器，免得它到点又把控制条藏了（释放时会重新起计时）
  clearIdleTimer()
  return () => {
    if (holdCount === 0) return
    holdCount -= 1
    if (holdCount === 0) resetIdle()
  }
}

// 对齐参考 main.js:1028-1035:仅从 idle→active 的边沿记录 debounceTime(供离窗防抖用),
// 无论如何都重启 1.5s 计时;计时到点 idle=true 并清掉离窗 debounce(防重复)。
export function resetIdle(): void {
  if (holdCount > 0) {
    // 持有期间：只保证「现在是显示态」，不排计时器（释放时会重新起计时）
    if (idle.value) idle.value = false
    return
  }
  if (idle.value) {
    idle.value = false
    debounceTime = Date.now()
  }
  clearDebounceTimer()
  clearIdleTimer()
  // 演示模式:即使「不自动隐藏底栏」也启动 idle(鼠标静止时隐藏控制条,移动唤出),
  // 否则用户进入演示模式后控制条常显/常隐都无法退出。对齐参考 experimental.scss
  // presentation-mode 不隐藏自身控制条、仍走 idle 的语义。
  const settings = useImmersiveSettingsStore()
  if (settings.alwaysShowBottomBar && !settings.presentationMode) return
  idleTimer = window.setTimeout(() => {
    if (holdCount > 0) return
    idle.value = true
    clearDebounceTimer()
  }, IDLE_THRESHOLD)
}

// 对齐参考 main.js:1036-1049:鼠标离开窗口(mouseout relatedTarget===null)后,
// 至少距上次唤醒 325ms 才强制 idle;距上次唤醒>325ms 则立即(0ms)。
function setIdle(): void {
  // 被持有（拖动中 / 弹层展开）时，鼠标甩出窗口也不该把控制条收走
  if (holdCount > 0) return
  clearDebounceTimer()
  const delay = Math.max(debounceTime + MOUSEOUT_DEBOUNCE_MS - Date.now(), 0)
  debounceTimer = window.setTimeout(() => {
    if (holdCount > 0) return
    clearIdleTimer()
    idle.value = true
  }, delay)
}

/**
 * 控制条高度（px）。
 *
 * ⚠️ 与 CSS 里的 `--bottombar-height`（immersive-shell.scss）**必须同值** ——
 * 那边是控制条自己的 `height` 与所有贴底元素的基准，这边是「鼠标是否停在控制条区域」
 * （悬停唤出）的判据。两边不同值就会出现「鼠标已抬到控制条上却不唤出」或
 * 「控制条上方一大片空白也算悬停底栏」。副字幕底距也以它为基准（见
 * `skins/shared/use-subtitle-bottom.ts`）。
 */
export const BOTTOMBAR_HEIGHT = 76

// 悬停底栏唤出:鼠标在控制条区域(底部 bottombar-height)时置 bottombarHover,
// 对齐参考 body.bottombar-hover(main.js:244-251 mouseenter #main-player)。
// 用坐标判断因控制条 pointer-events:none(让进度条可点),无法靠 mouseenter。
const bottombarHover = ref(false)

function onWindowMouseMove(e: globalThis.MouseEvent): void {
  resetIdle()
  bottombarHover.value = e.clientY > window.innerHeight - BOTTOMBAR_HEIGHT
}

function onWindowMouseOut(e: globalThis.MouseEvent): void {
  // relatedTarget===null:鼠标离开整个窗口(Electron renderer 同样触发)
  if (e.relatedTarget === null) {
    bottombarHover.value = false
    setIdle()
  }
}

// 滚动唤出:用户主动滚动(歌词/页面)重置 idle。对齐参考 mq-playing-scroll 守卫
// (参考靠宿主 class,本项目无宿主,故自接 wheel)。
function onWindowWheel(): void {
  resetIdle()
}

/**
 * 外壳组件专用：挂载/卸载窗口监听并返回控制条显隐 class。
 *
 * 显隐策略(对齐参考项目 main.js + material-you-compatibility.scss + experimental.scss):
 * - presentationMode:控制条走 idle(鼠标静止隐藏,移动唤出),保证用户能退出演示模式;
 *   参考项目 presentation-mode 只隐藏网易云原生 UI,不隐藏自身控制条。
 * - bottombarHover:idle 时悬停底栏区域唤出(对齐参考 body.bottombar-hover)。
 * - 默认 idle:整条 translateY 下滑出视口(对齐参考 material-you-compatibility.scss:57,
 *   非 opacity 淡出),transition transform .3s ease。
 */
/**
 * 控制条是否处于「隐没」状态 —— **判据的唯一出处**。
 *
 * 单独抽出来是因为副字幕的底距也要跟它走（上游 `usePlayerSubtitleBottomPx`）：
 * 两边各写一份判据时，「控制条已经隐没、字幕还以为它在场」这类错位不会有任何报错，
 * 只会看到字幕一直悬在控制条原来的位置上。
 *
 * ⚠️ 它只**读**状态，不注册任何监听 —— 挂载窗口监听的仍然是 `useControlsIdle()`，
 * 而那个函数必须只被外壳调用一次。
 */
export function useControlsHidden() {
  const settings = useImmersiveSettingsStore()
  return computed(() => {
    if (settings.presentationMode) return idle.value
    return idle.value && !settings.alwaysShowBottomBar && !bottombarHover.value
  })
}

export function useControlsIdle() {
  const settings = useImmersiveSettingsStore()

  // 沉浸层打开时挂载 idle 监听，关闭即卸载（ImmersiveControls 随 v-if open 渲染）
  watch(
    open,
    (isOpen) => {
      if (isOpen) {
        window.addEventListener('mousemove', onWindowMouseMove)
        document.addEventListener('mouseout', onWindowMouseOut)
        window.addEventListener('wheel', onWindowWheel, { passive: true })
        resetIdle()
      } else {
        window.removeEventListener('mousemove', onWindowMouseMove)
        document.removeEventListener('mouseout', onWindowMouseOut)
        window.removeEventListener('wheel', onWindowWheel)
        clearIdleTimer()
        clearDebounceTimer()
        idle.value = false
        bottombarHover.value = false
        // 持有计数是模块级、跨 open/close 存活的：沉浸层关掉时若有谁没释放干净
        // （组件被直接卸载、pointerup 丢了），下次进来控制条就再也不隐藏了 ——
        // 这里连状态一起清账。
        holdCount = 0
      }
    },
    { immediate: true }
  )
  // 演示模式切换时重置 idle:进入即开始隐藏计时,退出即恢复常显/隐藏
  watch(
    () => settings.presentationMode,
    () => resetIdle()
  )
  onBeforeUnmount(() => {
    window.removeEventListener('mousemove', onWindowMouseMove)
    document.removeEventListener('mouseout', onWindowMouseOut)
    window.removeEventListener('wheel', onWindowWheel)
    clearIdleTimer()
    clearDebounceTimer()
  })

  const hidden = useControlsHidden()
  const idleClass = computed(() => {
    if (!hidden.value) return ''
    // presentationMode 走纯淡出;默认走下滑
    if (settings.presentationMode) return 'is-idle-fade'
    return 'is-idle'
  })

  return { hidden, idleClass }
}
