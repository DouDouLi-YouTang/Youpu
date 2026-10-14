<script setup lang="ts">
import { computed, watch } from 'vue'

import SkinShell from '@/features/immersive/skins/shared/SkinShell.vue'
import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { useColorExtraction } from '@/features/immersive/use-color-extraction'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import { useLyricStore } from '@/stores/lyric.store'
import { usePlayerStore } from '@/stores/player.store'

/**
 * 沉浸式播放页入口（常驻挂载，见 AppFrame）。本组件只负责四件事：
 *  1. `<Transition name="immersive-slide">` 包裹 + `v-if="open"` 的开关时机；
 *  2. 旧持久化的字体设置迁移 + 当前歌曲歌词的懒加载；
 *  3. 专辑主色提取（accentVars）—— 它同时驱动全局主题色（coverAccent），
 *     必须常驻挂载，不能只在沉浸页打开时跑，故留在本组件并以 prop 下传；
 *  4. 把皮肤外壳 `SkinShell` 挂上去。
 *
 * 根 section / 窗口 chrome / ESC / 全屏时钟 / 皮肤切换都在 skins/shared/SkinShell.vue；
 * 皮肤只负责内容层（背景 + 迷你歌曲信息 + 封面槽 + 歌词区），控制条与设置面板属皮肤外共享层。
 */
const { open } = useImmersivePlayer()
const settings = useImmersiveSettingsStore()
// 启动引导：旧的分桶持久化 → 折叠回扁平的这一份设置，再收拢旧格式的字体名、
// 纠正非法皮肤 id。顺序与幂等性由 store 内部保证（见 bootstrapSettings 注释），此处只调一次。
settings.bootstrapSettings()
const player = usePlayerStore()
const lyric = useLyricStore()

const song = computed(() => player.currentItem?.song ?? null)

// 专辑主色提取：取歌曲原始 coverUrl（不用缓存协议 URL，与改造前一致）。
// 同时向全局同步 coverAccent（accentFollowsCover 开启时全应用主色跟随封面），
// 故必须常驻挂载 —— 迁移到只在 v-if="open" 内挂载的 SkinShell 会让全局跟随失效。
const coverUrl = computed(() => song.value?.coverUrl ?? null)
const { accentVars } = useColorExtraction(coverUrl)

// 沉浸层打开且当前有歌时懒加载歌词（store 内部去重）
watch(
  [open, () => song.value?.id],
  ([isOpen, id]) => {
    if (isOpen && id) void lyric.loadLyric(id)
  },
  { immediate: true }
)
</script>

<template>
  <Transition name="immersive-slide">
    <SkinShell v-if="open" :accent-vars="accentVars" />
  </Transition>
</template>
