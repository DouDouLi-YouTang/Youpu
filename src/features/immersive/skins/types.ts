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

/** 皮肤 id。新增皮肤时在此联合类型追加，并在同目录新建 `<id>/index.ts`（registry 自动发现）。 */
export type SkinId = 'classic' | 'tilt'

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
  /** 中文显示名（悬浮切换条 / 设置面板卡片） */
  name: string
  /** 一句话描述（设置面板卡片） */
  desc: string
  /** 列表排序权重，小的在前；同值按 id 排 */
  order: number
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
