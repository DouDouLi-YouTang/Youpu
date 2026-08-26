<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BorderOutlined,
  CloseOutlined,
  CompressOutlined,
  LeftOutlined,
  LogoutOutlined,
  MinusOutlined,
  SearchOutlined,
  SettingOutlined,
  SwitcherOutlined,
  UserOutlined
} from '@ant-design/icons-vue'

import { routes } from '@/constants/routes'
import { useMiniMode } from '@/features/player/use-mini-mode'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onMaximizeChange,
  toggleMaximizeWindow
} from '@/platform/electron/window'
import { searchHot, searchSuggest } from '@/services/api/endpoints/search.api'
import { useAuthStore } from '@/stores/auth.store'
import logoUrl from '@/assets/logo.png'

/**
 * 打包版 0.1.21 顶栏：品牌 + 返回 + 居中搜索 + 头像 + 设置齿轮 + 窗口控件。
 * （搜索/设置已从独立 TopBar 合并进 TitleBar）
 */

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { toggle: toggleMini } = useMiniMode()

const isMaximized = ref(false)
const searchKeyword = ref('')
const searchOptions = ref<{ value: string; key: string; index: number }[]>([])

const avatarInitial = computed(() => {
  const name = authStore.nickname.trim()
  return name ? name.charAt(0).toUpperCase() : '游'
})

const showBack = computed(() => {
  const p = route.path
  return p !== routes.discover && p !== routes.login && p !== '/'
})

function goBack(): void {
  if (window.history.length > 1) {
    router.back()
    return
  }
  void router.push(routes.discover)
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let requestToken = 0
let unsubMax: (() => void) | null = null

watch(searchKeyword, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const q = val.trim()
  if (!q) {
    void loadHot()
    return
  }
  debounceTimer = setTimeout(async () => {
    const token = ++requestToken
    try {
      const suggests = await searchSuggest(q)
      if (token !== requestToken) return
      searchOptions.value = suggests.map((s, index) => ({
        value: s,
        key: `s-${index}-${s}`,
        index
      }))
    } catch {
      if (token !== requestToken) return
      searchOptions.value = []
    }
  }, 300)
})

async function loadHot(): Promise<void> {
  const token = ++requestToken
  try {
    const hot = await searchHot()
    if (token !== requestToken) return
    searchOptions.value = hot.map((h, index) => ({
      value: h.word,
      key: `h-${index}-${h.word}`,
      index
    }))
  } catch {
    if (token !== requestToken) return
    searchOptions.value = []
  }
}

function handleSearch(value: string): void {
  const q = (value ?? '').trim()
  if (q) void router.push(`/search?q=${encodeURIComponent(q)}`)
}

function goSettings(): void {
  void router.push(routes.settings)
}

function goToLogin(): void {
  void router.push('/login')
}

function onUserMenuClick({ key }: { key: string }): void {
  if (key === 'profile') void router.push('/me')
  else if (key === 'logout') void handleLogout()
}

async function handleLogout(): Promise<void> {
  await router.push('/')
  await authStore.logout()
}

onMounted(async () => {
  isMaximized.value = await isWindowMaximized().catch(() => false)
  unsubMax = onMaximizeChange((v) => {
    isMaximized.value = v
  })
  void loadHot()
})

onUnmounted(() => {
  unsubMax?.()
  unsubMax = null
})

async function handleMinimize(): Promise<void> {
  await minimizeWindow().catch(() => undefined)
}

async function handleToggleMaximize(): Promise<void> {
  await toggleMaximizeWindow().catch(() => undefined)
}

async function handleClose(): Promise<void> {
  await closeWindow().catch(() => undefined)
}
</script>

<template>
  <div class="chrome-bar">
    <div class="chrome-bar__left">
      <div class="chrome-bar__brand" title="有谱">
        <img class="chrome-bar__logo" :src="logoUrl" alt="有谱" draggable="false" />
        <span class="chrome-bar__name">有谱</span>
      </div>
    </div>

    <div class="chrome-bar__center">
      <div class="chrome-search-shell">
        <div class="chrome-bar__back-slot no-drag">
          <button
            v-if="showBack"
            type="button"
            class="chrome-bar__back"
            aria-label="返回上一页"
            title="返回"
            @click="goBack"
          >
            <LeftOutlined />
          </button>
        </div>
        <div class="chrome-search-wrap no-drag">
          <a-auto-complete
            v-model:value="searchKeyword"
            :options="searchOptions"
            :filter-option="false"
            allow-clear
            :default-active-first-option="false"
            class="chrome-search"
            popup-class-name="topbar-search-dropdown"
            placeholder="搜索音乐"
            @select="handleSearch"
            @focus="!searchKeyword.trim() && loadHot()"
            @keydown.enter="handleSearch(searchKeyword)"
          >
            <template #option="{ value, index }">
              <div class="suggest-line">
                <span class="suggest-line__idx" :class="{ 'suggest-line__idx--top': index < 3 }">{{
                  index + 1
                }}</span>
                <span class="suggest-line__text">{{ value }}</span>
              </div>
            </template>
          </a-auto-complete>
          <button
            type="button"
            class="chrome-search__submit"
            aria-label="搜索"
            title="搜索"
            @click="handleSearch(searchKeyword)"
          >
            <SearchOutlined />
          </button>
        </div>
      </div>
    </div>

    <div class="chrome-bar__right">
      <div class="chrome-bar__drag-spacer" aria-hidden="true" />
      <div class="chrome-bar__user no-drag">
        <a-dropdown v-if="authStore.isLoggedIn" :trigger="['click']" placement="bottomRight">
          <a-avatar :src="authStore.avatarUrl || undefined" :size="30" class="chrome-bar__avatar">
            {{ avatarInitial }}
          </a-avatar>
          <template #overlay>
            <a-menu @click="onUserMenuClick">
              <a-menu-item key="profile">
                <UserOutlined />
                <span class="ml-2">个人中心</span>
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item key="logout">
                <LogoutOutlined />
                <span class="ml-2">退出登录</span>
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <a-avatar v-else :size="30" class="chrome-bar__avatar" @click="goToLogin">
          {{ avatarInitial }}
        </a-avatar>
      </div>
      <div class="chrome-bar__win no-drag">
        <button
          type="button"
          class="chrome-win-btn chrome-win-btn--settings"
          aria-label="设置"
          title="设置"
          @click="goSettings"
        >
          <SettingOutlined />
        </button>
        <button type="button" class="chrome-win-btn" aria-label="迷你模式" @click="toggleMini()">
          <CompressOutlined />
        </button>
        <button type="button" class="chrome-win-btn" aria-label="最小化" @click="handleMinimize">
          <MinusOutlined />
        </button>
        <button
          type="button"
          class="chrome-win-btn"
          :aria-label="isMaximized ? '还原' : '最大化'"
          @click="handleToggleMaximize"
        >
          <SwitcherOutlined v-if="isMaximized" />
          <BorderOutlined v-else />
        </button>
        <button
          type="button"
          class="chrome-win-btn chrome-win-btn--close"
          aria-label="关闭"
          @click="handleClose"
        >
          <CloseOutlined />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chrome-bar {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(300px, 520px) minmax(180px, 1fr);
  align-items: center;
  height: 60px;
  padding-left: 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  user-select: none;
  -webkit-app-region: drag;

  &__left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  &__brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  &__logo {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    color: var(--color-primary);
    font-size: 14px;
    font-weight: 800;
    letter-spacing: -0.04em;
  }

  &__name {
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  &__center {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }

  &__back-slot {
    position: absolute;
    top: 50%;
    right: calc(100% + 8px);
    z-index: 1;
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    transform: translateY(-50%);
  }

  &__back {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 0;
    border-radius: 10px;
    background: var(--color-control);
    color: var(--color-text-primary);
    font-size: 12px;
    cursor: pointer;

    &:hover {
      color: var(--color-primary);
    }
  }

  &__right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
    height: 100%;
  }

  &__drag-spacer {
    flex: 1 1 auto;
    min-width: 24px;
    height: 100%;
    -webkit-app-region: drag;
  }

  &__user {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 8px;
  }

  &__avatar {
    cursor: pointer;

    // antd Avatar 对文字内联 font-size:18px,普通选择器压不过,需 !important 覆盖;
    // 30px 头像里 18px 的"游"字视觉偏大,缩到 13px 更协调
    font-size: 13px !important;
  }

  &__win {
    display: flex;
    height: 60px;
    align-items: stretch;
  }
}

.chrome-search-shell {
  position: relative;
  width: min(100%, 480px);
}

.chrome-search-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 480px;
}

.chrome-search {
  width: 100%;

  :deep(.ant-select-selector) {
    display: flex !important;
    align-items: center !important;
    min-height: 36px !important;
    height: 36px !important;
    padding: 0 56px 0 14px !important;
    border: 1px solid transparent !important;
    border-radius: 999px !important;
    background: var(--color-control) !important;
    box-shadow: none !important;
  }

  &:deep(.ant-select-focused .ant-select-selector),
  &:hover :deep(.ant-select-selector) {
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent) !important;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 18%, transparent) !important;
  }

  :deep(.ant-select-selection-search) {
    inset-inline-start: 14px !important;
    inset-inline-end: 56px !important;
  }

  :deep(.ant-select-selection-search),
  :deep(.ant-select-selection-search-input),
  :deep(.ant-select-selection-placeholder),
  :deep(.ant-select-selection-item) {
    border: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    font-size: 13px;
    line-height: 34px !important;
  }

  :deep(.ant-select-selection-placeholder) {
    inset-inline-start: 14px !important;
    inset-inline-end: 56px !important;
    color: var(--color-text-muted);
    opacity: 1;
    line-height: 34px !important;
  }

  :deep(.ant-select-selection-search-input) {
    height: 34px !important;
  }

  :deep(.ant-select-clear) {
    top: 50% !important;
    right: 36px !important;
    inset-inline-end: 36px !important;
    left: auto !important;
    inset-inline-start: auto !important;
    z-index: 2;
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    width: 22px !important;
    height: 22px !important;
    margin: 0 !important;
    padding: 0 !important;
    border-radius: 50%;
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1;
    opacity: 1 !important;
    background: transparent !important;
    transform: translateY(-50%) !important;
  }

  // :deep 内伪类必须写在函数参数里，不能 &:hover 外挂（会变成 :deep(x):hover）
  :deep(.ant-select-clear:hover) {
    color: var(--color-text-primary);
  }

  &__submit {
    position: absolute;
    top: 50%;
    right: 8px;
    z-index: 2;
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transform: translateY(-50%);
    transition: color 0.15s ease;

    &:hover {
      color: var(--color-primary);
    }
  }
}

.chrome-win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background: rgba(128, 128, 128, 0.18);
  }

  &--close:hover {
    background: #e81123;
    color: $color-white;
  }
}

.no-drag {
  -webkit-app-region: no-drag;
}
</style>

<style lang="scss">
$color-hot-rank: #ff5a36;

.topbar-search-dropdown {
  .ant-select-item {
    padding: 6px 10px !important;
  }

  .suggest-line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;

    &__idx {
      width: 18px;
      flex-shrink: 0;
      color: var(--color-text-muted, #6f7a73);
      font-size: 12px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;

      &--top {
        color: $color-hot-rank;
      }
    }

    &__text {
      overflow: hidden;
      color: var(--color-text-primary, #f4f7f5);
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
</style>

<!-- 追加在上方已有 style 块之后：同名类同特异性下按源码序生效，勿调整两个 style 块顺序 -->
<style scoped lang="scss" src="./chrome-bar.scss"></style>
<!-- 搜索下拉包装层与 antd 骨架挂载在 body、无宿主 data-v，需非 scoped 全局引入 -->
<style lang="scss" src="./chrome-bar.global.scss"></style>
