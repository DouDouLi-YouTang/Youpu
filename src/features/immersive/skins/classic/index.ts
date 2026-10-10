import { defineSkin } from '../types'

/** 「经典」皮肤 —— 改造前的沉浸页布局原样搬入（左封面 / 右滚动歌词），行为与改造前等价。 */
export default defineSkin({
  id: 'classic',
  name: '经典',
  desc: '左封面右歌词，界面与改造前一致',
  order: 0,
  component: () => import('./SkinClassic.vue')
})
