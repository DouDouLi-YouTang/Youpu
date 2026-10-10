import { createApp } from 'vue'

import App from './App.vue'
import { pinia } from './pinia'
import { initPlayerProvider } from './providers/player-provider'
import { installThemeProvider } from './providers/theme-provider'
import { router } from './router'
import { usePlayerStore } from '@/stores/player.store'
import { useAuthStore } from '@/stores/auth.store'
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
// Initialize the player store's audio controller now that pinia + provider are
// ready. Done imperatively (rather than lazily) so playback state is available
// as soon as the app mounts.
usePlayerStore().init()
// Verify the persisted auth cookie (if any) and settle login state. Runs
// concurrently with mount — the router guard reads `isLoggedIn` reactively, so
// a still-pending check (`loginState === 'unknown'`) is treated as logged-out
// until init resolves. Not awaited so the UI paints immediately.
void useAuthStore().init()
app.use(router).mount('#app')
