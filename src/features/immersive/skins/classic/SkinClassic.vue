<script setup lang="ts">
import { ref, watch } from 'vue'

import ImmersiveBackground from '@/features/immersive/ImmersiveBackground.vue'
import ImmersiveCover from '@/features/immersive/ImmersiveCover.vue'
import LyricContributors from '@/features/immersive/LyricContributors.vue'
import MiniSongInfo from '@/features/immersive/MiniSongInfo.vue'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useEffectiveDisplayMode } from '@/features/immersive/use-skin-context'
import LyricLines from '@/features/lyric/LyricLines.vue'
import { useLyricStore } from '@/stores/lyric.store'
import type { SkinContext } from '../types'

/**
 * 「经典」皮肤 —— 改造前的沉浸页布局原样搬入，行为等价：DOM 结构、class 名、
 * 文案、全部 LyricLines prop 与 :deep() 覆盖值均与改造前一致。
 *
 * 根节点是 **fragment**（背景 / 迷你歌曲信息 / 内容层三个并列元素）：
 * 与搬移前的 DOM 结构逐节点一致，避免多包一层 div 破坏 .immersive-content 的 height:100% 布局链。
 *
 * 与外壳的边界：外壳负责窗口 chrome 与 rootClasses/rootStyleVars 注入（根 section 的
 * class 驱动本组件的 display-mode-* / cover-halign-* 等视觉分支）；本组件只负责内容层。
 */
defineProps<{ ctx: SkinContext }>()

const settings = useImmersiveSettingsStore()
const lyric = useLyricStore()
const effectiveDisplayMode = useEffectiveDisplayMode()

const lyricLinesRef = ref<InstanceType<typeof LyricLines> | null>(null)

// lyricOffset 滑块 step=100ms,拖动中每次变化远低于 LyricLines 内部 800ms 的 seek
// 检测阈值,不会自行重建逐字快照 —— 当前行 per-word delay 仍按旧 offset 固化,
// 逐字高亮与新时间轴失配。显式通知重同步(flush:post 保证子组件已拿到新 currentTimeMs)。
watch(
  () => settings.lyricOffset,
  () => lyricLinesRef.value?.resyncKaraoke(),
  { flush: 'post' }
)
// 翻译/罗马音字号只以 CSS 变量注入(见 use-backdrop 的 rootStyleVars),不是 LyricLines 的 prop,
// 字号变化改变行高但不触发其内部重排 watcher —— 显式重测行高并重排,
// 否则带翻译的行立即重叠/出现空隙,要等下一次切行才自愈(参考项目对应派发 recalc-lyrics)。
watch(
  [() => settings.lyricTranslationSizeEm, () => settings.lyricRomajiSizeEm],
  () => lyricLinesRef.value?.remeasure(),
  { flush: 'post' }
)
</script>

<template>
  <!-- 背景层 -->
  <ImmersiveBackground />

  <!-- 仅歌词模式顶部迷你歌曲信息：参考项目 mini-song-info，随 idle 自动隐藏 -->
  <MiniSongInfo />

  <!-- 内容层：左封面 / 右歌词。displayMode 控制各区域显隐 -->
  <div class="immersive-content">
    <div
      v-show="effectiveDisplayMode !== 'lyric-only'"
      class="immersive-cover-slot"
      :class="[`cover-halign-${settings.coverHAlign}`, `cover-valign-${settings.coverVAlign}`]"
    >
      <ImmersiveCover />
    </div>

    <!-- 歌词区 -->
    <div v-show="effectiveDisplayMode !== 'cover-only'" class="immersive-lyric">
      <LyricLines
        ref="lyricLinesRef"
        :lines="lyric.lines"
        :active-index="ctx.currentLineIndex()"
        :font-size="settings.lyricFontSize"
        :alignment-percentage="settings.currentLyricAlignmentPercentage"
        :enable-zoom="settings.lyricZoom"
        :enable-blur="settings.lyricBlur"
        :enable-fade="settings.lyricFade"
        :enable-stagger="settings.lyricStagger"
        :enable-rotate="settings.lyricRotate"
        :rotate-curvature="settings.rotateCurvature"
        :karaoke-animation="settings.karaokeAnimation"
        :current-time-ms="ctx.currentTime()"
        :enable-lyric-glow="settings.lyricGlow"
        :is-playing="ctx.isPlaying()"
        @seek="ctx.seekLyric"
      >
        <!-- 歌词贡献者:作为歌词列表末项随当前行滚动(对齐参考项目 lyrics.js:754)。
             LyricLines 通过 contributors 具名 slot 提供 transform style,此处填充组件。
             显隐仍由 rnp-lyric-contributors-* class 控制(见外壳样式)。 -->
        <template #contributors="{ ctx: slotCtx }">
          <LyricContributors
            :contributors="lyric.contributors"
            :style="slotCtx.contributorsStyle"
          />
        </template>
      </LyricLines>
    </div>
  </div>
</template>

<style scoped lang="scss" src="./classic.scss"></style>
