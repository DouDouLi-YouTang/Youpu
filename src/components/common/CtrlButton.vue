<script setup lang="ts">
/**
 * 通用圆形控制按钮。
 *
 * 样式基准：沉浸式歌词面板的 `.rnp-ctrl-btn`
 * - 圆形、透明背景、border 0
 * - hover 主色 15% 半透明背景
 * - active 缩放 0.92
 * - disabled 透明度 0.4
 *
 * variant:
 * - `default`：透明背景（默认）
 * - `play`：主色填充 + 白字，hover brightness(1.1)
 * - `liked`：主色文字
 *
 * 不含 tooltip（调用方按需自行包裹）。
 */
import { computed } from 'vue'
import AppTooltip from './AppTooltip.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** 按钮直径 px */
    size?: number
    /** 图标尺寸 px，默认 size * 0.55 */
    iconSize?: number
    /** 视觉样式 */
    variant?: 'default' | 'play' | 'liked' | 'play-white' | 'ghost'
    /** 是否禁用 */
    disabled?: boolean
    /** 无障碍标签 */
    ariaLabel?: string
    /** 悬停气泡提示文字(受全局开关控制) */
    tooltip?: string
  }>(),
  {
    size: 36,
    iconSize: 0,
    variant: 'default',
    disabled: false,
    ariaLabel: '',
    tooltip: ''
  }
)

const btnStyle = computed(() => {
  const s = props.size
  const icon = props.iconSize || s * 0.55
  return {
    width: `${s}px`,
    height: `${s}px`,
    '--ctrl-icon-size': `${icon}px`
  }
})
</script>

<template>
  <AppTooltip :title="tooltip">
    <button
      v-bind="$attrs"
      type="button"
      class="ctrl-btn"
      :class="`ctrl-btn--${variant}`"
      :style="btnStyle"
      :disabled="disabled"
      :aria-label="ariaLabel"
    >
      <slot />
    </button>
  </AppTooltip>
</template>

<style lang="scss" scoped>
.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  color: inherit;
  background: transparent;
  transition:
    background 0.2s,
    transform 0.1s,
    filter 0.2s;

  :deep(svg) {
    width: var(--ctrl-icon-size);
    height: var(--ctrl-icon-size);
  }

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &--play {
    background: var(--color-primary);
    color: $color-white;

    &:hover:not(:disabled) {
      background: var(--color-primary);
      color: $color-white;
      filter: brightness(1.1);
    }
  }

  &--liked {
    color: var(--color-primary);

    &:hover:not(:disabled) {
      color: var(--color-primary);
    }
  }

  &--play-white {
    background: $color-white;
    color: var(--color-primary);

    &:hover:not(:disabled) {
      background: $color-white;
      color: var(--color-primary);
      filter: brightness(0.95);
    }
  }

  &--ghost {
    background: rgba(255, 255, 255, 0.15);
    color: $color-white;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.25);
      color: $color-white;
    }
  }
}

// package-0.1.21 拆分族(ctrl-btn)并入本文件:以下规则原是同名旧内联块之后追加的独立 scoped 文件,
// 现直接接在上面,顺序不变——同选择器同特异性时源码序后者赢,继续压住上面这段旧内联(去重合并见另一任务)。
// 层叠依赖:本文件 :deep(svg) 的选择器特异性 (0,2,1) 需继续压过 PlaybackModeIcon.vue 的
// .mode-mask-icon / .mode-heartbeat-icon (0,2,0),不要缩短或简化这条 :deep(svg) 选择器链。
.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  color: inherit;
  background: transparent;
  transition:
    background 0.2s,
    transform 0.1s,
    filter 0.2s;

  :deep(svg) {
    width: var(--ctrl-icon-size);
    height: var(--ctrl-icon-size);
  }

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.ctrl-btn--play {
  background: var(--color-primary);
  color: $color-white;

  &:hover:not(:disabled) {
    background: var(--color-primary);
    color: $color-white;
    filter: brightness(1.1);
  }
}

.ctrl-btn--liked {
  color: var(--color-primary);

  &:hover:not(:disabled) {
    color: var(--color-primary);
  }
}

.ctrl-btn--play-white {
  background: $color-white;
  color: var(--color-primary);

  &:hover:not(:disabled) {
    background: $color-white;
    color: var(--color-primary);
    filter: brightness(0.95);
  }
}

.ctrl-btn--ghost {
  background: rgba(255, 255, 255, 0.15);
  color: $color-white;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.25);
    color: $color-white;
  }
}
</style>
