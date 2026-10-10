import { computed } from 'vue'

import { useImmersiveSettingsStore } from '../immersive-settings.store'
import type { SkinDefinition, SkinId } from './types'

/**
 * 皮肤注册表 —— 自动发现 `skins/<id>/index.ts`（每个文件 default export defineSkin({...})）。
 *
 * 路径必须**相对**（glob 模式见下方常量，形如「点斜杠 + 通配目录 + 斜杠 index.ts」）：
 * `import.meta.glob` 不支持 `@/` 别名，这是 Vite 的约束。
 * 用 eager glob 只为同步拿到元数据（id / 中文名 / 描述 / 排序），皮肤根组件仍由各 index.ts
 * 里的动态 import + defineAsyncComponent 懒加载成独立 chunk。
 *
 * ⚠️ 已知取舍：生产构建 + `file://` 协议下，异步 chunk 的路径解析有潜在风险
 * （docs/refactor-plan.md §4.6 第 4 条列为必测项）。若打包后切换皮肤出现空白 / 加载失败，
 * 把 defineSkin 里的 defineAsyncComponent 换成静态 `import SkinXxx from './SkinXxx.vue'`
 * 即可（代价：皮肤不再按需加载，全部进主 bundle）。
 */
const modules = import.meta.glob('./*/index.ts', { eager: true }) as Record<
  string,
  { default: SkinDefinition }
>

/** 全部已注册皮肤，按 order 升序（同 order 按 id，保证列表顺序稳定）。 */
export const skins: SkinDefinition[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/** 默认皮肤 id：持久化值为空 / 未注册时的回退。 */
export const DEFAULT_SKIN_ID: SkinId = 'classic'

/** 按 id 取皮肤；未注册的 id（旧持久化 / 已删除的皮肤）回退到默认皮肤，保证任何值都能渲染。 */
export function getSkin(id: string): SkinDefinition {
  const found = skins.find((s) => s.id === id) ?? skins.find((s) => s.id === DEFAULT_SKIN_ID)
  if (!found) throw new Error('未注册任何皮肤：请检查 skins/*/index.ts 是否存在')
  return found
}

/** 当前生效的皮肤（跟随 settings.skin，无效值同上回退）。切换入口改 settings 即生效。 */
export function useActiveSkin() {
  const settings = useImmersiveSettingsStore()
  return computed(() => getSkin(settings.skin))
}
