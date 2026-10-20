/**
 * 逐歌主题的**数值设计空间** —— 「底色有多深、文字离底色多远、强调色多艳」。
 *
 * ## 这一层存在的理由
 *
 * `generate.ts` 只负责「按和声方案算出四个色相」，而「这些色相各自该配多少饱和度、
 * 多少明度」是另一件事：它决定的是**观感气质**（近墨的暗底 vs 染得很透的亮底），
 * 与具体某首歌的封面无关。把两者分开，调气质时不会碰到和声逻辑。
 *
 * ## 为什么全是区间而不是定值
 *
 * 每首歌要长得不一样，就得在同一个气质档里有**可控的抖动**：底色在
 * `[0.075, 0.11]` 明度之间取值，50 首歌就是 50 个深浅略有差异的暗底。
 * 抖动来自 `generate.ts` 注入的随机源（以歌曲 id 为种子，见那边的说明）。
 *
 * ## 三个对比度地板
 *
 * 文字色不是「挑一个好看的亮度」就完事 —— 它必须**压过底色**，否则封面越浅、
 * 歌词越看不见。所以每个角色都配一个最低对比度（WCAG 比值），由
 * `color-math.adjustLightnessForContrast` 在保持色相的前提下推到线以上。
 * 正文的地板远高于次级文字：正文是这首歌的画面主体，次级只是补充信息。
 */

export type ThemeMode = 'light' | 'dark'

/** 闭区间 `[min, max]` */
export type Range = readonly [number, number]

/**
 * 底色气质档。三档的区别只在「离中性灰有多远」：
 *  - `ink`    近墨 —— 几乎中性，只带一点封面色的偏移（最安静）；
 *  - `tinted` 染色 —— 能一眼看出底色是哪个色系（最常用）；
 *  - `rich`   浓彩 —— 底色本身就是一块颜色（最强烈）。
 */
export type PaletteTone = 'ink' | 'tinted' | 'rich'

export interface BackgroundTone {
  /** 暗色档的明度区间 */
  darkLightness: Range
  /** 暗色档的饱和度区间 */
  darkSaturation: Range
  /** 亮色档的明度区间 */
  lightLightness: Range
  /** 亮色档的饱和度区间 */
  lightSaturation: Range
}

/**
 * 正文色的对比度地板。**9** 是刻意定得很高的一档：正文是唯一必须无条件可读的
 * 元素（衬线字体在低对比下笔画会糊成一团），宁可把它的色相压得淡一点，
 * 也不能让它在大屏上读起来费劲。
 */
export const PRIMARY_MIN_CONTRAST = 9

/**
 * 强调色的对比度地板。**3.2** 比正文低得多，因为强调色只需「看得出来」：
 * 正在唱的那个字本来就靠动画与辉光提示，颜色只是叠加语义。
 * 地板定得跟正文一样高会把所有强调色推成同一个亮度，逐歌差异反而消失。
 */
export const ACCENT_MIN_CONTRAST = 3.2

/** 次级文字（副字幕 / 空态）的对比度地板：够读，但不抢主体 */
export const SECONDARY_MIN_CONTRAST = 4.5

/**
 * 底色的饱和度下限。**必须大于 0** —— 封面的主色可能几乎无彩（一张灰调封面），
 * 若允许饱和度为 0，几十首灰调封面会全变成同一个中性底，
 * 又回到「每首歌主题色都一样」的老问题上。
 */
export const MIN_BACKGROUND_SATURATION = 0.04

/**
 * 三档气质各自的明度/饱和度区间（暗色档在前，亮色档在后）。
 *
 * ⚠️ **暗色档的明度区间是照着上游的实测值定的，不要「顺手调亮」**。
 * 上游 AI 主题接口给的样例与官网定妆照（`screens/preview-lumi.png`）实测：
 *  - 接口样例 `#101217`（L≈0.076）、`#0f172a`（L≈0.11）；
 *  - 内置默认 `#09090b`（L≈0.037）；
 *  - 定妆照边缘最暗 10% 是 `rgb(7,11,20)`（L≈0.053）。
 *
 * 也就是**上游的深色底几乎都在 L 0.04–0.11 这一段**。第一版把 `rich` 开到 0.14、
 * `tinted` 开到 0.11，实测生成 `#2d2111`（L≈0.12，一块橄榄绿）——
 * 与定妆照那种「近黑、只透一点色相」的观感完全不是一回事，
 * 而且底色一亮，正文与强调色的对比度地板就被推着一起变，整页看着发灰。
 *
 * 饱和度**不跟着压**：上游那几张的 HSL 饱和度是 0.1–0.48，
 * 「低明度 + 中高饱和」正是它「近黑但有色调」的来源（压掉饱和度会变成纯灰黑）。
 */
export const BACKGROUND_TONES: Record<PaletteTone, BackgroundTone> = {
  ink: {
    darkLightness: [0.035, 0.06],
    darkSaturation: [0.1, 0.22],
    lightLightness: [0.94, 0.965],
    lightSaturation: [0.05, 0.12]
  },
  tinted: {
    darkLightness: [0.05, 0.075],
    darkSaturation: [0.2, 0.36],
    lightLightness: [0.92, 0.95],
    lightSaturation: [0.1, 0.2]
  },
  rich: {
    darkLightness: [0.065, 0.095],
    darkSaturation: [0.32, 0.5],
    lightLightness: [0.9, 0.935],
    lightSaturation: [0.18, 0.3]
  }
}

/**
 * 正文色的起点区间。**刻意避开纯黑纯白的两端**：纯 `#ffffff` / `#000000`
 * 是没有色相的，一旦用上，同一首歌的正文就与底色脱钩（看起来像是两个主题拼起来的）。
 * 区间贴着两端但留了一点余量，让底色的色相还能透出来。
 */
export const PRIMARY_RANGES: Record<ThemeMode, { saturation: Range; lightness: Range }> = {
  light: { saturation: [0.15, 0.4], lightness: [0.1, 0.2] },
  dark: { saturation: [0.1, 0.3], lightness: [0.9, 0.96] }
}

/** 强调色的起点区间：明显比正文艳，明度落在中段 */
export const ACCENT_RANGES: Record<ThemeMode, { saturation: Range; lightness: Range }> = {
  light: { saturation: [0.55, 0.88], lightness: [0.38, 0.55] },
  dark: { saturation: [0.55, 0.92], lightness: [0.55, 0.72] }
}

/** 次级文字的起点区间：与正文同色系但更淡，避免页面出现第三种色相 */
export const SECONDARY_RANGES: Record<ThemeMode, { saturation: Range; lightness: Range }> = {
  light: { saturation: [0.15, 0.45], lightness: [0.32, 0.46] },
  dark: { saturation: [0.15, 0.45], lightness: [0.62, 0.76] }
}

/**
 * 封面色「有没有色彩」的判定阈值（HSL 饱和度）。
 * 低于它的色块只配当兜底，不配当主色 —— 它描述的是封面的背景纸面，
 * 不是封面想表达的那个颜色。
 */
export const MIN_SATURATED_COLOR = 0.15

/** 第二色相（和声里的「配角」）与主色相的最小角距：太近就不算第二种颜色 */
export const MIN_SUPPORT_HUE_DISTANCE = 25

/** 第二色相的最大角距：超过它就跑到对面去了，那是互补而不是「同框两色」 */
export const MAX_SUPPORT_HUE_DISTANCE = 160

/**
 * 无彩色封面的饱和度上界。低于它的封面会被判定为「几乎没有颜色」，
 * 此时「单色方案」才是合理的气质（本身就是黑白片子，不该硬染一个色相出来）。
 */
export const MONOCHROME_SATURATION_CEILING = 0.18
