import { defineSkin } from '../types'

/**
 * 「浮名」皮肤 —— Folia `fume` 面板的 Vue 重写。
 *
 * 设置入口使用 Folia 共享页签，根节点不套用经典那套外观 class / CSS 变量。
 *
 * ⚠️ 当前进度：F3（只有背景）。文章排版 / 相机 / 逐字打印在 F4 及之后接入，
 * 见 `docs/fume-porting-notes.md` §19 的实施顺序。
 */
export default defineSkin({
  id: 'fume',
  name: '浮名',
  desc: '逐字打印的歌词长文，镜头跟着笔尖走',
  order: 3,
  hasSettings: true,
  settingsKind: 'folia',
  component: () => import('./SkinFume.vue')
})
