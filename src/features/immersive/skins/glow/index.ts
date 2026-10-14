import { defineSkin } from '../types'

/**
 * 「流光」皮肤 —— Folia `classic` 面板的 Vue 重写。
 *
 * `hasSettings: false`：本面板**没有设置**（用户 2026-08-14 拍板）。外观全部固定，
 * 沉浸页右上角不显示设置按钮，根节点也不套用经典那套外观 class / CSS 变量
 * （见 `shared/use-backdrop.ts` 的两档说明）。仍然跟随的沉浸页通用项：
 * 明暗主题、专辑主色、底栏四项、演示模式、歌词偏移。
 */
export default defineSkin({
  id: 'glow',
  name: '流光',
  desc: '散落的词逐个亮起，唱完慢慢转开',
  order: 2,
  hasSettings: false,
  component: () => import('./SkinGlow.vue')
})
