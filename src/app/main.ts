import { createApp } from 'vue'

import App from './App.vue'
import { pinia } from './pinia'
import { initPlayerProvider } from './providers/player-provider'
import { installThemeProvider } from './providers/theme-provider'
import { router } from './router'
import { usePlayerStore } from '@/stores/player.store'
import { useAuthStore } from '@/stores/auth.store'
import {
  applyLowMemoryRestore,
  useLowMemoryRestore
} from '@/features/player/use-low-memory-restore'
import { initLa51Analytics } from '@/services/la51-analytics'
import '@/assets/styles/tokens.scss'
import '@/assets/styles/tailwind.css'
import '@/assets/styles/index.scss'
// 0.1.21 打包产物整包 CSS（已剥离 data-v-*），强制 BEM/组件视觉与昨天安装包一致

installThemeProvider()
initPlayerProvider()
initLa51Analytics()

const app = createApp(App)
app.use(pinia)
// 低内存模式:登记“重建而非冷启动”,开启播放状态快照持续写入(主进程回收
// 本渲染进程时据此建立降级切歌会话)。必须在 player.init() 之前跑。
useLowMemoryRestore()
// Initialize the player store's audio controller now that pinia + provider are
// ready. Done imperatively (rather than lazily) so playback state is available
// as soon as the app mounts.
usePlayerStore().init()
// 与音频引擎对齐:主进程清除降级会话,若引擎在播/暂停在有曲目则恢复队列与
// 曲目到 store(纯 UI 对齐,不 load 音频 —— 播放从未中断)。
void applyLowMemoryRestore()
// Verify the persisted auth cookie (if any) and settle login state. Runs
// concurrently with mount — the router guard reads `isLoggedIn` reactively, so
// a still-pending check (`loginState === 'unknown'`) is treated as logged-out
// until init resolves. Not awaited so the UI paints immediately.
void useAuthStore().init()
app.use(router).mount('#app')
