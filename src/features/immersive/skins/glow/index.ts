import { defineSkin } from '../types'

/**
 * 「流光」皮肤 —— Folia `classic` 面板的 Vue 重写。
 *
 * 设置入口使用 Folia 共享页签，根节点不套用经典那套外观 class / CSS 变量。
 */
export default defineSkin({
  id: 'glow',
  name: '流光',
  desc: '散落的词逐个亮起，唱完慢慢转开',
  order: 2,
  hasSettings: true,
  settingsKind: 'folia',
  component: () => import('./SkinGlow.vue')
})
