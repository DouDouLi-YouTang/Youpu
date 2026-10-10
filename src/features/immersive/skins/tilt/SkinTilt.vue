<script setup lang="ts">
import { computed } from 'vue'

import { useLyricStore } from '@/stores/lyric.store'
import type { SkinContext } from '../types'

/**
 * 「倾诉」(tilt) 皮肤 —— **本文件是 C1 的占位实现，真实排版算法见 C3**
 * （分行 / 倾斜选行 / 逐字动画 / 溢出缩放，将落在 skins/tilt/ 下的独立模块里，本文件届时重写）。
 *
 * 占位存在的意义：让「注册表 → 切换入口 → SkinContext → 频谱」这条链路端到端可验证，
 * 而不是等 C3 才发现接不上。因此这里只用两样东西：
 *  1. SkinContext 的 currentLineIndex() / songTitle() / songArtist()；
 *  2. bands().low 驱动一条水平条（证明真实频谱数据确实通到了皮肤）。
 *
 * 注：当前歌词行**文本**不在 SkinContext 契约里（契约只给下标），占位直接从 lyric store
 * 读原始行；C3 需要整份带逐字时间戳的 lines，同样应直接消费 store。
 */
const props = defineProps<{ ctx: SkinContext }>()

const lyric = useLyricStore()

const currentLine = computed(() => {
  const index = props.ctx.currentLineIndex()
  return index >= 0 ? (lyric.lines[index]?.text ?? '') : ''
})

/** 低频能量 → 横条缩放（0.12 保底，静音/未播放时不至于完全消失） */
const barScale = computed(() => 0.12 + props.ctx.bands().low * 0.88)
</script>

<template>
  <div class="tilt-placeholder">
    <div class="tilt-placeholder-meta">
      <div class="tilt-placeholder-title">{{ ctx.songTitle() ?? '未播放' }}</div>
      <div class="tilt-placeholder-artist">{{ ctx.songArtist() ?? '—' }}</div>
    </div>

    <div class="tilt-placeholder-line">{{ currentLine }}</div>

    <!-- 频谱响应占位：随低频能量缩放的横条（证明 bands() 通路正常，C3 会换成真实排版） -->
    <div class="tilt-placeholder-bar">
      <div class="tilt-placeholder-bar-fill" :style="{ transform: `scaleX(${barScale})` }" />
    </div>

    <div class="tilt-placeholder-note">「倾诉」布局实现中，当前为占位预览</div>
  </div>
</template>

<style scoped lang="scss">
.tilt-placeholder {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: 0 10vw;
  text-align: center;
  pointer-events: none;
}

.tilt-placeholder-meta {
  line-height: 1.4;
  opacity: 0.75;
}

.tilt-placeholder-title {
  font-size: 1rem;
  font-weight: 600;
}

.tilt-placeholder-artist {
  font-size: 0.85rem;
  opacity: 0.7;
}

.tilt-placeholder-line {
  max-width: 100%;
  font-size: 1.6rem;
  font-weight: 300;
  letter-spacing: 0.08em;
}

.tilt-placeholder-bar {
  width: min(60vw, 520px);
  height: 4px;
  border-radius: 9999px;
  background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.15);
  overflow: hidden;
}

.tilt-placeholder-bar-fill {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--rnp-accent-color, var(--color-primary));
  transform: scaleX(0.12);
  transform-origin: left center;
  transition: transform 90ms linear;
}

.tilt-placeholder-note {
  font-size: 0.75rem;
  opacity: 0.45;
}
</style>
