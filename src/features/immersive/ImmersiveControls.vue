<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { usePlayerStore } from '@/stores/player.store'
import AppTooltip from '@/components/common/AppTooltip.vue'
import PlayQueuePanel from '@/features/player/PlayQueuePanel.vue'
import ProgressBar from '@/features/immersive/controls/ProgressBar.vue'
import PlaybackButtons from '@/features/immersive/controls/PlaybackButtons.vue'
import TimeIndicator from '@/features/immersive/controls/TimeIndicator.vue'
import VolumeControl from '@/features/immersive/controls/VolumeControl.vue'
import QualityPicker from '@/features/immersive/controls/QualityPicker.vue'
import RatePicker from '@/features/immersive/controls/RatePicker.vue'
import { useControlsIdle } from '@/features/immersive/controls/use-controls-idle'
import {
  useIdleHoldOnPointerPress,
  useIdleHoldWhile
} from '@/features/immersive/controls/use-idle-hold'
import { resetProgressDrag, useControlsProgress } from '@/features/immersive/controls/use-progress'

/**
 * 沉浸层内嵌控制条 —— 视觉对齐参考项目 refined-control-bar.scss：
 * 36px 圆形主色按钮、播放键主色填充、贴底进度条、自动隐藏。
 *
 * 逻辑复用自 PlayerBar（seek 防抖拖拽、音量、模式、队列）。
 * 自动隐藏阈值 1.5s 对齐参考项目 main.js 的 IdleThreshold。
 *
 * 关闭按钮不在本组件内:由 ImmersivePlayer 右上角独立承载,但通过共享的 idle ref
 * 跟随控制条一起隐藏/唤出(鼠标静止隐藏、移动唤出);ESC 始终可退出沉浸层。
 *
 * 本组件只负责三列布局与队列抽屉；按钮/进度条/弹层按功能拆到 ./controls/ 下的
 * 子组件（ProgressBar 含贴底进度条与悬停预览、PlaybackButtons 中列按钮、
 * TimeIndicator 时间指示器、VolumeControl 音量、QualityPicker 音质、RatePicker 倍速）。
 * 自动隐藏计时与播放进度是跨子组件的共享状态，分别见 controls/use-controls-idle.ts
 * 与 controls/use-progress.ts。控制条内部各节点的样式仍统一挂在本组件（子组件节点
 * 没有本组件的 data-v，需 :deep() 穿透），见 ./immersive-controls.scss。
 */

const player = usePlayerStore()
const { hidden, idleClass } = useControlsIdle()
const { seekValue, isDragging } = useControlsProgress()

const song = computed(() => player.currentItem?.song ?? null)
const artistsText = computed(() =>
  song.value ? song.value.artists.map((a) => a.name).join(' / ') : ''
)

// 队列抽屉开关
const queueVisible = ref(false)

// 「用户正在动控制条 → 不许自动隐藏」的两条来源（见 controls/use-idle-hold.ts）：
//  1. 队列面板展开期间（面板从底部拉起，鼠标在上面就不在屏幕底部那条唤出区里）；
//  2. 指针按住控制条期间 —— 拖滑块时指针常常一动不动，只有「按住即持有」挡得住。
// 三个弹层（音量/倍速/音质）各自的持有在它们的组件里。
useIdleHoldWhile(() => queueVisible.value)
const { onPointerDown: onBarPointerDown } = useIdleHoldOnPointerPress()

// 进度条与时间指示器共用的 seekValue(模块级,见 use-progress.ts)由本组件镜像
// player.currentTimeMs —— 本组件随沉浸层 open 挂载/卸载,监听生命周期正好对齐;
// 拖动中 seekValue 由拖拽处理自己写,这里不覆盖。
watch(
  () => player.currentTimeMs,
  (t) => {
    if (!isDragging.value) seekValue.value = t
  },
  { immediate: true }
)
onBeforeUnmount(resetProgressDrag)
</script>

<template>
  <!-- 进度条 + 悬停预览：独立 fixed 元素，不在控制条网格内（见 controls/ProgressBar.vue） -->
  <ProgressBar :hidden="hidden" />

  <div class="immersive-controls" :class="idleClass" @pointerdown="onBarPointerDown">
    <!-- 左：封面缩略 + 曲名 + 倍速 -->
    <div class="immersive-controls-left">
      <a-avatar
        :src="song?.coverUrl || undefined"
        :size="56"
        shape="square"
        class="!rounded-[10px] !text-[10px]"
      >
        无封面
      </a-avatar>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">{{ song?.name ?? '未播放' }}</p>
        <p class="truncate text-xs opacity-60">{{ artistsText || '—' }}</p>
      </div>
      <RatePicker />
    </div>

    <!-- 中：控件(进度条已移至独立贴底层,对齐参考控制条内无内嵌进度条) -->
    <div class="immersive-controls-center">
      <PlaybackButtons />
    </div>

    <!-- 右：时间指示器 + 音量 + 音质 + 队列 -->
    <div class="immersive-controls-right">
      <TimeIndicator />
      <VolumeControl />
      <QualityPicker />
      <AppTooltip title="播放队列">
        <button
          v-if="!player.fmMode"
          type="button"
          class="rnp-ctrl-btn"
          data-queue-trigger
          aria-label="播放队列"
          @click="queueVisible = !queueVisible"
        >
          <svg class="rnp-mask-icon rnp-icon-queue" aria-hidden="true"></svg>
        </button>
      </AppTooltip>
    </div>
  </div>

  <PlayQueuePanel v-model:visible="queueVisible" />
</template>

<style scoped lang="scss" src="./immersive-controls.scss"></style>
<!-- 与上方 scoped 块特异性相同，源顺序决定层叠，需置于其后 -->
<style scoped lang="scss" src="./immersive-controls.package.scss"></style>
<!-- 含 .rnp-cover* 等由兄弟组件 ImmersiveCover 渲染的选择器，scoped 选不中，需非 scoped -->
<style lang="scss" src="./immersive-controls.global.scss"></style>
