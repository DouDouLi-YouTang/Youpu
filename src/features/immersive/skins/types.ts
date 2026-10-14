import { defineAsyncComponent, type Component } from 'vue'

import type { AudioBands } from '../use-audio-bands'

/**
 * 皮肤系统契约（types / registry / use-skin-context 三个文件是全部皮肤的公共依赖）。
 *
 * ⚠️ 时间单位约定：本契约**一律毫秒**。
 * 依据：本项目全链路就是毫秒 —— `player.currentTimeMs`、`LyricLine.timeMs`、
 * `player.seek(ms)`、`LyricLines` 的 `:current-time-ms` prop 都是毫秒；
 * `docs/folia-integration.md` §3.1 写的是秒制，那是 Folia 算法**内部**的单位
 * （适配层的下游），不该泄漏进本契约。C3 的 tilt 适配层负责把毫秒转成秒、`word`→`text`。
 */

/** 频带能量形状直接复用 use-audio-bands.ts 的实现，不在此重定义。 */
export type { AudioBands }

/**
 * 全部皮肤 id 的**单一真源**。新增皮肤时只改这一行：
 *  - `SkinId` 联合类型由它派生；
 *  - settings store 用它校验持久化里的 `skin`（非法值回退默认皮肤）；
 *  - registry 的 `SkinDefinition.id: SkinId` 又在编译期保证注册项落在集合内。
 *
 * 为什么需要：store **不能** import registry（registry → store，会形成循环），
 * 所以「合法 skin 有哪些」无法从注册表自动推导，只能靠这个中立常量 + 类型约束。
 */
export const SKIN_IDS = ['classic', 'tilt', 'glow'] as const

/** 皮肤 id。新增皮肤时先加到 SKIN_IDS，并在 `<id>/index.ts` 注册（registry 自动发现）。 */
export type SkinId = (typeof SKIN_IDS)[number]

/**
 * 默认皮肤 id：持久化值为空 / 未注册时的回退。
 *
 * ⚠️ 定义在这里而**不是** `registry.ts`：settings store 要用它，而 registry 反过来
 * 要 import settings store（`useActiveSkin` 读 `settings.skin`）——常量放在 registry
 * 会形成 store ↔ registry 循环 import。本文件不依赖 store，是安全的中立落点。
 * registry 仍然 re-export 它，老引用不用改。
 */
export const DEFAULT_SKIN_ID: SkinId = 'classic'

/**
 * 皮肤只读上下文：把 store 状态统一喂给皮肤，由 `use-skin-context.ts` 创建，
 * 经 `SkinShell` 以 prop 形式传给皮肤组件（不要解构，getter 才是契约）。
 *
 * 全部是 getter —— 在模板/computed 里调用即可建立响应式依赖；
 * 在皮肤自己的 rAF 里逐帧调用则读到最新值（不经过 Vue 响应式）。
 * 皮肤不许自己重算这些派生值（当前行、显示时间、seek 换算都必须走这里）。
 */
export interface SkinContext {
  /** 当前时间（**毫秒**，歌词时间轴 = player.currentTimeMs + settings.lyricOffset） */
  currentTime(): number
  /** 当前高亮歌词行下标（含全局偏移与 stagger 提前量）；-1 表示尚未到首行 */
  currentLineIndex(): number
  isPlaying(): boolean
  /** 逐帧读 `audioBands.value`，不要解构；图未建起来时全 0 */
  bands(): AudioBands
  coverUrl(): string | null
  songTitle(): string | null
  songArtist(): string | null
  songAlbum(): string | null
  /** 歌词行跳转（**毫秒**）：壳层负责扣掉 lyricOffset 并按播放器规则钳 0 */
  seekLyric(lineTimeMs: number): void
}

/** 皮肤注册项（`<id>/index.ts` 的 default export，用 `defineSkin` 创建）。 */
export interface SkinDefinition {
  id: SkinId
  /** 中文显示名（悬浮切换条） */
  name: string
  /** 一句话描述（悬浮切换条） */
  desc: string
  /** 列表排序权重，小的在前；同值按 id 排 */
  order: number
  /**
   * 该面板是否**有自己的设置**。这是「设置面板这一整套配置说的是哪个面板」的答案
   * （2026-10-11 用户定：设置本来就是给「经典」用的，「倾诉」没有设置）。
   *
   * true（经典）—— 沉浸页设置面板（外观 / 封面 / 背景 / 歌词 / 字体 / 关于）
   *   配置的就是它：沉浸页右上角显示设置按钮，根节点套用它那套外观
   *   （背景类型 / 显示模式 / 歌词排版 / 自定义字体 / 封面…）。
   * false（倾诉）—— 该面板没有设置，**也不读**上面那套：背景恒为「几何」且不可改、
   *   永不显示封面、歌词排版与字体用内置值。因此右上角不显示设置按钮
   *   （见 shared/SkinShell.vue），根节点也不套用它那套 class / CSS 变量
   *   （见 shared/use-backdrop.ts）。
   *
   * ⚠️ 不受本开关影响的是**沉浸页通用项**：明暗主题、专辑主色、底栏四项、演示模式、
   * 歌词偏移。它们是「这一页 / 这个播放器」的通用行为，不是面板外观，两边都生效。
   */
  hasSettings: boolean
  /** 皮肤根组件：接收 `ctx: SkinContext`，自行消费 store 渲染布局 */
  component: Component
}

/** `defineSkin` 入参：组件用动态 import 传入（见下）。 */
export interface SkinDefinitionInput extends Omit<SkinDefinition, 'component'> {
  /**
   * 必须是 loader 而不是组件本身 —— registry 用 **eager** glob 只为同步拿到
   * id/中文名/描述（切换条与设置卡片要立刻渲染列表）；组件经 defineAsyncComponent
   * 懒加载，仍会单独打包成 chunk，不进主 bundle。
   */
  component: () => Promise<{ default: Component }>
}

/** 皮肤定义助手：把动态 import 包成异步组件（懒加载 chunk）。 */
export function defineSkin(input: SkinDefinitionInput): SkinDefinition {
  return { ...input, component: defineAsyncComponent(input.component) }
}
