import { defineSkin } from '../types'

/**
 * 「倾诉」(tilt) 皮肤 —— C1 阶段只注册占位组件（见 SkinTilt.vue 文件头注释）。
 * 真实排版算法（分行 / 倾斜选行 / 逐字动画）在 C3 实现，替换 component 指向的组件即可，
 * 注册表与两个切换入口无需改动。
 */
export default defineSkin({
  id: 'tilt',
  name: '倾诉',
  desc: 'Folia 风格的分行歌词，随节奏呼吸（敬请期待）',
  order: 1,
  component: () => import('./SkinTilt.vue')
})
