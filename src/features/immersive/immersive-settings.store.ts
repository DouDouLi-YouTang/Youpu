import { defineStore } from 'pinia'

// ⚠️ 常量与类型都从 skins/types 取（**不要**从 skins/registry 取 —— registry 反过来
// 依赖本 store，会形成循环 import；原因写在 types.ts 的 DEFAULT_SKIN_ID 注释里）
import { DEFAULT_SKIN_ID, SKIN_IDS, type SkinId } from './skins/types'
// 类型 / 常量 / 默认值 / 派生字段名都在纯数据层 model 里（本文件只留响应式接线）。
// 这样 migrate 既能拿类型又不必反过来 import 本文件 —— 见 model 顶部说明。
import {
  createDefaultSettings,
  PERSIST_KEY,
  type ImmersiveSettings
} from './immersive-settings.model'
import {
  isBucketed,
  normalizeFoliaSettings,
  normalizeFontFamily,
  sanitizeSkinId,
  settingsFromBucketed
} from './immersive-settings.migrate'

/**
 * 沉浸页设置 + 当前面板。两件事要分清（2026-10-11 用户明确）：
 *
 *  - **经典设置只有一份，挂在扁平字段上。** 沉浸页的经典设置面板（外观 / 封面 /
 *    背景 / 歌词 / 字体 / 关于）改的就是这一份，没有第二个「编辑目标」。
 *  - **Folia 三主题共享一份设置。** 倾诉 / 流光 / 浮名的明暗、配色方案、
 *    副歌词、背景与逐词着色都由 `folia` 页签控制；它们的字号与排版仍固定。
 *    歌词排版与字体用内置值，所以不读经典的面板外观字段；沉浸页通用项仍读同一份设置。
 *
 * 于是持久化就是一个扁平对象 + 全局的 `skin`（当前在放哪个面板）。皮肤系统刚上线时
 * 曾短暂按面板分桶（`panels: Record<SkinId, ImmersiveSettings>`），那个设计已被否决：
 * 「原来的设置是给经典面板用的」。旧的分桶数据由
 * `migrateBucketedSettings` 取出经典那一桶还原成扁平（见该函数）。
 *
 * 由此推出两条显示约定：
 *  1. Folia 三主题使用同一套独立页签，不能把经典字段当成默认值继续灌进去。
 *  2. 经典页签仍列完整的一套，不因为 Folia 三主题不消费而裁掉任何一行。
 */

// 数据层（类型 / 常量 / 默认值 / 字段名派生）原样再导出，消费方继续从 store 导入即可，
// 不必知道它们被拆到了 model。
export * from './immersive-settings.model'

interface ImmersiveSettingsState extends ImmersiveSettings {
  /**
   * 当前在放哪个面板（经典 / 倾诉）。**唯一**的全局项，不属于上面那份设置。
   *
   * 它只决定「渲染哪个面板」，不再决定「编辑哪一份设置」（只有一份）。
   * 切换入口只有一个：沉浸页顶部控制栏那一排的悬浮胶囊（skins/shared/SkinSwitcher.vue）。
   */
  skin: SkinId
}

/**
 * 落盘的键 = 一份默认设置的全部字段 + `skin`。
 *
 * 从 `createDefaultSettings()` 推导而不是手写清单：新增设置字段时忘了同步清单，
 * 后果是「这个设置在磁盘上悄悄不存在」（刷新后回到默认值），很难查；这样写就不可能漏。
 *
 * ⚠️ `pick` 在**读写两侧都生效**（hydrate 与 persist 都过 `deepPickUnsafe`），
 * 这一条同时承担两件事：
 *  1. 旧分桶数据里的 `panels` 不会漏进 state，也不会被原样写回（迁移自己读 localStorage）；
 *  2. 将来往 state 里加 UI 态字段时，只要不写进 `createDefaultSettings()`，就自动不落盘。
 */
const PERSISTED_KEYS: string[] = [...Object.keys(createDefaultSettings()), 'skin']

export const useImmersiveSettingsStore = defineStore('immersive-settings', {
  state: (): ImmersiveSettingsState => ({
    ...createDefaultSettings(),
    skin: DEFAULT_SKIN_ID
  }),

  actions: {
    /**
     * 启动引导 —— **必须在任何设置被读写之前调用一次**（唯一调用点：ImmersivePlayer.vue）。
     *
     * 顺序不能变，各步之间是有依赖的：
     *  1. `migrateBucketedSettings()` 先把旧分桶数据换成扁平（新结构数据则什么都不做）；
     *  2. `normalizeFontFamily()` 再把可能残留的旧格式字体名收成数组
     *     —— 必须在 1 **之后**：迁移会把旧数据整体搬过来，而旧数据里的
     *     `customFontFamily` 可能是字符串（更早版本的格式）；顺序反了它就会以字符串
     *     留在 state 里，`use-backdrop` 的 `.map()` 直接抛 TypeError。
     *  3. 纠正非法的 skin：非法值会被 registry 的 getSkin 兜底成经典，
     *     但**它本身会被持久化原样写回**，于是垃圾值永久留在磁盘上。
     *
     * **重入安全**：各子步骤幂等，重复调用无副作用；
     * 只有真的改动了东西才写回 storage（避免每次启动都无谓写一次）。
     */
    bootstrapSettings() {
      let changed = this.migrateBucketedSettings()
      if (normalizeFontFamily(this)) changed = true
      if (normalizeFoliaSettings(this)) changed = true
      if (sanitizeSkinId(this.skin, SKIN_IDS, DEFAULT_SKIN_ID) !== this.skin) {
        this.skin = DEFAULT_SKIN_ID
        changed = true
      }
      if (changed) this.$persist()
    },

    /**
     * 切换面板 —— **唯一入口**是沉浸页顶部控制栏的悬浮胶囊（SkinSwitcher.vue）。
     * 只改「在放哪个面板」；设置只有一份，不受影响。
     * 未注册的 id 由 registry 的 getSkin 回退到默认皮肤。
     */
    applySkin(id: SkinId) {
      this.skin = id
    },

    /**
     * 迁移 v2（按面板分桶）持久化 → 当前扁平结构。幂等：不是分桶数据就什么都不做，
     * 返回是否发生了改动（`bootstrapSettings` 据此决定要不要写回）。
     *
     * **为什么必须直读 localStorage，而不是用插件的 afterHydrate**：
     * 插件的 hydration 受 `pick` 影响，分桶数据的顶层只有 `skin` / `panels`，
     * 而 `panels` 不在 pick 清单里 —— 到 `afterHydrate` 时它已经被丢掉了，
     * 拿不回来。所以这里读一次原始 JSON。
     *
     * 迁移策略：**取经典那一桶**当全局设置。倾诉桶按设计丢弃 —— 它本来就不该有设置，
     * 那批值只是上一次错误设计的产物（用户升级后看到的是经典的设置，符合预期）。
     *
     * ⚠️ 返回后**不要**忘了 `normalizeFontFamily`（见 `bootstrapSettings` 的顺序说明）。
     */
    migrateBucketedSettings(): boolean {
      const raw = readPersistedRaw()
      if (!raw || !isBucketed(raw)) return false

      // 只覆盖老数据里出现过的已知键（settingsFromBucketed 已按默认值的键集过滤），
      // 未列出的字段保留当前默认值，不会变成 undefined。
      Object.assign(this, settingsFromBucketed(raw))
      return true
    }
  },

  /**
   * 持久化：整个扁平 state（见 PERSISTED_KEYS 的推导说明）。
   *
   * ⚠️ 隐含约束：**任何模块都不许在顶层调 `useImmersiveSettingsStore()`**。
   * store 一实例化，插件就立刻 hydrate + 订阅；若在 bootstrap 之前就有一次写入，
   * 新结构会先落盘，把还没迁移的旧数据覆盖掉（不可恢复）。当前所有调用点都在
   * setup / 函数体内，保持这个不变量。
   */
  persist: {
    key: PERSIST_KEY,
    pick: PERSISTED_KEYS
  }
})

/** 读取持久化里的原始对象（未经 pick/hydrate）。读不到 / 解析失败都返回 null。 */
function readPersistedRaw(): Record<string, unknown> | null {
  try {
    const text = localStorage.getItem(PERSIST_KEY)
    if (!text) return null
    const parsed = JSON.parse(text) as unknown
    // 排除数组：typeof [] 也是 'object'，但它不可能是合法的设置对象
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
