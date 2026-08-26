import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { routes } from '@/constants/routes'
import { useAuthStore } from '@/stores/auth.store'

const routeRecords: RouteRecordRaw[] = [
  {
    path: routes.discover,
    name: 'discover',
    component: () => import('@/pages/discover/DiscoverPage.vue')
  },
  { path: routes.login, name: 'login', component: () => import('@/pages/login/LoginPage.vue') },
  { path: routes.search, name: 'search', component: () => import('@/pages/search/SearchPage.vue') },
  {
    path: routes.library,
    name: 'library',
    component: () => import('@/pages/library/LibraryPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: routes.daily,
    name: 'daily',
    component: () => import('@/pages/daily/DailyPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: routes.downloads,
    name: 'downloads',
    component: () => import('@/pages/downloads/DownloadsPage.vue')
  },
  {
    path: routes.history,
    name: 'history',
    component: () => import('@/pages/history/HistoryPage.vue')
  },
  {
    path: routes.settings,
    name: 'settings',
    component: () => import('@/pages/settings/SettingsPage.vue')
  },
  {
    path: routes.playlist,
    name: 'playlist',
    component: () => import('@/pages/playlist/PlaylistPage.vue')
  },
  { path: routes.album, name: 'album', component: () => import('@/pages/album/AlbumPage.vue') },
  { path: routes.artist, name: 'artist', component: () => import('@/pages/artist/ArtistPage.vue') },
  { path: routes.rank, name: 'rank', component: () => import('@/pages/rank/RankPage.vue') },
  { path: routes.song, name: 'song', component: () => import('@/pages/song/SongPage.vue') },
  {
    path: routes.user,
    name: 'user',
    component: () => import('@/pages/user/UserPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: routes.personalCenter,
    name: 'personal-center',
    component: () => import('@/pages/personal-center/PersonalCenterPage.vue'),
    meta: { requiresAuth: true }
  },
  // 兜底:未匹配的路由重定向到发现页,避免 app 打开时右侧空白
  // (dev hot reload 保留旧路径 / 打包 file:// 下 createWebHistory 取到文件路径时触发)
  { path: '/:pathMatch(.*)*', redirect: routes.discover }
]

export const router = createRouter({
  history: createWebHistory(),
  routes: routeRecords
})

/**
 * Global navigation guard.
 *
 * - Routes flagged `meta.requiresAuth` redirect logged-out users to `/login`
 *   with a `redirect` query param so the login page can bounce them back.
 * - Already-logged-in users hitting `/login` are bounced to discover (no point
 *   re-scanning a QR you already have).
 *
 * The guard only reads `authStore.isLoggedIn` - it makes no network calls, so
 * it never blocks navigation on a slow server. Boot-time cookie verification is
 * handled by `authStore.init()` in `main.ts`, not here.
 */
router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return {
      path: routes.login,
      query: { redirect: to.fullPath }
    }
  }

  if (to.path === routes.login && auth.isLoggedIn) {
    return { path: routes.discover }
  }

  return true
})
