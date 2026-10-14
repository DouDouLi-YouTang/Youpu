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
  /**
   * 倾诉**没有设置**：外观全部固定 —— 背景恒为「几何」且不可改、永不显示封面、
   * 歌词排版与字体用内置值。所以沉浸页右上角不出现设置按钮，根节点也不套用
   * 经典那套外观 class / CSS 变量（见 shared/use-backdrop.ts）。
   * 沉浸页通用项（明暗 / 主色 / 底栏 / 演示模式 / 歌词偏移）两边都生效。
   */
  hasSettings: false,
  component: () => import('./SkinTilt.vue')
})
