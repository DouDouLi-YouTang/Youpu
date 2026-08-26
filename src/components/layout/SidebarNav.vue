<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import DownloadProgressRing from '@/components/download/DownloadProgressRing.vue'
import { resolvedThemeMode } from '@/app/providers/theme-provider'
import { useAuthStore } from '@/stores/auth.store'
import { useDownloadStore } from '@/stores/download.store'
import { useLibraryStore } from '@/stores/library.store'

interface NavItem {
  key: string
  label: string
  to: string
}

const router = useRouter()
const route = useRoute()
const downloadStore = useDownloadStore()
const libraryStore = useLibraryStore()
const authStore = useAuthStore()

// 顶级菜单项(不含"我的音乐",它用 a-sub-menu 单独渲染以承载二级歌单)
const primaryNav: NavItem[] = [
  { key: 'discover', label: '发现', to: '/' },
  { key: 'rank', label: '排行榜', to: '/rank' },
  { key: 'history', label: '最近播放', to: '/history' },
  { key: 'downloads', label: '下载', to: '/downloads' }
]

const isLoggedIn = computed(() => authStore.isLoggedIn)
const createdPlaylists = computed(() => libraryStore.createdPlaylists)
// "我的音乐"标题是否高亮(在 /library 全部歌单页时高亮)
const isLibraryActive = computed(() => route.path === '/library')

// 选中项:歌单详情页子项 pl-<id>
const selectedKeys = computed<string[]>(() => {
  const path = route.path
  const plMatch = path.match(/^\/playlist\/(\d+)/)
  if (plMatch) return [`pl-${plMatch[1]}`]
  const exact = primaryNav.find((item) => item.to === path)
  if (exact) return [exact.key]
  if (path === '/') return ['discover']
  return []
})

// 点击"我的音乐"标题:导航到全部歌单页(子菜单的展开/折叠由 a-sub-menu 自行处理)
function goLibrary(): void {
  if (route.path !== '/library') void router.push('/library')
}

// 子菜单展开状态:用户可自由折叠/展开,不跟随路由自动展开。
const openKeys = ref<string[]>([])
function onOpenChange(keys: string[]): void {
  openKeys.value = keys
}

function handleMenuClick({ key }: { key: string }): void {
  if (key.startsWith('pl-')) {
    const id = Number(key.slice(3))
    if (Number.isFinite(id) && id > 0) void router.push(`/playlist/${id}`)
    return
  }
  const item = primaryNav.find((n) => n.key === key)
  if (item) void router.push(item.to)
}

// 登录态变化时加载/清空歌单(供"我的音乐"二级菜单展示创建的歌单)
watch(
  () => authStore.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) void libraryStore.loadMyPlaylists()
    else libraryStore.clear()
  },
  { immediate: true }
)

onMounted(() => {
  void downloadStore.init()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col px-3 py-4">
    <nav class="min-h-0 flex-1 overflow-y-auto" aria-label="主导航">
      <a-menu
        mode="inline"
        :theme="resolvedThemeMode"
        :selected-keys="selectedKeys"
        :open-keys="openKeys"
        class="!border-e-0 !bg-transparent"
        @click="handleMenuClick"
        @open-change="onOpenChange"
      >
        <a-menu-item key="discover">
          <span>发现</span>
        </a-menu-item>
        <a-menu-item key="rank">
          <span>排行榜</span>
        </a-menu-item>

        <!-- 我的音乐:二级菜单列出账号创建的歌单,"全部歌单"进入总览页 -->
        <a-sub-menu
          key="library"
          :class="isLibraryActive ? 'nav-submenu-active' : ''"
          @title-click="goLibrary"
        >
          <template #title><span>我的音乐</span></template>
          <a-menu-item v-for="pl in createdPlaylists" :key="`pl-${pl.id}`">
            <span class="flex min-w-0 items-center gap-2">
              <img
                v-if="pl.coverUrl"
                :src="pl.coverUrl"
                :alt="pl.name"
                class="h-5 w-5 shrink-0 rounded object-cover"
                referrerpolicy="no-referrer"
                loading="lazy"
              />
              <span
                v-else
                class="grid h-5 w-5 shrink-0 place-items-center rounded bg-[var(--color-control)] text-[10px] text-text-secondary"
                >无</span
              >
              <span class="truncate" :title="pl.name">{{ pl.name }}</span>
            </span>
          </a-menu-item>
          <a-menu-item v-if="!isLoggedIn" key="library-empty" disabled>
            <span class="text-text-secondary">登录后显示创建的歌单</span>
          </a-menu-item>
        </a-sub-menu>

        <a-menu-item key="history">
          <span>最近播放</span>
        </a-menu-item>

        <a-menu-item key="downloads">
          <span class="flex items-center justify-between gap-2">
            <span>下载</span>
            <!-- 正在下载:数量外套进度圆环,圆环=整体下载进度 -->
            <DownloadProgressRing
              v-if="downloadStore.activeCount > 0"
              :percent="downloadStore.overallProgress"
              :count="downloadStore.activeCount"
            />
            <!-- 无下载任务但有失败:低调红色提示,详情进下载页查看 -->
            <a-badge
              v-else-if="downloadStore.failedCount > 0"
              count="!"
              :number-style="{ backgroundColor: '#ef4444' }"
            />
          </span>
        </a-menu-item>
      </a-menu>
    </nav>
  </div>
</template>

<style scoped lang="scss">
// 侧栏 ant-menu 定制：选中/hover 过渡 + 二级菜单去底色 + 父级标题高亮
// 注意：:deep(...) 是函数式伪元素，不能做 & 后缀拼接，保持扁平 :deep 写法。
$nav-transition: 0.2s ease;

// 菜单项选中/hover 背景色与文字色过渡
:deep(.ant-menu-item) {
  transition:
    background-color $nav-transition,
    color $nav-transition;
}

// 二级菜单去掉 ant 默认的浅灰背景,与一级菜单融为一体
:deep(.ant-menu-inline.ant-menu-sub) {
  background: transparent !important;
}

// /library 全部歌单页时"我的音乐"标题高亮(子菜单标题非 a-menu-item,selectedKeys 管不到,需手动)
:deep(.nav-submenu-active > .ant-menu-submenu-title) {
  color: var(--color-primary) !important;
}
</style>
