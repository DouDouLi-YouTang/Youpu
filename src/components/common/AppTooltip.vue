<script setup lang="ts">
/**
 * 受全局开关控制的 tooltip 包装器。
 *
 * 设置 `settings.showButtonTooltips` 为 false 时直接渲染插槽内容，
 * 不产生 a-tooltip 包裹，用于统一关闭所有按钮气泡提示。
 */
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings.store'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ title?: string }>()

const settings = useSettingsStore()
const shouldShow = computed(() => settings.showButtonTooltips && !!props.title)
</script>

<template>
  <a-tooltip v-if="shouldShow" v-bind="$attrs" :title="title">
    <slot />
  </a-tooltip>
  <slot v-else />
</template>
