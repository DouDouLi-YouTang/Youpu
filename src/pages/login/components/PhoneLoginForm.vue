<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()

/** 发送验证码后的重发倒计时秒数。 */
const RESEND_SECONDS = 60
const PHONE_RE = /^1[3-9]\d{9}$/

const phone = ref('')
const captcha = ref('')
const sending = ref(false)
const loggingIn = ref(false)
const countdown = ref(0)
const errorMsg = ref('')

let timerId: number | null = null

const sendDisabled = computed(() => sending.value || countdown.value > 0)
const sendLabel = computed(() =>
  countdown.value > 0 ? `${countdown.value}s 后重发` : '发送验证码'
)

function clearTimer(): void {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
}

function startCountdown(): void {
  clearTimer()
  countdown.value = RESEND_SECONDS
  timerId = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) clearTimer()
  }, 1000)
}

onBeforeUnmount(clearTimer)

async function handleSendCaptcha(): Promise<void> {
  errorMsg.value = ''
  if (!PHONE_RE.test(phone.value)) {
    errorMsg.value = '请输入正确的手机号'
    return
  }
  sending.value = true
  try {
    await authStore.sendCaptchaCode(phone.value.trim())
    startCountdown()
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '验证码发送失败，请重试'
  } finally {
    sending.value = false
  }
}

async function handleLogin(): Promise<void> {
  errorMsg.value = ''
  if (!PHONE_RE.test(phone.value)) {
    errorMsg.value = '请输入正确的手机号'
    return
  }
  if (captcha.value.trim().length < 4) {
    errorMsg.value = '请输入验证码'
    return
  }
  loggingIn.value = true
  try {
    const outcome = await authStore.loginWithCaptcha(phone.value.trim(), captcha.value.trim())
    if (outcome.status === 'error') {
      errorMsg.value = outcome.error.message
    }
    // 成功: auth.isLoggedIn 变为 true,LoginPage 监听后跳转。
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : '登录失败，请重试'
  } finally {
    loggingIn.value = false
  }
}
</script>

<template>
  <form class="flex w-full flex-col gap-3" @submit.prevent="handleLogin">
    <a-input v-model:value="phone" :maxlength="11" placeholder="请输入手机号" aria-label="手机号">
      <template #addonBefore>+86</template>
    </a-input>

    <div class="flex gap-2">
      <a-input
        v-model:value="captcha"
        :maxlength="6"
        placeholder="请输入验证码"
        aria-label="验证码"
        class="flex-1"
      />
      <a-button :disabled="sendDisabled" :loading="sending" @click="handleSendCaptcha">
        {{ sendLabel }}
      </a-button>
    </div>

    <p v-if="errorMsg" class="m-0 text-sm text-red-400">{{ errorMsg }}</p>

    <a-button type="primary" block html-type="submit" :loading="loggingIn"> 登录 </a-button>
  </form>
</template>
