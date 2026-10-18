/**
 * **逐歌主题** —— 当前播放的这首歌的四个颜色，从封面推出来。
 *
 * ## 解决的三个问题
 *
 * 1. **文字颜色不跟随主题色**：`primaryColor` / `secondaryColor` 原来取的是写死的
 *    灰白/近黑字面量，现在与底色、强调色一起从封面色相算出来（见 `generate.ts`），
 *    四个颜色是配套的。
 * 2. **每首歌主题色都一样**：原来只有强调色读封面。现在四个颜色都来自
 *    `coverColors`，不同封面 → 不同色相；连**没有封面**的歌也用歌曲 id 当种子
 *    生成随机色相，不会共享同一个兜底主题。
 * 3. **逐词配色（关键词着色）**：额外产出 `wordColors`，交给
 *    `shared/word-coloring.resolveWordColor` 逐词上色（见 `keyword-colors.ts`）。
 *
 * ## 为什么是一个 composable 而不是塞进 `use-folia-palette`
 *
 * `use-folia-palette` 是「当前面板该用什么颜色」的**读取口**，两个皮肤都从那里取值；
 * 而本模块是「这首歌该有什么颜色」的**生产端**。分开之后：
 * `useFoliaPalette` 仍然只有一个职责（把主题映射成皮肤要的四个字段），
 * 将来若接 AI 主题，也只是换掉本模块的输出源，皮肤一行不用改。
 *
 * ## 明暗档
 *
 * 两档共用同一个颜色骨架（同一张封面、同一个种子），只在明度与饱和度上分道扬镳 ——
 * 切明暗是「同一首歌换成白天/夜晚」，不是换成另一首歌。
 *
 * ## 异步与竞态
 *
 * 取色是异步的（要等图加载）。快速连续切歌时，**旧封面在途的结果必须丢弃**，
 * 否则会把上一首的颜色写到当前这首歌上。这里沿用与 `use-color-extraction` 相同的
 * **自增令牌**做法（每次请求拿一个号，回来时对不上就丢弃），
 * 而不是判断 `coverUrl` 是否相等 —— 同一张封面重开也会发新请求，令牌更准确。
 */

import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import type { FoliaColorScheme } from '@/features/immersive/immersive-settings.model'
import type { WordColorEntry } from '../word-coloring'
import { extractVibrantCoverColors } from './cover-colors'
import { generateFixedFoliaTheme, generateSongThemeColors, type SongThemeColors } from './generate'
import { buildKeywordColors, pickKeywords, type KeywordSourceLine } from './keyword-colors'
import { DARK_THEME_COLORS, LIGHT_THEME_COLORS } from './neutral-theme'
import { createSeededRandom } from './seed'

/**
 * 取色结果缓存上限。
 *
 * 缓存的是「封面色盘 + 生成好的四色」（不是图片本身），一条记录只有几个字符串。
 * 64 条足够覆盖「来回切歌」的常见场景（一张专辑也就十几首），
 * 又不会在几百首的长时间漫游后一直涨。
 */
const THEME_CACHE_LIMIT = 64

interface CachedTheme {
  light: SongThemeColors
  dark: SongThemeColors
}

/**
 * 模块级缓存：键是**封面 URL + 歌曲 id**。
 *
 * 为什么键里要带歌曲 id：同一张封面可以被多首歌共用（同一张专辑、
 * 或者取色失败时多首歌共用一个兜底图）。封面色盘本身只依赖 URL；
 * 歌曲 id 同时参与生成随机源，保证取色失败时每首歌也能得到稳定而不同的主题。
 */
const themeCache = new Map<string, CachedTheme>()

function readCache(key: string): CachedTheme | undefined {
  const hit = themeCache.get(key)
  if (!hit) return undefined
  // 命中时重新插入一遍：Map 的插入序因此近似 LRU（与 shared/bounded-cache 同口径）
  themeCache.delete(key)
  themeCache.set(key, hit)
  return hit
}

function writeCache(key: string, value: CachedTheme): void {
  if (!themeCache.has(key) && themeCache.size >= THEME_CACHE_LIMIT) {
    const oldest = themeCache.keys().next()
    if (!oldest.done) themeCache.delete(oldest.value)
  }
  themeCache.set(key, value)
}

/** 仅测试用：清空缓存（避免用例之间互相影响） */
export function clearSongThemeCacheForTests(): void {
  themeCache.clear()
}

export interface UseSongThemeOptions {
  /** 当前封面 URL；为空时走「无封面」路径（仍会生成一套随机主题） */
  coverUrl: Ref<string | null | undefined> | ComputedRef<string | null | undefined>
  /** 当前歌曲 id：既是**主题种子**（决定随机色相），也是缓存键的一部分 */
  songId: Ref<number | null | undefined> | ComputedRef<number | null | undefined>
  /**
   * 当前歌词的行（用于挑关键词）；为空时不产出 `wordColors`。
   *
   * 有逐词数据时**一定要带上**（`KeywordSourceLine.words`）：那些词边界来自歌词层，
   * 比在渲染层重新猜准确得多（见 `keyword-colors.ts` 的说明）。
   */
  lyricLines:
    | Ref<readonly (KeywordSourceLine | string)[]>
    | ComputedRef<readonly (KeywordSourceLine | string)[]>
}

export interface UseSongThemeResult {
  /** 当前明暗档下生效的四个颜色 */
  colors: ComputedRef<SongThemeColors>
  /** 逐词配色（可能为空数组：没有歌词 / 没有关键词） */
  wordColors: ComputedRef<WordColorEntry[]>
  /** 取色是否已经出过结果（首帧为 false，此时用的是中性兜底） */
  ready: Ref<boolean>
  /** 当前配色方案是否解析为白天档（`'auto'` 已按系统偏好折算） */
  isDaylight: ComputedRef<boolean>
}

/**
 * 按用户选择的配色方案取“当前两档”。
 *
 * `'song'` 仍然走完整的封面取色；固定方案不必等异步封面解码，能同步给出
 * 一套稳定颜色。关键词（个别词）的颜色仍从当前生效的强调色派生，
 * 所以即使用户固定了整页配色，“个别词跟歌走”的能力也不会完全消失。
 */
function resolveModeColors(
  colorMode: FoliaColorScheme,
  generated: { light: SongThemeColors; dark: SongThemeColors } | null,
  fallbackIsLight: boolean
): SongThemeColors {
  if (colorMode !== 'song') {
    const fixed = generateFixedFoliaTheme(colorMode)
    return fallbackIsLight ? fixed.light : fixed.dark
  }
  if (generated) return fallbackIsLight ? generated.light : generated.dark
  return fallbackIsLight ? LIGHT_THEME_COLORS : DARK_THEME_COLORS
}

/**
 * 取「当前这首歌」的主题四色 + 逐词配色。
 *
 * ## 首帧为什么不闪
 *
 * 取色是异步的（图要先加载），所以首帧必然拿不到颜色。此时用
 * `neutral-theme.ts` 的中性兜底（与上游 `baseThemes` 同值），
 * 等结果回来再替换 —— 而不是首帧给一个透明/白底再突然变深，
 * 后者在深色档下是一次明显的白闪。
 *
 * ## 明暗档读的是 Folia 共享设置
 *
 * 与 `use-folia-palette` 同一口径：`settings.folia.colorScheme`
 * （`'auto'` 按系统偏好解析），三套 Folia 主题共享。
 */
export function useSongTheme({
  coverUrl,
  songId,
  lyricLines
}: UseSongThemeOptions): UseSongThemeResult {
  const settings = useImmersiveSettingsStore()

  const ready = ref(false)
  /** 当前生效的一套（明暗两档都在里面，见下） */
  const applied = ref<CachedTheme | null>(null)

  let requestToken = 0

  /**
   * 系统明暗偏好必须是响应式的。
   *
   * 如果在 `colors` 的 computed 里直接读 `matchMedia().matches`，系统切换时
   * Vue 不知道这个值变了，`colors` 与依赖它的 `wordColors` 都会停在旧档。
   * 把 media query 的 change 事件写进 ref，再让 computed 读取 ref，
   * 三套 Folia 主题的颜色才会在系统主题切换后同步更新。
   */
  const systemDark = ref(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  )
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent): void => {
      systemDark.value = event.matches
    }
    query.addEventListener('change', onChange)
    onBeforeUnmount(() => query.removeEventListener('change', onChange))
  }

  /**
   * 关键词用**整首歌**的歌词挑，不是当前行。
   *
   * 若用当前行，唱到哪一句关键词就跟着换一批 —— 颜色会随播放进度漂移，
   * 而关键词着色在语义上属于「这首歌」，不是「这一句」。
   */
  function buildWordColors(accentColor: string, backgroundColor: string): WordColorEntry[] {
    const lines = lyricLines.value
    if (lines.length === 0) return []
    return buildKeywordColors(pickKeywords(lines), accentColor, backgroundColor, {
      // 单色方案的关键词也必须保持低饱和，不能被默认的 0.45 饱和度下限重新染成彩色。
      minSaturation: settings.folia.colorMode === 'mono' ? 0 : undefined
    })
  }

  /** 跑一次完整推导（含缓存命中） */
  function resolveTheme(key: string, colors: readonly string[]): CachedTheme {
    const cached = readCache(key)
    if (cached) return cached

    const id = songId.value
    const random = createSeededRandom(id !== null && id !== undefined ? id : key)
    const generated = generateSongThemeColors({ coverColors: colors, random })

    const built: CachedTheme = {
      light: generated.light,
      dark: generated.dark
    }

    writeCache(key, built)
    return built
  }

  async function load(): Promise<void> {
    const token = ++requestToken
    const url = coverUrl.value
    const id = songId.value
    const key = `${url ?? 'no-cover'}::${id ?? 'no-song'}`

    // 缓存命中不必等异步：先同步把结果摆上去，避免切回听过的歌时又闪一下兜底色
    const cached = readCache(key)
    if (cached) {
      applied.value = cached
      ready.value = true
      return
    }

    ready.value = false
    const colors = url ? await extractVibrantCoverColors(url, 5) : []
    // 在途期间已经切歌 / 换封面：这次结果作废（见文件头的令牌说明）
    if (token !== requestToken) return

    applied.value = resolveTheme(key, colors)
    ready.value = true
  }

  // 封面或歌曲变了就重新取色（`immediate` 让首帧就开始跑）
  watch([coverUrl, songId], () => void load(), { immediate: true })

  const isDaylight = computed<boolean>(
    () =>
      settings.folia.colorScheme === 'light' ||
      (settings.folia.colorScheme === 'auto' && !systemDark.value)
  )

  const colors = computed<SongThemeColors>(() =>
    resolveModeColors(settings.folia.colorMode, applied.value, isDaylight.value)
  )

  /**
   * 逐词配色从**当前生效的四色**派生，而不是缓存里固定取暗色档。
   *
   * 这样固定配色方案、明暗档变化与歌词晚到时都会使用同一套口径：
   * 关键词跟随当前方案，且对比度按当前底色重新求解。
   */
  const wordColors = computed<WordColorEntry[]>(() => {
    if (!settings.folia.wordColoring) return []
    const active = colors.value
    return buildWordColors(active.accentColor, active.backgroundColor)
  })

  return { colors, wordColors, ready, isDaylight }
}
