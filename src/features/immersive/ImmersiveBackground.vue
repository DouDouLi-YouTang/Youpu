<script setup lang="ts">
import { computed } from 'vue'

import { useImmersiveSettingsStore } from './immersive-settings.store'
import BlurBackground from './backgrounds/BlurBackground.vue'
import FluidBackground from './backgrounds/FluidBackground.vue'
import GeometricBackground from './backgrounds/GeometricBackground.vue'
import GradientBackground from './backgrounds/GradientBackground.vue'
import NoneBackground from './backgrounds/NoneBackground.vue'
import SolidBackground from './backgrounds/SolidBackground.vue'

/**
 * 沉浸式动态背景 —— 按 `settings.backgroundType` 在六种背景之间**选一个渲染**。
 *
 * 本组件只做两件事：
 *  1. 调度（下面那棵 v-if 链）；
 *  2. 提供背景层的**定位契约**（`.rnp-bg` 与 `.rnp-bg > div`）。
 *
 * 六种背景的实现在 ./backgrounds/ 下各自一个组件 + 一份同名 .scss：
 *   fluid / blur / gradient / geometric / solid / none
 * 其中 geometric（几何）不同源：它是 Folia 背景层（`backgrounds/GeometricBackground.tsx`）
 * 的独立重写；其余五种是参考项目 background.js + background.scss 的逐字移植。
 *
 * ## 定位契约（改样式前必读）
 *
 * `.rnp-bg > div` 那两条声明靠**特异性**压住各背景子组件对同一元素的定位声明：
 * 子选择器 + 类 = (0,2,1)，而子组件里的 `.rnp-background-xxx` = (0,2,0)。
 * scoped 样式会把父组件的 scope id 打在**子组件的根元素**上，这条规则因此能命中，
 * 也正因如此 —— **每个背景组件必须保持单根元素**（流体那个把 SVG 滤镜定义收在根 div
 * 内部，就是为了这个）。
 *
 * 后果是各子组件里的 left / top 会被这里的 `inset: 0` 顶掉。改造前就是这样
 * （见 fluid-background.scss 的说明），拆分后逐条保持一致，别顺手「修正」。
 */
const settings = useImmersiveSettingsStore()

const type = computed(() => settings.backgroundType)
</script>

<template>
  <div class="rnp-bg">
    <BlurBackground v-if="type === 'blur'" />

    <GradientBackground v-else-if="type === 'gradient'" />

    <FluidBackground v-else-if="type === 'fluid'" />

    <!-- geometric：形状/漂移/粒子全在 backgrounds/GeometricBackground.vue 内，
         频带缩放由它自己按歌曲种子与 AudioBands 驱动（对齐 Folia 的背景正交设计） -->
    <GeometricBackground v-else-if="type === 'geometric'" />

    <SolidBackground v-else-if="type === 'solid'" />

    <!-- none 是兜底：非法 / 未知的 backgroundType 也落到这里，不留白屏 -->
    <NoneBackground v-else />
  </div>
</template>

<style scoped lang="scss">
// 背景层容器：铺满沉浸层，且不吃鼠标事件（控制条浮在它上面）
.rnp-bg {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;

  // 六种背景的公共定位 —— 见文件头的「定位契约」，改这里会连带影响所有背景
  > div {
    position: absolute;
    inset: 0;
  }
}
</style>
