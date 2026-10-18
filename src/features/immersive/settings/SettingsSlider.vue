<script setup lang="ts">
import { computed } from 'vue'

import {
  type ImmersiveSettings,
  type FoliaSettings,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'
import { DEFAULTS, FOLIA_DEFAULTS, num, type DefaultField, type FoliaField } from './defaults'

/**
 * 带 reset 圆点的 slider 行（各 tab 共用）。label / 范围 / 刻度 / 说明由各 tab 传入，
 * 读写直接落到 immersive-settings store —— 字段是组件自己的参数，不经过父组件中转。
 */
const props = defineProps<{
  /** store 字段名；经典字段用 DefaultField，Folia 字段用 FoliaField */
  field: DefaultField | FoliaField
  /** 读写目标；Folia 页签显式传 folia，经典页签不传 */
  target?: 'root' | 'folia'
  label: string
  min: number
  max: number
  step?: number
  marks?: Record<number, string>
  tipFormatter?: (v: number | number[]) => string
  note?: string
}>()

const settings = useImmersiveSettingsStore()
const target = computed(() => props.target ?? 'root')

const currentValue = computed<number>(() => {
  if (target.value === 'folia') return settings.folia[props.field as FoliaField] as number
  return settings[props.field as DefaultField] as number
})

const defaultValue = computed<number>(() => {
  if (target.value === 'folia') return FOLIA_DEFAULTS[props.field as FoliaField]
  return DEFAULTS[props.field as DefaultField]
})

/** 字段是否偏离默认值(对齐参考 .rnp-slider-wrapper.changed:仅改动后才显示 reset 圆点) */
const changed = computed(() => currentValue.value !== defaultValue.value)

/** reset 按钮：把本行字段还原到 DEFAULTS */
function resetField(): void {
  if (target.value === 'folia') {
    settings.folia = { ...settings.folia, [props.field]: defaultValue.value } as FoliaSettings
    return
  }
  settings.$patch({ [props.field]: defaultValue.value } as Partial<ImmersiveSettings>)
}

/**
 * 通用 slider 写回：a-slider 的 @change 透传 $event（number | number[]），统一收成
 * number 后 $patch 到 store。用 $patch 绕开 Pinia store 索引赋值的类型摩擦，同时统一
 * 处理联合类型字段（albumSize / fluidMaxFramerate 等字面量联合）。
 *
 * 注意：必须用非柯里化签名，让 @vue/compiler-sfc 把 $event 显式传给本函数。
 * 早期版本用柯里化 `setField('X')` 返回内层 handler，但模板里的 `@change="setField('X')"`
 * 会被编译为 `$event => setField('X')`——返回的内层 handler 被丢弃、$event 从未传入，
 * 导致全部 slider 拖动后不写回 store。
 */
function onSliderChange(v: number | number[]): void {
  if (target.value === 'folia') {
    settings.folia = { ...settings.folia, [props.field]: num(v) } as FoliaSettings
    return
  }
  settings.$patch({ [props.field]: num(v) } as Partial<ImmersiveSettings>)
}
</script>

<template>
  <div class="setting-row">
    <label class="setting-label-with-reset">
      <span>{{ label }}</span>
      <button type="button" class="reset-btn" :class="{ changed }" @click="resetField"></button>
    </label>
    <a-slider
      :value="currentValue"
      :min="min"
      :max="max"
      :step="step"
      :marks="marks"
      :tip-formatter="tipFormatter"
      @change="onSliderChange"
    />
    <span v-if="note" class="setting-note">{{ note }}</span>
    <slot />
  </div>
</template>
