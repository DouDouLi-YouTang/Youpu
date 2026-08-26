<script setup lang="ts">
import { onMounted, ref } from 'vue'

import logoUrl from '@/assets/logo.png'

/**
 * 启动 splash:renderer 内 overlay,覆盖首屏初始化间隙避免突兀。
 * 主进程 ready-to-show → show() 后 renderer 可见,splash 占位到首个页面就绪,
 * 最短展示 600ms 让品牌动画播完,之后淡出。
 */
const visible = ref(true)

onMounted(() => {
  setTimeout(() => {
    visible.value = false
  }, 600)
})
</script>

<template>
  <Transition name="splash">
    <div v-if="visible" class="startup-splash">
      <img class="startup-logo" :src="logoUrl" alt="有谱" />
      <p class="startup-name">有谱</p>
      <p class="startup-subtitle">桌面音乐</p>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.startup-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--color-bg-primary);
}

.startup-logo {
  display: block;
  width: 72px;
  height: 72px;
  border-radius: 20px;
  object-fit: cover;
  animation: splash-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.startup-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  animation: splash-fade-up 0.5s ease 0.1s both;
}

.startup-subtitle {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  animation: splash-fade-up 0.5s ease 0.2s both;
}

@keyframes splash-pop {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes splash-fade-up {
  0% {
    transform: translateY(6px);
    opacity: 0;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

.splash-leave-active {
  transition: opacity 0.4s ease;
}

.splash-leave-to {
  opacity: 0;
}
</style>
