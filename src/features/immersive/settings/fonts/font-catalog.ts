/** 字体选择器与预设的纯数据目录，经典字体页与 Folia 字体页共用。 */

export interface FontPreset {
  readonly name: string
  readonly fonts: readonly string[]
  readonly url: string
}

export interface FontOption {
  label: string
  value: string
}

/**
 * 下拉只列常用字体（白名单 ∩ 已装），避免系统几百个符号 / 装饰字体淹没选择。
 * 用户仍可通过 `mode="tags"` 手动输入白名单外的字体。
 */
export const COMMON_FONTS = [
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  '微软雅黑',
  'Microsoft JhengHei UI',
  'Microsoft JhengHei',
  '微软正黑',
  'SimSun',
  'NSimSun',
  '宋体',
  'SimHei',
  '黑体',
  'KaiTi',
  '楷体',
  'FangSong',
  '仿宋',
  'DengXian',
  '等线',
  'Segoe UI Variable',
  'Segoe UI',
  'Arial',
  'Arial Black',
  'Calibri',
  'Calibri Light',
  'Cambria',
  'Candara',
  'Corbel',
  'Constantia',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Source Han Sans SC',
  'Source Han Sans CN',
  '思源黑体',
  'Source Han Serif SC',
  'Source Han Serif CN',
  '思源宋体',
  'MiSans Medium',
  'MiSans',
  'PingFang SC',
  '苹方 常规'
] as const

/** 已装则应用，未装则下载（对齐参考 font-settings.js 的 FontPreset）。 */
export const FONT_PRESETS = [
  {
    name: 'MiSans',
    fonts: ['MiSans Medium', 'MiSans'],
    url: 'https://cdn.cnbj1.fds.api.mi-img.com/vipmlmodel/font/MiSans/MiSans.zip'
  },
  {
    name: '思源黑体',
    fonts: [
      'Source Han Sans SC VF',
      'Source Han Sans CN',
      'Noto Sans',
      '思源黑体',
      'Source Han Sans VF',
      'Source Han Sans'
    ],
    url: 'https://github.com/adobe-fonts/source-han-sans/raw/release/Variable/OTF/SourceHanSansSC-VF.otf'
  },
  {
    name: '思源宋体',
    fonts: [
      'Source Han Serif SC VF',
      'Source Han Serif CN',
      'Noto Serif',
      '思源宋体',
      'Source Han Serif VF',
      'Source Han Serif'
    ],
    url: 'https://github.com/adobe-fonts/source-han-serif/raw/release/Variable/OTF/SourceHanSerifSC-VF.otf'
  },
  {
    name: '苹方',
    fonts: ['PingFang SC', '苹方 常规'],
    url: 'https://github.com/ShmilyHTT/PingFang/archive/refs/heads/master.zip'
  },
  { name: '微软雅黑', fonts: ['Microsoft YaHei UI', 'Microsoft YaHei'], url: '' },
  { name: '微软正黑', fonts: ['Microsoft JhengHei UI', 'Microsoft JhengHei'], url: '' }
] as const satisfies readonly FontPreset[]

/** 过滤出「常用字体白名单 ∩ 已安装字体」。 */
export function commonFontOptions(installed: readonly string[]): FontOption[] {
  const installedSet = new Set(installed)
  return COMMON_FONTS.filter((font) => installedSet.has(font)).map((font) => ({
    label: font,
    value: font
  }))
}

/** 预设里任意一个字体已安装即视为可用。 */
export function hasPresetFont(preset: FontPreset, installed: readonly string[]): boolean {
  const installedSet = new Set(installed)
  return preset.fonts.some((font) => installedSet.has(font))
}
