<script setup lang="ts">
import { computed } from 'vue'

/**
 * 支持「跟随主题」的字重控件。
 *
 * `modelValue = null` 表示跟随主题内置字重；关闭跟随后使用 `defaultWeight`，
 * 再通过 100–900、步长 100 的滑杆调整。控件本身不做持久化，写回由页面负责。
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
    label?: string
    defaultWeight?: number
    note?: string
  }>(),
  {
    label: '字重',
    defaultWeight: 400,
    note: ''
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
}>()

const followsTheme = computed({
  get: () => props.modelValue === null,
  set: (follow: boolean) => emit('update:modelValue', follow ? null : props.defaultWeight)
})

const sliderValue = computed(() => props.modelValue ?? props.defaultWeight)

function onSliderChange(value: number | number[]): void {
  emit('update:modelValue', Array.isArray(value) ? value[0] : value)
}
</script>

<template>
  <div class="setting-row">
    <label>{{ label }}</label>
    <a-checkbox v-model:checked="followsTheme">跟随主题</a-checkbox>
    <a-slider
      :value="sliderValue"
      :min="100"
      :max="900"
      :step="100"
      :disabled="followsTheme"
      @change="onSliderChange"
    />
    <span v-if="note" class="setting-note">{{ note }}</span>
  </div>
</template>
