<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CloseOutlined } from '@ant-design/icons-vue'

import { downloadFont, querySystemFonts } from '@/platform/electron/font'
import {
  type AccentColorVariant,
  type BackgroundType,
  type ColorScheme,
  type ContributorDisplay,
  type CoverHAlign,
  type CoverVAlign,
  type DisplayMode,
  type ImmersiveSettings,
  type KaraokeAnimation,
  type LyricAlignmentPct,
  type LyricTiming,
  type SongInfoAlign,
  useImmersiveSettingsStore
} from '@/features/immersive/immersive-settings.store'

/**
 * 沉浸层设置面板 —— 8 个 tab 严格对齐参考项目 settings-menu.html：
 * 外观 / 封面 / 背景 / 歌词 / 字体 / 杂项 / 实验 / 关于。
 * 从右侧滑入，所有控件双向绑定 immersive-settings store，即时生效
 * （store 变更驱动 ImmersivePlayer 的 rootClasses / rootStyleVars 重算）。
 *
 * reset 按钮把单项还原到参考项目 default 值（DEFAULTS 取自 settings-menu.html 的 default 属性）。
 */

const settings = useImmersiveSettingsStore()

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

function close(): void {
  emit('update:visible', false)
}

/** 各 slider 的默认值，供 reset 按钮还原（取自 settings-menu.html 的 default 属性） */
const DEFAULTS = {
  albumSize: 400,
  bgBlur: 90,
  bgDim: 55,
  bgDimForGradientBg: 45,
  bgDimForFluidBg: 30,
  bgBlurForNoneBgMask: 0,
  bgDimForNoneBgMask: 0,
  lyricFontWeight: 700,
  lyricFontSize: 32,
  lyricRomajiSizeEm: 0.6,
  lyricTranslationSizeEm: 1,
  rotateCurvature: 25,
  lyricOffset: 0,
  fluidMaxFramerate: 4,
  fluidBlur: 6
} as const

/** a-slider 的 @change 收 number | number[]，统一收成 number */
function num(v: number | number[]): number {
  return Array.isArray(v) ? v[0] : v
}

/**
 * 通用 slider 写回：a-slider 的 @change 透传 $event（number | number[]），统一收成
 * number 后 $patch 到 store。用 $patch 绕开 Pinia store 索引赋值的类型摩擦，同时统一
 * 处理联合类型字段（albumSize / fluidMaxFramerate 等字面量联合）。
 *
 * 注意：必须用非柯里化签名并在模板里 @change="setField('X', $event)" 显式传 $event。
 * 早期版本用柯里化 `setField('X')` 返回内层 handler，但 @vue/compiler-sfc 会把
 * `@change="setField('X')"` 编译为 `$event => setField('X')`——返回的内层 handler 被
 * 丢弃、$event 从未传入，导致全部 slider 拖动后不写回 store。
 */
function setField(field: keyof ImmersiveSettings, v: number | number[]): void {
  settings.$patch({ [field]: num(v) } as Partial<ImmersiveSettings>)
}

/** reset 按钮：把指定字段还原到 DEFAULTS（仅 slider 字段有 reset） */
function resetField<K extends keyof typeof DEFAULTS>(field: K): void {
  settings.$patch({ [field]: DEFAULTS[field] } as Partial<ImmersiveSettings>)
}
/** 字段是否偏离默认值(对齐参考 .rnp-slider-wrapper.changed:仅改动后才显示 reset 圆点) */
function isChanged(field: keyof typeof DEFAULTS): boolean {
  return (settings[field] as number) !== DEFAULTS[field]
}

// ── 字体:系统字体查询 + 多选回退链 + 6 预设(对齐参考 font-settings.js)──
const fontList = ref<string[]>([])
onMounted(async () => {
  fontList.value = await querySystemFonts()
})
// 下拉只列常用字体(白名单 ∩ 已装),避免系统几百个符号/装饰字体淹没选择。
// fontList 仍保留全集供 hasFont 判断预设是否已装;用户仍可手动输入白名单外字体(mode="tags")。
const COMMON_FONTS = [
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
]
const fontOptions = computed(() => {
  const installed = new Set(fontList.value)
  return COMMON_FONTS.filter((f) => installed.has(f)).map((f) => ({ label: f, value: f }))
})

/** 6 个字体预设(对齐参考 font-settings.js FontPreset):已装则"应用",未装则"下载" */
const FONT_PRESETS = [
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
] as const

function hasFont(preset: (typeof FONT_PRESETS)[number]): boolean {
  return preset.fonts.some((f) => fontList.value.includes(f))
}
function applyPreset(preset: (typeof FONT_PRESETS)[number]): void {
  settings.customFontFamily = [...preset.fonts]
}

/**
 * 歌词全局偏移 ±100ms 步进(对齐参考 settings-menu.html:235-250 的 -/+ 按钮 +
 * main.js:554-579)。正 offset = 歌词提前显示(lyricDisplayTimeMs = currentTime + offset,
 * offset 正则歌词时钟快于音频)。
 */
function stepLyricOffset(delta: number): void {
  settings.lyricOffset = Math.max(-10000, Math.min(10000, settings.lyricOffset + delta))
}
/** 偏移状态提示文案(对齐参考:未设置 / 歌词提前 / 歌词滞后) */
const lyricOffsetTip = computed(() => {
  const v = settings.lyricOffset
  if (v === 0) return '未设置'
  return v > 0 ? '歌词提前' : '歌词滞后'
})

// ── tab 定义（顺序与文案对齐参考项目 settings-menu.html） ──
const TABS = [
  { key: 'appearance', label: '外观' },
  { key: 'cover', label: '封面' },
  { key: 'background', label: '背景' },
  { key: 'lyric', label: '歌词' },
  { key: 'font', label: '字体' },
  { key: 'about', label: '关于' }
] as const
type TabKey = (typeof TABS)[number]['key']
const activeTab = ref<TabKey>('appearance')

// ── 选项组（label/value 对齐参考 settings-menu.html 的 select-group） ──
const displayModeOptions = [
  { label: '全部', value: 'all' as DisplayMode },
  { label: '仅歌词', value: 'lyric-only' as DisplayMode },
  { label: '仅封面', value: 'cover-only' as DisplayMode }
]
const colorSchemeOptions = [
  { label: '暗色', value: 'dark' as ColorScheme },
  { label: '亮色', value: 'light' as ColorScheme },
  { label: '系统', value: 'auto' as ColorScheme }
]
const accentColorOptions = [
  { label: '关', value: 'off' as AccentColorVariant },
  { label: '鲜艳', value: 'primary' as AccentColorVariant },
  { label: '柔和', value: 'secondary' as AccentColorVariant },
  { label: '偏色', value: 'tertiary' as AccentColorVariant }
]
const coverHAlignOptions = [
  { label: '居左', value: 'left' as CoverHAlign },
  { label: '居中', value: 'center' as CoverHAlign }
]
const coverVAlignOptions = [
  { label: '居下', value: 'bottom' as CoverVAlign },
  { label: '居中', value: 'middle' as CoverVAlign }
]
// 歌曲信息文字对齐:本应用新增(参考项目无),独立于封面块水平对齐
const songInfoAlignOptions = [
  { label: '居左', value: 'left' as SongInfoAlign },
  { label: '居中', value: 'center' as SongInfoAlign }
]
const backgroundTypeOptions = [
  { label: '流体', value: 'fluid' as BackgroundType },
  { label: '模糊', value: 'blur' as BackgroundType },
  { label: '渐变', value: 'gradient' as BackgroundType },
  { label: '纯色', value: 'solid' as BackgroundType },
  { label: '无', value: 'none' as BackgroundType }
]
const karaokeOptions = [
  { label: '上浮', value: 'float' as KaraokeAnimation },
  { label: '滑动', value: 'slide' as KaraokeAnimation }
]
const alignmentPctOptions = [
  { label: '居上', value: 30 as LyricAlignmentPct },
  { label: '居中', value: 50 as LyricAlignmentPct }
]
const timingOptions = [
  { label: '平滑', value: 'smooth' as LyricTiming },
  { label: '急促', value: 'sharp' as LyricTiming },
  { label: '温和', value: 'lazy' as LyricTiming },
  { label: '缓出', value: 'easeout' as LyricTiming }
]
const contributorsOptions = [
  { label: '总是', value: 'show' as ContributorDisplay },
  { label: '鼠标移上', value: 'hover' as ContributorDisplay },
  { label: '隐藏', value: 'hide' as ContributorDisplay }
]
const fluidFramerateMarks: Record<number, string> = { 0: '5', 1: '10', 2: '30', 3: '60', 4: '∞' }
const fluidBlurMarks: Record<number, string> = { 5: '32', 6: '64', 7: '128' }
const albumSizeMarks: Record<number, string> = { 200: '200', 400: '400', 600: '600', 800: '800' }

const lyricOffsetLabel = (v: number | number[]): string => `${(num(v) / 1000).toFixed(1)}s`

// ── 条件显隐（逐条对齐参考 settings-menu.scss:358-383 的 opacity/height 折叠规则）──
// 参考项目把不适用的设置行折叠隐藏，避免用户在无效上下文勾选导致「开了没效果」的困惑。
const isLyricOnly = computed(() => settings.displayMode === 'lyric-only')
const isFluid = computed(() => settings.backgroundType === 'fluid')
const isBlur = computed(() => settings.backgroundType === 'blur')
const isGradient = computed(() => settings.backgroundType === 'gradient')
const isNoneBg = computed(() => settings.backgroundType === 'none')
const isRotate = computed(() => settings.lyricRotate)
</script>

<template>
  <Transition name="settings-slide">
    <aside v-if="visible" class="immersive-settings">
      <!-- 关闭按钮(浮动右上角,对齐参考无标题栏的精简布局) -->
      <button type="button" class="settings-close" aria-label="关闭设置" @click="close">
        <CloseOutlined />
      </button>

      <!-- 纵向 tab 列(对齐参考 .rnp-settings-menu-tabs) -->
      <nav class="settings-tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          class="settings-tab"
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>

      <!-- 内容区 -->
      <div class="settings-body">
        <!-- 外观 -->
        <section v-show="activeTab === 'appearance'" class="settings-section">
          <div class="settings-group-title">外观</div>
          <div class="setting-row">
            <label>显示</label>
            <a-segmented v-model:value="settings.displayMode" :options="displayModeOptions" block />
          </div>
          <div v-show="isLyricOnly" class="setting-row">
            <a-checkbox v-model:checked="settings.centerLyric">歌词居中</a-checkbox>
            <span class="setting-note">仅在「仅歌词」模式下生效</span>
          </div>
          <div v-show="isLyricOnly" class="setting-row">
            <a-checkbox v-model:checked="settings.autoHideMiniSongInfo">
              自动隐藏迷你歌曲信息
            </a-checkbox>
          </div>
          <div class="setting-row">
            <label>颜色模式</label>
            <a-segmented v-model:value="settings.colorScheme" :options="colorSchemeOptions" block />
          </div>
          <div class="setting-row">
            <label>沉浸主题色</label>
            <a-segmented
              v-model:value="settings.accentColorVariant"
              :options="accentColorOptions"
              block
            />
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.textShadow">文字阴影</a-checkbox>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.textGlow">文字辉光</a-checkbox>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.alwaysShowBottomBar">不自动隐藏底栏</a-checkbox>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.bottomProgressbar">进度条贴底</a-checkbox>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.enableProgressbarPreview">
              进度条悬停预览
            </a-checkbox>
            <span class="setting-note">鼠标悬停在进度条上时显示对应歌词</span>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.presentationMode">演示模式</a-checkbox>
            <span class="setting-note">隐藏一切多余元素</span>
          </div>
        </section>

        <!-- 封面 -->
        <section v-show="activeTab === 'cover'" class="settings-section">
          <div class="settings-group-title">封面</div>
          <div class="setting-row">
            <label>封面水平对齐</label>
            <a-segmented v-model:value="settings.coverHAlign" :options="coverHAlignOptions" block />
          </div>
          <div class="setting-row">
            <label>封面垂直对齐</label>
            <a-segmented v-model:value="settings.coverVAlign" :options="coverVAlignOptions" block />
          </div>
          <div class="setting-row">
            <label>歌曲信息对齐</label>
            <a-segmented
              v-model:value="settings.songInfoAlign"
              :options="songInfoAlignOptions"
              block
            />
            <span class="setting-note">歌名/歌手/专辑文字本身的水平对齐</span>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.rectangleCover">方形专辑封面</a-checkbox>
          </div>
          <div class="setting-row">
            <label class="setting-label-with-reset">
              <span>专辑封面清晰度</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('albumSize') }"
                @click="resetField('albumSize')"
              ></button>
            </label>
            <a-slider
              :value="settings.albumSize"
              :min="200"
              :max="800"
              :step="200"
              :marks="albumSizeMarks"
              @change="setField('albumSize', $event)"
            />
            <span class="setting-note">可能带来更慢的加载速度</span>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.coverBlurryShadow">封面弥散阴影</a-checkbox>
          </div>
        </section>

        <!-- 背景 -->
        <section v-show="activeTab === 'background'" class="settings-section">
          <div class="settings-group-title">背景</div>
          <div class="setting-row">
            <label>类型</label>
            <a-segmented
              v-model:value="settings.backgroundType"
              :options="backgroundTypeOptions"
              block
            />
          </div>
          <div v-show="isFluid" class="setting-row">
            <a-checkbox v-model:checked="settings.staticFluid">静态流体</a-checkbox>
            <span class="setting-note">减少流体背景的性能开销</span>
          </div>
          <div v-show="isFluid" class="setting-row">
            <label class="setting-label-with-reset">
              <span>流体帧率上限</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('fluidMaxFramerate') }"
                @click="resetField('fluidMaxFramerate')"
              ></button>
            </label>
            <a-slider
              :value="settings.fluidMaxFramerate"
              :min="0"
              :max="4"
              :step="1"
              :marks="fluidFramerateMarks"
              @change="setField('fluidMaxFramerate', $event)"
            />
            <span class="setting-note">仅在动态流体开启时生效</span>
          </div>
          <div v-show="isFluid" class="setting-row">
            <label class="setting-label-with-reset">
              <span>流体模糊度</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('fluidBlur') }"
                @click="resetField('fluidBlur')"
              ></button>
            </label>
            <a-slider
              :value="settings.fluidBlur"
              :min="5"
              :max="7"
              :step="1"
              :marks="fluidBlurMarks"
              @change="setField('fluidBlur', $event)"
            />
            <span class="setting-note">仅在流体开启时生效</span>
          </div>
          <div v-show="isGradient" class="setting-row">
            <a-checkbox v-model:checked="settings.gradientBgDynamic">动态渐变</a-checkbox>
          </div>
          <div v-show="isBlur" class="setting-row">
            <label class="setting-label-with-reset">
              <span>模糊</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('bgBlur') }"
                @click="resetField('bgBlur')"
              ></button>
            </label>
            <a-slider
              :value="settings.bgBlur"
              :min="0"
              :max="128"
              @change="setField('bgBlur', $event)"
            />
          </div>
          <div v-show="isBlur" class="setting-row">
            <label class="setting-label-with-reset">
              <span>暗化</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('bgDim') }"
                @click="resetField('bgDim')"
              ></button>
            </label>
            <a-slider
              :value="settings.bgDim"
              :min="0"
              :max="100"
              @change="setField('bgDim', $event)"
            />
          </div>
          <div v-show="isGradient" class="setting-row">
            <label class="setting-label-with-reset">
              <span>暗化（渐变背景）</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('bgDimForGradientBg') }"
                @click="resetField('bgDimForGradientBg')"
              ></button>
            </label>
            <a-slider
              :value="settings.bgDimForGradientBg"
              :min="0"
              :max="100"
              @change="setField('bgDimForGradientBg', $event)"
            />
          </div>
          <div v-show="isFluid" class="setting-row">
            <label class="setting-label-with-reset">
              <span>暗化（流体背景）</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('bgDimForFluidBg') }"
                @click="resetField('bgDimForFluidBg')"
              ></button>
            </label>
            <a-slider
              :value="settings.bgDimForFluidBg"
              :min="0"
              :max="90"
              @change="setField('bgDimForFluidBg', $event)"
            />
          </div>
          <div v-show="isNoneBg" class="setting-row">
            <label class="setting-label-with-reset">
              <span>遮罩模糊（无背景）</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('bgBlurForNoneBgMask') }"
                @click="resetField('bgBlurForNoneBgMask')"
              ></button>
            </label>
            <a-slider
              :value="settings.bgBlurForNoneBgMask"
              :min="0"
              :max="100"
              @change="setField('bgBlurForNoneBgMask', $event)"
            />
          </div>
          <div v-show="isNoneBg" class="setting-row">
            <label class="setting-label-with-reset">
              <span>遮罩暗化（无背景）</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('bgDimForNoneBgMask') }"
                @click="resetField('bgDimForNoneBgMask')"
              ></button>
            </label>
            <a-slider
              :value="settings.bgDimForNoneBgMask"
              :min="0"
              :max="90"
              @change="setField('bgDimForNoneBgMask', $event)"
            />
          </div>
        </section>

        <!-- 歌词 -->
        <section v-show="activeTab === 'lyric'" class="settings-section">
          <div class="settings-group-title">歌词</div>
          <div class="setting-row">
            <label class="setting-label-with-reset">
              <span>字体大小</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('lyricFontSize') }"
                @click="resetField('lyricFontSize')"
              ></button>
            </label>
            <a-slider
              :value="settings.lyricFontSize"
              :min="16"
              :max="64"
              :step="1"
              @change="setField('lyricFontSize', $event)"
            />
          </div>
          <div class="setting-row">
            <label class="setting-label-with-reset">
              <span>罗马音</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('lyricRomajiSizeEm') }"
                @click="resetField('lyricRomajiSizeEm')"
              ></button>
            </label>
            <a-slider
              :value="settings.lyricRomajiSizeEm"
              :min="0.3"
              :max="1.5"
              :step="0.05"
              @change="setField('lyricRomajiSizeEm', $event)"
            />
          </div>
          <div class="setting-row">
            <label class="setting-label-with-reset">
              <span>翻译</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('lyricTranslationSizeEm') }"
                @click="resetField('lyricTranslationSizeEm')"
              ></button>
            </label>
            <a-slider
              :value="settings.lyricTranslationSizeEm"
              :min="0.3"
              :max="1.5"
              :step="0.05"
              @change="setField('lyricTranslationSizeEm', $event)"
            />
          </div>
          <div v-show="!isRotate" class="setting-row">
            <a-checkbox v-model:checked="settings.lyricFade">歌词渐隐</a-checkbox>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.lyricZoom">歌词缩放</a-checkbox>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.lyricBlur">歌词模糊</a-checkbox>
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.lyricRotate">歌词旋转</a-checkbox>
          </div>
          <div v-show="isRotate" class="setting-row">
            <label class="setting-label-with-reset">
              <span>曲率</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('rotateCurvature') }"
                @click="resetField('rotateCurvature')"
              ></button>
            </label>
            <a-slider
              :value="settings.rotateCurvature"
              :min="10"
              :max="80"
              @change="setField('rotateCurvature', $event)"
            />
          </div>
          <div class="setting-row">
            <label>逐字动画</label>
            <a-segmented
              v-model:value="settings.karaokeAnimation"
              :options="karaokeOptions"
              block
            />
          </div>
          <div class="setting-row">
            <label>当前歌词位置</label>
            <a-segmented
              v-model:value="settings.currentLyricAlignmentPercentage"
              :options="alignmentPctOptions"
              block
            />
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.lyricStagger">错位滚动动画</a-checkbox>
          </div>
          <div class="setting-row">
            <label>动画曲线</label>
            <a-segmented
              v-model:value="settings.lyricAnimationTiming"
              :options="timingOptions"
              block
            />
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.lyricGlow">长音发光动画</a-checkbox>
            <span class="setting-note">在句末长音单词播放时显示发光动画</span>
          </div>
          <div class="setting-row">
            <label class="setting-label-with-reset">
              <span>全局偏移</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('lyricOffset') }"
                @click="resetField('lyricOffset')"
              ></button>
            </label>
            <a-slider
              :value="settings.lyricOffset"
              :min="-10000"
              :max="10000"
              :step="100"
              :tip-formatter="lyricOffsetLabel"
              @change="setField('lyricOffset', $event)"
            />
            <div class="lyric-offset-stepper">
              <button type="button" class="step-btn" @click="stepLyricOffset(-100)">−</button>
              <span class="setting-note">
                {{ lyricOffsetLabel(settings.lyricOffset) }} · {{ lyricOffsetTip }}
              </span>
              <button type="button" class="step-btn" @click="stepLyricOffset(100)">+</button>
            </div>
          </div>
          <div class="setting-row">
            <label>歌词贡献者显示</label>
            <a-segmented
              v-model:value="settings.lyricContributorsDisplay"
              :options="contributorsOptions"
              block
            />
          </div>
        </section>

        <!-- 字体 -->
        <section v-show="activeTab === 'font'" class="settings-section">
          <div class="settings-group-title">字体</div>
          <div class="setting-row">
            <label class="setting-label-with-reset">
              <span>字重</span>
              <button
                type="button"
                class="reset-btn"
                :class="{ changed: isChanged('lyricFontWeight') }"
                @click="resetField('lyricFontWeight')"
              ></button>
            </label>
            <a-slider
              :value="settings.lyricFontWeight"
              :min="100"
              :max="900"
              :step="100"
              @change="setField('lyricFontWeight', $event)"
            />
          </div>
          <div class="setting-row">
            <a-checkbox v-model:checked="settings.customFont">自定义字体</a-checkbox>
          </div>
          <div v-if="settings.customFont" class="setting-row">
            <label>选择字体</label>
            <a-select
              v-model:value="settings.customFontFamily"
              mode="tags"
              :options="fontOptions"
              show-search
              allow-clear
              :token-separators="[',']"
              placeholder="选择或输入字体名"
            />
            <span class="setting-note">某些字体可能不在列表中，需要手动输入</span>
            <span class="setting-note"
              >如果顺序在前的字体缺少某些字符，则会使用顺序在后的字体，依次顺延</span
            >
          </div>
          <div v-if="settings.customFont" class="setting-row">
            <label>字体预设</label>
            <div v-for="preset in FONT_PRESETS" :key="preset.name" class="font-preset">
              <span class="font-preset-label">{{ preset.name }}</span>
              <button
                v-if="hasFont(preset)"
                type="button"
                class="font-preset-btn"
                @click="applyPreset(preset)"
              >
                应用
              </button>
              <button
                v-else-if="preset.url"
                type="button"
                class="font-preset-btn"
                aria-label="下载字体"
                @click="downloadFont(preset.url)"
              >
                下载
              </button>
            </div>
          </div>
        </section>

        <!-- 关于 -->
        <section v-show="activeTab === 'about'" class="settings-section">
          <div class="settings-group-title">关于</div>
          <div class="about-item">
            <div class="about-title">原项目</div>
            <div class="about-content">refined-now-playing-netease</div>
          </div>
          <div class="about-item">
            <div class="about-title">作者</div>
            <div class="about-content">solstice23</div>
          </div>
          <div class="about-item">
            <div class="about-title">GitHub</div>
            <a
              class="about-content link"
              href="https://github.com/solstice23/refined-now-playing-netease"
              target="_blank"
              rel="noopener"
            >
              前往
            </a>
          </div>
          <p class="about-tribute">
            本沉浸播放页基于 solstice23 的 refined-now-playing-netease 致敬移植，特此致谢。
          </p>
        </section>
      </div>
    </aside>
  </Transition>
</template>

<style lang="scss" scoped>
.immersive-settings {
  /* 悬浮圆角小窗(对齐参考 .rnp-settings-menu:fixed right:30 top:100,圆角 10px,
   毛玻璃 + 阴影;display:flex 横向 = 左纵向 tab 列 + 右内容区;height:min(500px,60vh))。 */
  position: fixed;
  top: 100px;
  right: 30px;
  bottom: auto;
  z-index: 7;
  display: flex;
  flex-direction: row;
  gap: 20px;
  width: 360px;
  max-width: 90vw;
  height: min(500px, 60vh);
  max-height: calc(100vh - 140px);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  border-radius: 10px;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 12px;
  -webkit-app-region: no-drag;
}

.settings-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  transition:
    opacity 0.2s ease,
    background 0.2s ease;
  &:hover {
    opacity: 1;
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1);
  }
}

.settings-tabs {
  /* 纵向 tab 列(对齐参考 .rnp-settings-menu-tabs:左侧列,width:max-content) */
  display: flex;
  flex-direction: column;
  gap: 0;
  width: max-content;
  padding: 16px 10px 16px 20px;
  border-right: 1px solid var(--color-border);
}

.settings-tab {
  padding: 10px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: 0.875rem;
  opacity: 0.6;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    color 0.2s ease,
    opacity 0.2s ease;
  white-space: nowrap;
  text-align: left;
  &:hover {
    opacity: 0.9;
  }
  &.active {
    background: transparent;
    color: var(--color-primary);
    font-weight: bold;
    transform: scale(1.1);
    opacity: 1;
  }
}

.settings-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 20px 20px 10px;
  :deep(.ant-segmented) {
    /* 拼接按钮条(对齐参考 .rnp-select-group:首尾圆角,选中 accent + bold;隐藏 thumb) */
    background: rgba(223, 225, 228, 0.2);
    color: inherit;
    padding: 0;
    border-radius: 6px;
  }
  :deep(.ant-segmented-item) {
    border-radius: 0;
    padding: 4px 0;
    text-align: center;
    color: inherit;
    transition: background-color 0.3s ease;
  }
  :deep(.ant-segmented-item-label) {
    /* AntD 的 item-label 自带 padding:0 11px + text-overflow:ellipsis,360px 窄面板下
   选项多时(背景类型 5 项)每项内容区不足 2 字宽 → 触发省略号。
   缩小 label 左右内边距 + 略缩字号 + 禁止省略,确保文字完整可见。 */
    padding: 0 4px;
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
  }
  :deep(.ant-segmented-item:first-child) {
    border-radius: 6px 0 0 6px;
  }
  :deep(.ant-segmented-item:last-child) {
    border-radius: 0 6px 6px 0;
  }
  :deep(.ant-segmented-item:hover:not(.ant-segmented-item-selected)) {
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1) !important;
    color: inherit !important;
  }
  :deep(.ant-segmented-thumb) {
    display: none;
  }
  :deep(.ant-segmented-item-selected) {
    background: var(--rnp-accent-color, var(--color-primary));
    color: var(--rnp-accent-color-on-primary, $color-white);
    font-weight: bold;
  }
  :deep(.ant-checkbox-wrapper) {
    /* iOS 拨动开关(对齐参考 .rnp-checkbox:30×20 圆角槽 + 14×14 圆 thumb,checked 左移)。
   用真实元素 .ant-checkbox-inner 作 thumb(改为圆 + 隐藏勾),不用 ::after ——
   antd 的 .ant-checkbox-checked::after 是选中波纹伪元素,会顶掉自定义 thumb 导致 checked 时手柄消失。 */
    color: inherit;
    align-items: center;
  }
  :deep(.ant-checkbox) {
    width: 30px;
    height: 20px;
    border: 0;
    border-radius: 72px;
    background: rgba(223, 225, 228, 0.2);
    position: relative;
    transition: background 100ms ease-out;
    flex-shrink: 0;
  }
  :deep(.ant-checkbox-inner) {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: 50%;
    background: $color-white;
    transition: left 100ms ease-out;
  }
  :deep(.ant-checkbox-inner::after) {
    /* 隐藏 antd 方框内的勾(.ant-checkbox-inner::after) */
    display: none;
  }
  :deep(.ant-checkbox:hover) {
    background: rgba(201, 203, 205, 0.2);
  }
  :deep(.ant-checkbox-checked) {
    background: var(--rnp-accent-color, var(--color-primary));
  }
  :deep(.ant-checkbox-checked .ant-checkbox-inner) {
    left: 13px;
  }
  :deep(.ant-checkbox-checked:hover) {
    background: var(--rnp-accent-color, var(--color-primary));
  }
  :deep(.ant-slider) {
    /* slider(对齐参考 .rnp-slider:8px 圆角轨道 + 10×10 白圆 thumb) */
    margin: 4px 0 18px;
  }
  :deep(.ant-slider-rail) {
    top: 50%;
    height: 8px;
    margin-top: -4px;
    border-radius: 20px;
    background: rgba(223, 225, 228, 0.13);
  }
  :deep(.ant-slider-track) {
    top: 50%;
    height: 8px;
    margin-top: -4px;
    border-radius: 20px;
    background: var(--rnp-accent-color, var(--color-primary));
  }
  :deep(.ant-slider:hover .ant-slider-track) {
    top: 50%;
    height: 8px;
    margin-top: -4px;
    border-radius: 20px;
    background: var(--rnp-accent-color, var(--color-primary));
  }
  :deep(.ant-slider-handle) {
    top: 50%;
    margin-top: -5px;
    width: 10px;
    height: 10px;
    border: 0;
    background: $color-white;
    border-radius: 50%;
    /* slider 手柄:hover/active/dragging 强制白底无边框,隐藏 antd 拖动圈(::after) */
    border: 0 !important;
    background: $color-white !important;
  }
  :deep(.ant-slider-handle:hover) {
    border: 0 !important;
    background: $color-white !important;
  }
  :deep(.ant-slider-handle:focus) {
    border: 0 !important;
    background: $color-white !important;
  }
  :deep(.ant-slider-handle:active) {
    border: 0 !important;
    background: $color-white !important;
  }
  :deep(.ant-slider-handle-dragging) {
    border: 0 !important;
    background: $color-white !important;
  }
  :deep(.ant-slider-handle::after) {
    background: transparent !important;
    box-shadow: none !important;
  }
  :deep(.ant-slider-handle:hover::after) {
    background: transparent !important;
    box-shadow: none !important;
  }
  :deep(.ant-slider-handle:focus::after) {
    background: transparent !important;
    box-shadow: none !important;
  }
  :deep(.ant-slider-handle:active::after) {
    background: transparent !important;
    box-shadow: none !important;
  }
  :deep(.ant-slider-handle-dragging::after) {
    background: transparent !important;
    box-shadow: none !important;
  }
  :deep(.ant-slider-mark-text) {
    color: inherit;
    opacity: 0.5;
    font-size: 0.7rem;
  }
  :deep(.ant-checkbox:hover .ant-checkbox-inner) {
    /* antd 全局 colorPrimary 是网易绿,开关 hover 与字体输入框 focus 强制跟随沉浸色 */
    border-color: transparent !important;
    background: $color-white !important;
  }
  :deep(.ant-checkbox-wrapper:hover .ant-checkbox-inner) {
    border-color: transparent !important;
    background: $color-white !important;
  }
  :deep(.ant-checkbox-checked::after) {
    /* 隐藏 antd 选中波纹(.ant-checkbox-checked::after 是 colorPrimary 绿边 + antCheckboxEffect 动画) */
    display: none !important;
    animation: none !important;
  }
  :deep(.ant-input:hover) {
    border-color: var(--rnp-accent-color, var(--color-primary)) !important;
    box-shadow: 0 0 0 2px rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.2) !important;
  }
  :deep(.ant-input:focus) {
    border-color: var(--rnp-accent-color, var(--color-primary)) !important;
    box-shadow: 0 0 0 2px rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.2) !important;
  }
  :deep(.ant-input-affix-wrapper:hover) {
    border-color: var(--rnp-accent-color, var(--color-primary)) !important;
    box-shadow: 0 0 0 2px rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.2) !important;
  }
  :deep(.ant-input-affix-wrapper:focus) {
    border-color: var(--rnp-accent-color, var(--color-primary)) !important;
    box-shadow: 0 0 0 2px rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.2) !important;
  }
  :deep(.ant-input-affix-wrapper-focused) {
    border-color: var(--rnp-accent-color, var(--color-primary)) !important;
    box-shadow: 0 0 0 2px rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.2) !important;
  }
  :deep(.ant-select:hover .ant-select-selector) {
    /* a-select(字体多选)hover/focus 边框跟随沉浸色 */
    border-color: var(--rnp-accent-color, var(--color-primary)) !important;
    box-shadow: 0 0 0 2px rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.2) !important;
  }
  :deep(.ant-select-focused .ant-select-selector) {
    border-color: var(--rnp-accent-color, var(--color-primary)) !important;
    box-shadow: 0 0 0 2px rgba(var(--rnp-accent-color-rgb, 170, 170, 170), 0.2) !important;
  }
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding-top: 10px;
}

.settings-group-title {
  /* 分组大标题(对齐参考 .rnp-group-title,缩小至 20px 适配 360px 面板) */
  margin-bottom: 20px;
  font-size: 20px;
  opacity: 0.6;
  font-weight: bold;
  line-height: 1.2;
}

.setting-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  > label {
    font-size: 0.82rem;
    opacity: 0.85;
  }
}

.setting-label-with-reset {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.reset-btn {
  /* reset 小圆点(对齐参考 .rnp-slider-reset:8×8 白圆,hover accent;未改动隐藏) */
  width: 8px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: $color-white;
  opacity: 0.3;
  cursor: pointer;
  transition:
    opacity 0.2s ease,
    background-color 0.2s ease;
  &:hover {
    opacity: 1;
    background: var(--rnp-accent-color, var(--color-primary));
  }
  &.changed {
    opacity: 1;
  }
  &:not(.changed) {
    /* 未改动时隐藏(对齐参考 .rnp-slider-wrapper:not(.changed) .rnp-slider-reset) */
    opacity: 0;
    pointer-events: none;
  }
}

.setting-note {
  font-size: 0.72rem;
  opacity: 0.5;
  line-height: 1.4;
  &.banner {
    margin: 0 0 0.25rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.06);
  }
}

.lyric-offset-stepper {
  /* 歌词全局偏移 ±100ms 步进 + 状态提示(对齐参考 settings-menu.html:235-250) */
  display: flex;
  align-items: center;
  gap: 0.5rem;
  .step-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    color: inherit;
    font-size: 1rem;
    line-height: 1;
    opacity: 0.6;
    cursor: pointer;
    transition:
      opacity 0.2s ease,
      background 0.2s ease;
    &:hover {
      opacity: 1;
      background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1);
    }
  }
  .setting-note {
    flex: 1;
    text-align: center;
  }
}

.about-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.06);
}

.about-title {
  opacity: 0.6;
  font-size: 0.82rem;
}

.about-content {
  font-size: 0.82rem;
  &.link {
    color: var(--rnp-accent-color, var(--color-primary));
  }
}

.about-tribute {
  margin-top: 1rem;
  font-size: 0.75rem;
  opacity: 0.5;
  line-height: 1.6;
}

.font-preset {
  /* 字体预设行(对齐参考 .rnp-font-preset) */
  display: flex;
  align-items: center;
  margin-top: 10px;
  font-size: 90%;
}

.font-preset-label {
  opacity: 0.6;
}

.font-preset-btn {
  margin-left: 10px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.27);
  color: inherit;
  font-size: 90%;
  cursor: pointer;
  transition: background-color 0.2s ease;
  &:hover {
    background: var(--rnp-accent-color, var(--color-primary));
  }
}

.settings-slide-enter-active {
  /* 淡入下移(对齐参考 .rnp-settings-menu:translateY(-10px)+opacity:0 ↔ none+1,
   transition all .3s ease)。 */
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
}

.settings-slide-leave-active {
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
}

.settings-slide-enter-from {
  transform: translateY(-10px);
  opacity: 0;
}

.settings-slide-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}
</style>

<!-- 原 package-0.1.21 的 immersive-settings 族样式。置于内联块之后：同特异性按源顺序后者胜，
     复刻原「#app 前缀(0,1,0 更高)压过内联 scoped」的层叠关系。内联块保持不动。 -->
<style scoped lang="scss" src="./immersive-settings.panel.scss"></style>
