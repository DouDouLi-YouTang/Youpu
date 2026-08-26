<script setup lang="ts">
import { h, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Checkbox, message, Modal } from 'ant-design-vue'

import AppFrame from '@components/layout/AppFrame.vue'
import CommentsDrawer from '@/features/comments/CommentsDrawer.vue'
import StartupSplash from '@/features/startup/StartupSplash.vue'
import { useAuthStore } from '@/stores/auth.store'
import { usePlayerStore } from '@/stores/player.store'
import { useSettingsStore } from '@/stores/settings.store'
import { setMessageInstance } from './message-holder'
import { useGlobalPlaybackShortcuts } from '@/composables/useGlobalPlaybackShortcuts'
import { setUnauthorizedHandler } from '@/services/api/api-client'
import { runStartupBackendUpdateCheck } from '@/services/api-server-maintenance'
import { runStartupAppUpdateCheck } from '@/services/app-update-maintenance'
import { useTheme, zhCN } from './providers/theme-provider'

const { antdTheme } = useTheme()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const player = usePlayerStore()
const [messageApi, messageContextHolder] = message.useMessage()
const [modalApi, modalContextHolder] = Modal.useModal()

setMessageInstance(messageApi)

function onOffline(): void {
  messageApi.warning('网络中断，将使用缓存播放', 5)
}

function onOnline(): void {
  messageApi.success('网络已恢复')
}

setUnauthorizedHandler(() => auth.handleUnauthorized())
useGlobalPlaybackShortcuts()

// If the session drops while on a protected route (e.g. a user-private request
// returned 401 → auth.handleUnauthorized() mid-use), bounce to login with the
// original path so the user can re-scan and return. Manual logout navigates to a
// public page first, so this guard does not fire for it. The route guard still
// covers navigation attempts; this watch covers in-place expiry.
watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (!loggedIn && route.meta.requiresAuth) {
      void router.replace({
        name: 'login',
        query: { redirect: route.fullPath, reason: 'expired' }
      })
    }
  }
)

// 播放状态变化时推给主进程(供托盘菜单更新播放/暂停文字)
watch(
  () => auth.expired,
  (isExpired) => {
    if (!isExpired) return

    modalApi.confirm({
      title: '登录已过期',
      content: '登录状态已失效，请重新登录',
      okText: '重新登录',
      okCancel: false,
      maskClosable: false,
      keyboard: false,
      centered: true,
      onOk: () => {
        auth.confirmSessionExpiry()
        void router.replace({
          name: 'login',
          query: { redirect: route.fullPath, reason: 'expired' }
        })
      }
    })
  },
  { immediate: true }
)

watch(
  () => player.state,
  (state) => {
    window.muiceDesktop?.player.pushState(state)
  },
  { immediate: true }
)

// 登录后加载喜欢列表(初始化已喜欢状态);退出登录清空
watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn && auth.userId && auth.cookie) {
      void player.loadLikedList(auth.userId, auth.cookie)
    } else {
      player.likedSongIds = []
    }
  },
  { immediate: true }
)

let unsubClose: (() => void) | null = null
let unsubTray: (() => void) | null = null

function showCloseModal(api: NonNullable<typeof window.muiceDesktop>): void {
  const remember = ref(false)

  const confirmApi = modalApi.confirm({
    title: '关闭应用',
    content: () =>
      h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
        h('span', '是否退出应用，还是最小化到系统托盘继续后台播放？'),
        h(
          Checkbox,
          {
            checked: remember.value,
            onChange: (e: { target: { checked: boolean } }) => {
              remember.value = e.target.checked
            }
          },
          () => '记住我的选择'
        )
      ]),
    centered: true,
    // 点击遮罩 / 按 Esc 仅关闭弹窗(取消本次关闭),不执行退出或托盘动作。
    // 两个动作只能由底部按钮触发,因此用自定义 footer 取代默认 ok/cancel
    // 按钮:默认取消按钮与遮罩关闭都会走 onCancel,无法区分"选择托盘"与"仅关闭"。
    maskClosable: true,
    footer: () =>
      h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px' }, [
        h(
          Button,
          {
            onClick: () => {
              if (remember.value) settings.closeAction = 'tray'
              api.window.sendCloseAction('tray')
              confirmApi.destroy()
            }
          },
          () => '最小化到托盘'
        ),
        h(
          Button,
          {
            type: 'primary',
            onClick: () => {
              if (remember.value) settings.closeAction = 'quit'
              api.window.sendCloseAction('quit')
              confirmApi.destroy()
            }
          },
          () => '退出应用'
        )
      ])
  })
}

onMounted(() => {
  runStartupBackendUpdateCheck()
  runStartupAppUpdateCheck(router)
  if (!navigator.onLine) onOffline()
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)

  const api = window.muiceDesktop
  if (!api) return

  // 拦截主进程的窗口关闭请求:根据 closeAction 决定弹框还是直接执行
  unsubClose = api.window.onCloseRequested(() => {
    if (settings.closeAction === 'quit') {
      api.window.sendCloseAction('quit')
    } else if (settings.closeAction === 'tray') {
      api.window.sendCloseAction('tray')
    } else {
      showCloseModal(api)
    }
  })

  // 托盘右键菜单命令:播放/暂停/上一首/下一首
  unsubTray = api.player.onTrayCommand((cmd) => {
    if (cmd === 'play-pause') player.togglePlay()
    else if (cmd === 'prev') player.previous()
    else if (cmd === 'next') player.next()
  })
})

onUnmounted(() => {
  unsubClose?.()
  unsubTray?.()
  window.removeEventListener('offline', onOffline)
  window.removeEventListener('online', onOnline)
  setUnauthorizedHandler(null)
})
</script>

<template>
  <a-config-provider :theme="antdTheme" :locale="zhCN" component-size="middle">
    <AppFrame />
    <CommentsDrawer />
    <StartupSplash />
    <component :is="messageContextHolder" />
    <component :is="modalContextHolder" />
  </a-config-provider>
</template>
