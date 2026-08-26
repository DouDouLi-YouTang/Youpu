<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore, cancelQrPolling } from '@/stores/auth.store'
import PhoneLoginForm from './components/PhoneLoginForm.vue'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const redirect = computed(() => {
  const r = route.query.redirect
  // Only honor internal absolute paths. Reject protocol-relative (`//host`)
  // and external URLs to prevent an open-redirect via the `redirect` query.
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
})

// 登录方式: 'qr' 扫码登录 | 'phone' 手机号登录。默认扫码,切换时停/启二维码轮询。
const loginMode = ref('qr')

const loginModeOptions = [
  { label: '扫码登录', value: 'qr' },
  { label: '手机号登录', value: 'phone' }
]

const subtitle = computed(() =>
  loginMode.value === 'qr' ? '使用网易云音乐 App 扫描下方二维码登录' : '使用手机号和验证码登录'
)

// Shown when the user was bounced here by a mid-session expiry (401).
const expiredNotice = computed(() => route.query.reason === 'expired' || authStore.expired)

// QR image is a base64 dataURL straight from NetEase (`qrimg` field), so it can
// be bound directly to <img :src>. While generating, show a placeholder.
const qrImageSrc = computed(() => authStore.qrimg || '')

// The store sets `qrMessage` for every active state (including the transient
// "登录中" feedback when 803 is detected), so it is the single source of truth
// for the status line. Fall back per-status only if no message is set yet.
const statusText = computed(() => {
  if (authStore.qrMessage) return authStore.qrMessage
  switch (authStore.qrStatus) {
    case 'generating':
      return '正在生成二维码…'
    case 'scanning':
      return '请使用网易云音乐 App 扫码登录'
    case 'confirming':
      return '扫描成功，请在手机上确认登录'
    case 'logged-in':
      return '登录成功，正在跳转…'
    case 'expired':
      return '二维码已过期，请刷新'
    case 'error':
      return '登录失败，请重试'
    default:
      return ''
  }
})

const isRefreshable = computed(
  () => authStore.qrStatus === 'expired' || authStore.qrStatus === 'error'
)
const isAwaiting = computed(
  () =>
    authStore.qrStatus === 'scanning' ||
    authStore.qrStatus === 'confirming' ||
    authStore.qrStatus === 'generating' ||
    authStore.qrStatus === 'logged-in'
)

onMounted(() => {
  if (!authStore.isLoggedIn) {
    void authStore.startQrLogin()
  }
})

onBeforeUnmount(() => {
  cancelQrPolling()
})

// 登录成功后(二维码或手机号)跳转到原目标路由。
watch(
  () => authStore.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      void router.replace(redirect.value)
    }
  }
)

// 切换登录方式: 切到手机号时停止二维码轮询,切回扫码时重新发起。
watch(loginMode, (mode) => {
  if (mode === 'qr') {
    if (!authStore.isLoggedIn) void authStore.startQrLogin()
  } else {
    cancelQrPolling()
  }
})

function handleRefresh(): void {
  void authStore.regenerateQr()
}
</script>

<template>
  <section class="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-6">
    <header class="flex flex-col items-center gap-2 text-center">
      <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-5 w-5"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3zM20 14v3M14 20h7" />
        </svg>
      </div>
      <h2 class="text-lg font-semibold text-text-primary">登录</h2>
      <p class="text-sm text-text-secondary">{{ subtitle }}</p>
      <p v-if="expiredNotice" class="text-sm text-amber-400">登录已过期，请重新登录</p>
    </header>

    <a-segmented v-model:value="loginMode" :options="loginModeOptions" />

    <Transition name="login-switch" mode="out-in">
      <div v-if="loginMode === 'qr'" key="qr" class="flex flex-col items-center gap-3">
        <div
          class="relative flex h-52 w-52 items-center justify-center rounded-2xl bg-[var(--color-bg-elevated)] p-3 shadow-lg"
        >
          <!-- Generating placeholder -->
          <div
            v-if="!qrImageSrc"
            class="flex h-full w-full items-center justify-center text-text-secondary"
          >
            <div class="flex flex-col items-center gap-3">
              <div
                class="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
              />
              <span class="text-xs">生成中…</span>
            </div>
          </div>

          <img
            v-else
            :src="qrImageSrc"
            alt="登录二维码"
            class="h-full w-full rounded-lg object-contain"
            :class="{ 'opacity-40': authStore.qrStatus === 'expired' }"
          />

          <!-- Expired / error refresh overlay -->
          <button
            v-if="isRefreshable"
            type="button"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl backdrop-blur-sm"
            @click="handleRefresh"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-6 w-6 text-primary"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span class="text-sm text-primary">点击刷新二维码</span>
          </button>
        </div>

        <p
          class="min-h-5 text-center text-sm"
          :class="{
            'text-text-secondary': isAwaiting,
            'text-[var(--color-primary)]': authStore.qrStatus === 'logged-in',
            'text-red-400': authStore.qrStatus === 'error',
            'text-amber-400': authStore.qrStatus === 'expired'
          }"
        >
          {{ statusText }}
        </p>
      </div>

      <PhoneLoginForm v-else key="phone" />
    </Transition>
  </section>
</template>

<style scoped>
.login-switch-enter-active,
.login-switch-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.login-switch-enter-from,
.login-switch-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
