<script setup lang="ts">
import { computed, ref } from 'vue'

import GeometricBackground from '@/features/immersive/backgrounds/GeometricBackground.vue'
import {
  buildFoliaFontStack,
  createFoliaFontSettingsDefaults
} from '@/features/immersive/folia-font-settings'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { resolveSubtitleSlots, resolveSubtitleTracks } from '../shared/subtitle-tracks'
import FoliaSkinBackground from '../shared/FoliaSkinBackground.vue'
import { useFoliaPalette } from '../shared/use-folia-palette'
import type { SkinContext } from '../types'
import TiltLine from './TiltLine.vue'
import {
  CHAR_FADE_DURATION_MS,
  FONT_WEIGHT_PLAIN,
  FONT_WEIGHT_TILT,
  TILT_FONT_SCALE,
  resolveLineEndMs,
  type TiltLineSource
} from './tilt-adapter'
import { TILT_LYRIC_FONT_FAMILIES, useTiltFontReady } from './use-tilt-font'
import { useTiltLayout } from './use-tilt-layout'
import { useTiltTiming } from './use-tilt-timing'

/**
 * 「倾诉」(tilt) 皮肤 —— Folia 式**全屏歌词**面板（与「经典」皮肤并列的款式）。
 *
 * 设置使用 Folia 共享页签（外观 / 歌词 / 背景 / 关于）；经典那套面板外观
 * （显示模式 / 封面 / 自定义字体 / 字号滑杆）仍不套用。
 *
 * 原生背景仍是「几何」：`FoliaSkinBackground` 在 `native` 档直接渲染它，
 * 只有用户主动选择其他背景时才替换。
 *
 * 布局本身就是本皮肤的主体：Folia 的预览图里歌词是**一条占满窗口的居中舞台**
 * （`VisualizerTilt` 的 `w-full h-[70vh] flex items-center justify-center`），
 * 没有封面列、没有侧边留白。歌词区是自持的 `.tilt-lyric`，**不复用**经典皮肤的
 * `.immersive-lyric` —— 那个类名会被外壳的 `.display-mode-lyric-only` 规则加上给
 * 滚动列表用的内边距。
 *
 * 歌词块**不复用** LyricLines：布局逻辑完全不同（一行切成 1–4 段 + 倾斜段 + 逐字脉冲），
 * 因此对齐的是它的行为约定：点击行 seek、暂停定格、切行/seek/改偏移重建逐字时间轴。
 */
const props = defineProps<{ ctx: SkinContext }>()

// 只读 lyricOffset（沉浸页通用项）。面板外观那套（字号 / 译文倍率 / 字体 / 封面 / 背景）
// 一律不读 —— 见文件头。
const settings = useImmersiveSettingsStore()
const lyric = useLyricStore()
const player = usePlayerStore()

const { palette, isDaylight } = useFoliaPalette({
  coverUrl: computed(() => props.ctx.coverUrl()),
  songId: computed(() => player.currentItem?.song.id ?? null),
  lyricLines: computed(() => lyric.lines.map((line) => ({ text: line.text })))
})

/** 当前行下标（-1 = 尚未到首行）；文本/逐字时间戳从 lyric store 取（契约只给下标） */
const currentIndex = computed(() => props.ctx.currentLineIndex())
const currentLine = computed(() =>
  currentIndex.value >= 0 ? (lyric.lines[currentIndex.value] ?? null) : null
)

/** 行输入：结束时间按笔记 §8.1.1 推算（下一行 / 播放时长 / 固定 5 秒） */
const source = computed<TiltLineSource | null>(() => {
  const line = currentLine.value
  if (!line) return null
  const next = lyric.lines[currentIndex.value + 1] ?? null
  return {
    text: line.text,
    timeMs: line.timeMs,
    endMs: resolveLineEndMs(line, next, player.durationMs),
    words: line.words
  }
})

/** 行身份：切歌或切行都算新的一行（重建逐字时间轴） */
const lineKey = computed(() => `${lyric.songId ?? 'none'}:${currentIndex.value}`)

/**
 * 底部副字幕行（Folia 的副字幕层）。
 *
 * 解析走**共享层** `skins/shared/subtitle-tracks.ts`（与「流光」「浮名」同一份口径）：
 * `'both'` 档罗马音在前、译文在后；缺哪档就少一行、绝不出现空占位；两档填同一串时
 * 只显示一次。共享层还带一道**可读性门槛**（至少含一个字母或数字），于是 `//`、`●●●`
 * 这类占位行不会漏到底栏。
 *
 * 档位取自 Folia 共享设置 `settings.folia.subtitleContentMode`。
 *
 * ⚠️ 行对象的角色名 `role` 是 `'romanization' | 'translation'`，而倾诉的 SCSS 用的是
 * 短名 `is-romaji` / `is-translation`（历史命名，样式文件里已存在）。这里在模板上做映射，
 * 不动样式 —— 改 class 名会让 `tilt.scss` 与模板同时要改，收益只是"名字更整齐"。
 *
 * 两行各自的字号档写在 tilt.scss 里（内置固定值，不受设置面板影响）。
 */
const subtitleRows = computed(() =>
  resolveSubtitleTracks(currentLine.value, settings.folia.subtitleContentMode)
)

/**
 * 副字幕的**定长槽位**（倾诉专有，见 `shared/subtitle-tracks.resolveSubtitleSlots`）。
 *
 * 倾诉的副字幕在**正常流**里，舞台是"扣掉副字幕后剩下的高度"（tilt.scss /
 * docs/tilt-porting-notes.md §3.1）。若按"缺哪档就少一行"渲染，换行到一句没有罗马音的
 * 歌词时这一格就没了 —— 舞台随之变高，居中的歌词当场跳一下（实测 11px / 26px）。
 * 所以按**档位**固定槽位数量，缺文本的槽只占位（`visibility: hidden`，不渲染任何
 * 可见内容，见 tilt.scss 的 `.is-placeholder`）—— 舞台高度于是与本行有没有副字幕无关。
 *
 * 两档都填同一串时共享层会去重成一条（`resolveSubtitleTracks` 的规则 4），
 * 槽位这一层**照旧给两格**：这是刻意的 —— 去重是按行内容变的，跟着它变槽位数
 * 等于把上面那个抖动又请回来。
 */
const subtitleSlots = computed(() =>
  resolveSubtitleSlots(subtitleRows.value, settings.folia.subtitleContentMode)
)

/**
 * 槽位内容身份：变化即重播淡入（`v-if` + `:key` 让 Vue 换掉整块节点）。
 *
 * 用**文本**而不是行下标：拿不到下标（那是各皮肤自己的行源），而文本变了就说明换行 /
 * 换档了。空白槽不进 key —— 否则"这一句没有副字幕"的两行之间也会重播一次动画。
 */
const subtitleKey = computed(() =>
  subtitleRows.value.map((row) => `${row.role}:${row.text}`).join('|')
)

const panelRef = ref<HTMLElement | null>(null)
/** 舞台元素：量它的高度当「歌词可占多高」，纵向放不下时据此整体缩小字号 */
const stageRef = ref<HTMLElement | null>(null)
// 内置字体的就绪信号（站酷快乐体 + 圆体假名兜底，见 use-tilt-font.ts）。
// 字体文件是异步到位的，就绪前 canvas 只能拿兜底字量宽；把它接进下面的 fontKey，
// 字体一到位就重测一次，避免「按兜底字宽缩放、真字体来了却不重算」。
const { fontState } = useTiltFontReady()
/**
 * 当前主题（倾诉）的字体配置。
 *
 * `fonts` 由持久化迁移保证存在；缺档位时回退默认值，避免旧存档 / 热重载期间
 * 模板拿到 undefined。自定义字体链只作用于 `TiltLine`，不挂到 `.tilt-lyric` ——
 * 空态歌名、副字幕仍是主题内置字体与内置字重。
 */
const fontSettings = computed(() => settings.folia.fonts?.tilt ?? createFoliaFontSettingsDefaults())
const tiltFontFamily = computed(() =>
  buildFoliaFontStack(
    fontSettings.value.custom ? fontSettings.value.families : [],
    TILT_LYRIC_FONT_FAMILIES
  )
)
const tiltPlainWeight = computed(() => fontSettings.value.weight ?? FONT_WEIGHT_PLAIN)
const tiltTiltWeight = computed(() => fontSettings.value.weight ?? FONT_WEIGHT_TILT)
/**
 * 字体相关输入的统一失效键：字体就绪、字体链、两个实际字重任一变化都要重测。
 * 与 `use-tilt-layout` 的 `clearCache + computed` 配合，保证[真字体/自定义字体]量宽一致。
 */
const tiltFontKey = computed(
  () =>
    `${fontState.value}|${tiltFontFamily.value}|${tiltPlainWeight.value}|${tiltTiltWeight.value}`
)
const { layout } = useTiltLayout({
  source,
  // 字号倍率固定 1：倾诉的字号不是用户的「歌词字体大小」，是它自己的 clamp 档位（见文件头）
  fontScale: TILT_FONT_SCALE,
  fontKey: tiltFontKey,
  fontFamily: tiltFontFamily,
  plainWeight: tiltPlainWeight,
  tiltWeight: tiltTiltWeight,
  panel: panelRef,
  stage: stageRef
})

// lyricOffset 变化会让 ctx.currentTime() 整体平移（滑块 step=100ms，低于 seek 判定阈值），
// 故把它作为显式的重同步键 —— 与经典皮肤调 LyricLines.resyncKaraoke() 是同一件事。
const { model, epoch, resync } = useTiltTiming({
  time: () => props.ctx.currentTime(),
  lineKey: () => lineKey.value,
  resyncKey: () => settings.lyricOffset,
  source,
  segments: () => layout.value?.segments ?? null,
  fontPx: () => layout.value?.fontPx ?? 0
})

/** 暂停时定格：交给 CSS 的 animation-play-state: paused（见 tilt-line.scss） */
const paused = computed(() => !props.ctx.isPlaying())

/**
 * 歌词区 CSS 变量：主题色必须挂在 `.tilt-lyric` 上。
 *
 * TiltLine 虽然位于 stage-inner 内，但空态和 `.tilt-subtitles` 是它的兄弟层；
 * 把色值放在 inner 会让它们读不到，因此色值上移到整个歌词区。
 */
const lyricStyle = computed<Record<string, string>>(() => ({
  '--tilt-primary-color': palette.value.primary,
  '--tilt-accent-color': palette.value.accent,
  '--tilt-secondary-color': palette.value.secondary
}))

/** 舞台 CSS 变量：字号由布局算好（clamp × 溢出缩放），淡入时长取自适配层常量 */
const stageStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    '--tilt-fade-dur': `${CHAR_FADE_DURATION_MS}ms`
  }
  const fontPx = layout.value?.fontPx
  // 测量完成前不写字号，让 SCSS 里的 clamp 兜底值顶着，避免先用 0px 排一次
  if (fontPx && fontPx > 0) style['--tilt-font-size'] = `${fontPx}px`
  return style
})

/** 空态：没有歌词行可排时显示什么（null = 有行可排，交给 TiltLine） */
type TiltEmptyState =
  /** 歌名 + 歌手（歌手可能为空串 → 只显示歌名） */
  | { kind: 'song'; title: string; artist: string }
  /** 一句中文提示（纯音乐 / 无歌词 / 未选歌） */
  | { kind: 'text'; text: string }

/**
 * 有歌但歌词还没出来时显示「歌名 + 歌手」，而不是「等待音乐」—— 歌明明在放却写「等待」，
 * 看上去像没在播（2026-10-10 用户反馈）。覆盖两种情形：歌词请求中、还没唱到第一句（前奏）。
 *
 * 其余保持原中文提示：纯音乐 / 暂无歌词是**终态**（这两句本身在解释「为什么没有歌词」，
 * 换成歌名反而丢了这层信息），未选歌时也没有歌名可显示。
 *
 * ⚠️ 顺序不能动：`lyric.loading` 期间 hasLyric 还是 false（见 lyric.store），
 * 先判 isPureMusic / hasLyric 会把「加载中」误报成「暂无歌词」。
 * 另外 mapper 里 `isPureMusic = !hasLyric || 含纯音乐标记`（lyric.mapper.ts），
 * 所以成功加载后的「没有歌词」走纯音乐分支，「暂无歌词」实际是**歌词请求失败**那条路。
 */
const emptyState = computed<TiltEmptyState | null>(() => {
  /** 歌名 + 歌手卡；连歌名都拿不到（一首歌都没选）时返回 null，由调用处退回文本占位 */
  const songCard = (): TiltEmptyState | null => {
    const title = props.ctx.songTitle()
    return title ? { kind: 'song', title, artist: props.ctx.songArtist() ?? '' } : null
  }

  if (lyric.loading) return songCard() ?? { kind: 'text', text: '歌词加载中…' }
  if (lyric.isPureMusic) return { kind: 'text', text: '纯音乐，请欣赏' }
  if (!lyric.hasLyric) return { kind: 'text', text: '暂无歌词' }
  if (!player.currentItem) return { kind: 'text', text: '等待音乐' }
  // 轮到此处：有歌也有歌词，只是还没唱到第一句 —— 显示歌名 + 歌手
  if (currentIndex.value < 0) return songCard() ?? { kind: 'text', text: '等待音乐' }
  return null
})

function handleSeek(): void {
  const line = currentLine.value
  if (!line) return
  // seekLyric 由壳层扣掉 lyricOffset（见 shared/use-transport.ts），此处不要再减
  props.ctx.seekLyric(line.timeMs)
  // 行内 seek 的时间跳变可能小于 SEEK_JUMP_MS，显式请求重同步（下一次时间更新时生效）
  resync()
}
</script>

<template>
  <!-- 背景层：原生几何 / 用户选择的 Folia 背景 -->
  <FoliaSkinBackground
    :cover-url="ctx.coverUrl()"
    :palette="palette"
    :is-daylight="isDaylight"
    :paused="!ctx.isPlaying()"
  >
    <GeometricBackground
      :theme="{
        backgroundColor: palette.background,
        accentColor: palette.accent,
        secondaryColor: palette.secondary
      }"
    />
  </FoliaSkinBackground>

  <!-- 内容层：整屏歌词舞台 -->
  <div class="immersive-content">
    <div class="tilt-lyric" :style="lyricStyle">
      <div ref="stageRef" class="tilt-stage">
        <div ref="panelRef" class="tilt-stage-inner" :style="stageStyle">
          <!-- 有歌、歌词还没出来：给歌名 + 歌手，而不是「等待」文案 -->
          <div v-if="emptyState && emptyState.kind === 'song'" class="tilt-song-info">
            <p class="tilt-song-title">{{ emptyState.title }}</p>
            <p v-if="emptyState.artist" class="tilt-song-artist">{{ emptyState.artist }}</p>
          </div>
          <p v-else-if="emptyState" class="tilt-placeholder">{{ emptyState.text }}</p>
          <TiltLine
            v-else-if="model"
            :key="epoch"
            :model="model"
            :paused="paused"
            :font-family="tiltFontFamily"
            :plain-weight="tiltPlainWeight"
            :tilt-weight="tiltTiltWeight"
            @seek="handleSeek"
          />
        </div>
      </div>

      <!--
        底部副字幕（罗马音 / 译文）：字号档内置在 tilt.scss，不受设置面板影响。

        渲染的是**定长槽位**（见 subtitleSlots）：档位里有几档就占几格，缺文本的那格
        渲染一个不可见的占位行（`visibility: hidden` + 不换行空格，只为止住高度）。
        `:key` 让换行时整块换节点，从而重播 tilt.scss 里那段淡入（数字来自
        SUBTITLE_SWAP_MOTION）。
      -->
      <div
        v-if="subtitleSlots.length > 0"
        :key="subtitleKey"
        class="tilt-subtitles"
        :style="{
          '--tilt-subtitle-color': palette.secondary,
          '--tilt-subtitle-strong-color': palette.primary
        }"
      >
        <p
          v-for="slot in subtitleSlots"
          :key="slot.role"
          class="tilt-subtitle"
          :class="[
            slot.role === 'romanization' ? 'is-romaji' : 'is-translation',
            { 'is-placeholder': slot.text.length === 0 }
          ]"
          :aria-hidden="slot.text ? undefined : 'true'"
        >
          {{ slot.text || '\u00A0' }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss" src="./tilt.scss"></style>
