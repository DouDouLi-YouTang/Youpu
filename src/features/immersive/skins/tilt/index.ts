import { defineSkin } from '../types'

/**
 * 「倾诉」(tilt) 皮肤 —— Folia 式全屏歌词面板：一行切成 1–4 段，
 * 其中一段用斜体 + 上下交错 + 专辑主色呈现，逐字脉冲带余晖。
 * 布局算法与 Folia 源码无关（独立重写），思路来源见 docs/tilt-porting-notes.md。
 */
export default defineSkin({
  id: 'tilt',
  name: '倾诉',
  desc: 'Folia 式全屏歌词：分段错落，斜体段用专辑配色',
  order: 1,
  hasSettings: true,
  settingsKind: 'folia',
  component: () => import('./SkinTilt.vue')
})
