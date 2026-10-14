<script setup lang="ts">
import { computed, ref } from 'vue'

import GeometricBackground from '@/features/immersive/backgrounds/GeometricBackground.vue'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'
import { resolveSubtitleTracks } from '../shared/subtitle-tracks'
import type { SkinContext } from '../types'
import TiltLine from './TiltLine.vue'
import {
  CHAR_FADE_DURATION_MS,
  TILT_FONT_SCALE,
  resolveLineEndMs,
  type TiltLineSource
} from './tilt-adapter'
import { useTiltFontReady } from './use-tilt-font'
import { useTiltLayout } from './use-tilt-layout'
import { useTiltTiming } from './use-tilt-timing'

/**
 * 「倾诉」(tilt) 皮肤 —— Folia 式**全屏歌词**面板（与「经典」皮肤并列的款式）。
 *
 * ⚠️ **本面板没有设置**（2026-10-11 用户定：「原来的设置是给经典面板用的，然后倾诉这个
 * 主题是没有设置的」）。外观全部固定，不读 store 里那套面板外观字段：
 *  - **背景恒为「几何」且不可改** —— 直接挂 `backgrounds/GeometricBackground.vue`，
 *    不经过 `ImmersiveBackground.vue`（那个组件是「按 backgroundType 六选一」的实现）；
 *  - **永不显示封面** —— 有歌词就是整屏歌词舞台；没有歌词时舞台中央显示歌名 + 歌手卡
 *    （纯音乐 / 加载失败 / 未选歌各自的中文提示不变），不再回退到整屏封面；
 *  - **歌词排版与字体用内置值** —— 字号倍率是 `TILT_FONT_SCALE`（1 倍）、副字幕的
 *    em 档与字重 / 字间距 / 行高都在 tilt.scss 与 tilt-adapter.ts 里写死。
 *    所以沉浸页右上角也没有设置按钮（见 shared/SkinShell.vue），根节点不套用
 *    经典那套外观 class / CSS 变量（见 shared/use-backdrop.ts 的两档说明）。
 *  - 顶部迷你歌曲信息条不显示（它原是「仅歌词」模式专属，而倾诉不再读显示模式）。
 *
 * **仍然跟随的沉浸页通用项**：明暗主题、专辑主色、底栏四项、演示模式、歌词偏移
 * （最后一项在下面读 `settings.lyricOffset`：它是节拍对齐，不是排版）。用户拍板。
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
 * 这类占位行不会漏到底栏 —— 这条门槛倾诉原先没有，是切过来时一并修掉的。
 *
 * ⚠️ 行对象的角色名 `role` 是 `'romanization' | 'translation'`，而倾诉的 SCSS 用的是
 * 短名 `is-romaji` / `is-translation`（历史命名，样式文件里已存在）。这里在模板上做映射，
 * 不动样式 —— 改 class 名会让 `tilt.scss` 与模板同时要改，收益只是"名字更整齐"。
 *
 * 两行各自的字号档写在 tilt.scss 里（内置固定值，不受设置面板影响）。
 */
const subtitleRows = computed(() => resolveSubtitleTracks(currentLine.value, 'both'))

const panelRef = ref<HTMLElement | null>(null)
/** 舞台元素：量它的高度当「歌词可占多高」，纵向放不下时据此整体缩小字号 */
const stageRef = ref<HTMLElement | null>(null)
// 内置字体的就绪信号（站酷快乐体 + 圆体假名兜底，见 use-tilt-font.ts）。
// 字体文件是异步到位的，就绪前 canvas 只能拿兜底字量宽；把它接进下面的 fontKey，
// 字体一到位就重测一次，避免「按兜底字宽缩放、真字体来了却不重算」。
const { fontState } = useTiltFontReady()
const { layout } = useTiltLayout({
  source,
  // 字号倍率固定 1：倾诉的字号不是用户的「歌词字体大小」，是它自己的 clamp 档位（见文件头）
  fontScale: TILT_FONT_SCALE,
  // 字体标识：倾诉不读「自定义字体」设置（没有设置面板），它的字体是内置常量 ——
  // 这个 key 唯一会变的就是「内置字体加载完成」（pending → ready）。
  // 布局 hook 只需知道「变过」，不必知道变成了什么：字体族名它自己从
  // getComputedStyle 读（见该 hook 的 readFontFamily）。
  fontKey: fontState,
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
  <!-- 背景层：恒为「几何」，不可改（倾诉没有背景设置） -->
  <GeometricBackground />

  <!-- 内容层：整屏歌词舞台 -->
  <div class="immersive-content">
    <div class="tilt-lyric">
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
            @seek="handleSeek"
          />
        </div>
      </div>

      <!-- 底部副字幕（罗马音 / 译文）：字号档内置在 tilt.scss，不受设置面板影响 -->
      <div v-if="subtitleRows.length" class="tilt-subtitles">
        <p
          v-for="row in subtitleRows"
          :key="row.role"
          class="tilt-subtitle"
          :class="row.role === 'romanization' ? 'is-romaji' : 'is-translation'"
        >
          {{ row.text }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss" src="./tilt.scss"></style>
