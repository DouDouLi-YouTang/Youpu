import { defineSkin } from '../types'

/**
 * 「浮名」皮肤 —— Folia `fume` 面板的 Vue 重写。
 *
 * `hasSettings: false`：本面板**没有设置**（用户 2026-10-14 拍板）。外观全部固定，
 * 沉浸页右上角不显示设置按钮，根节点也不套用经典那套外观 class / CSS 变量
 * （见 `shared/use-backdrop.ts` 的两档说明）。仍然跟随的沉浸页通用项：
 * 明暗主题、专辑主色、底栏四项、演示模式、歌词偏移。
 *
 * ⚠️ 当前进度：F3（只有背景）。文章排版 / 相机 / 逐字打印在 F4 及之后接入，
 * 见 `docs/fume-porting-notes.md` §19 的实施顺序。
 */
export default defineSkin({
  id: 'fume',
  name: '浮名',
  desc: '逐字打印的歌词长文，镜头跟着笔尖走',
  order: 3,
  hasSettings: false,
  component: () => import('./SkinFume.vue')
})
