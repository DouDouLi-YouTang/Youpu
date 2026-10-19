import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isBucketed,
  normalizeFoliaSettings,
  normalizeFontFamily,
  sanitizeSkinId,
  settingsFromBucketed
} from './immersive-settings.migrate'
import { createDefaultSettings, PERSIST_KEY } from './immersive-settings.model'
import { useImmersiveSettingsStore } from './immersive-settings.store'
import { DEFAULT_SKIN_ID } from './skins/types'

/**
 * 迁移层 + store（扁平设置）的集成单测。
 *
 * 迁移函数本身是纯的，但「迁移真正被用对」要靠 store 里那套读 localStorage → 搬进扁平设置
 * → 写回的流程，所以 store 的用例也放在这里 —— 它们共用下面同一个 localStorage stub。
 *
 * 结构背景：经典设置**只有一份**，扁平挂在 store 顶层；Folia 三主题另用 `folia`
 * 共享字段。迁移只把 v2 分桶数据里的 **classic 那一桶**取出来当全局经典设置，
 * 历史 tilt 桶按设计丢弃。
 *
 * vitest 是 **node 环境**（没有 jsdom）：storage 得自己造一个最小实现，
 * 同时挂给 `vi.stubGlobal('localStorage', ...)`（store 的 `readPersistedRaw` 裸读它）
 * 和持久化插件（`createPersistedState({ storage })`）—— 与真实应用一致，
 * 两侧读写的本来就是同一个 localStorage。
 */

/**
 * 最小 localStorage 实现：够 pinia 持久化插件与 `readPersistedRaw` 使用。
 * `setItem` 真的写入（不是记录器）—— 迁移的幂等性依赖「迁移后写回把旧数据覆盖掉」，
 * 写进假 map 才能复现这条链路；`writes` 再额外数一次写入次数，
 * 用来断言「没改动 → 不写盘」（只比对字符串变化会被「原样重写」蒙混过关）。
 */
function createStorageStub() {
  const map = new Map<string, string>()
  const storage = {
    writes: 0,
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      storage.writes += 1
      map.set(key, value)
    },
    removeItem: (key: string): void => {
      map.delete(key)
    },
    clear: (): void => {
      map.clear()
      storage.writes = 0
    }
  }
  return storage
}

type StorageStub = ReturnType<typeof createStorageStub>

let storage: StorageStub

beforeEach(() => {
  storage = createStorageStub()
  vi.stubGlobal('localStorage', storage)
  const pinia = createPinia()
  // ⚠️ 必须经过 `app.use(pinia)`：插件在 install 之前只进 `toBeInstalled` 队列，
  // 不挂到实例上就永远不会执行（没有 app 时 store.$persist 不存在、也不会 hydrate）。
  createApp({}).use(pinia)
  pinia.use(createPersistedState({ storage }))
  setActivePinia(pinia)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function useSettings() {
  return useImmersiveSettingsStore()
}

/** 把一份持久化数据预置进 storage，模拟「用户升级前已经写过 localStorage」。 */
function seedStorage(raw: unknown) {
  storage.setItem(PERSIST_KEY, JSON.stringify(raw))
}

/** 深拷贝一份完整状态快照（含 `skin`），用来对比「操作后状态没变」。 */
function snapshotState(store: ReturnType<typeof useSettings>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(store.$state)) as Record<string, unknown>
}

/** 默认设置的纯数据副本；类型上退化成普通字典，便于与状态快照整体对比。 */
function defaultsRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(createDefaultSettings())) as Record<string, unknown>
}

/**
 * 摘掉 `customFontFamily` 与 `skin` 后的字典 —— 用来做「设置字段整体逐项等于默认值」这种
 * 最强断言。为什么摘这两个：字体链被迁移改成 ['SimSun'] 本来就不该等于默认值、skin 是
 * 全局项不属于设置，两者都另有单独断言，留在这里只会让整体对比说不清失败原因。
 */
function settingsOnly(source: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...source }
  delete copy.customFontFamily
  delete copy.skin
  return copy
}

/**
 * 造一份 v2 分桶数据（皮肤系统刚上线时的中间版本：经典 / 倾诉各挂一整份设置）。
 * 当前设计已否决它，但用户磁盘上可能还留着，迁移必须能识别并只取出 classic 桶。
 */
function bucketed(
  classic: Record<string, unknown>,
  tilt?: Record<string, unknown>
): Record<string, unknown> {
  return { skin: 'tilt', panels: tilt ? { classic, tilt } : { classic } }
}

describe('isBucketed 旧分桶结构识别', () => {
  it('顶层有 panels 对象 → true（真旧数据，需要迁移）', () => {
    expect(isBucketed({ panels: {} })).toBe(true)
    expect(isBucketed({ skin: 'tilt', panels: { classic: { lyricFontSize: 40 } } })).toBe(true)
  })

  it('panels 是数组 → false（typeof [] 也是 object，但它不可能是桶集合）', () => {
    expect(isBucketed({ panels: [] })).toBe(false)
  })

  it('扁平结构 / 空对象 / 只有 skin → false（v1 / v3 顶层直接是设置字段，永远没有 panels）', () => {
    expect(isBucketed({ skin: 'tilt' })).toBe(false)
    expect(isBucketed({})).toBe(false)
    expect(isBucketed({ lyricFontSize: 40 })).toBe(false)
  })
})

describe('settingsFromBucketed 取 classic 桶，只搬运已知键', () => {
  it('classic 桶里的已知键原样搬运，未知键不进结果（不会污染新结构）', () => {
    const result = settingsFromBucketed(bucketed({ lyricFontSize: 40, bgDim: 20, foo: 1 }))
    expect(result).toEqual({ lyricFontSize: 40, bgDim: 20 })
    expect(result).not.toHaveProperty('foo') // 更早版本删掉的字段
  })

  it('老数据没写过的键不出现（返回 Partial，由调用方保留默认值，不会被覆盖成 undefined）', () => {
    const result = settingsFromBucketed(bucketed({ lyricFontSize: 40 }))
    expect('bgDim' in result).toBe(false)
    expect('customFont' in result).toBe(false)
    expect('lyricContributorsDisplay' in result).toBe(false)
  })

  it('tilt 桶里的值不会漏进来（历史分桶按设计丢弃）', () => {
    const result = settingsFromBucketed(bucketed({ bgDim: 20 }, { lyricFontSize: 64, bgBlur: 1 }))
    expect(result).toEqual({ bgDim: 20 })
    expect('lyricFontSize' in result).toBe(false)
  })

  it('取不到 classic 桶 / classic 不是对象 → 空 Partial（调用方保留默认值，不覆盖成 undefined）', () => {
    expect(settingsFromBucketed({ skin: 'tilt', panels: {} })).toEqual({})
    expect(settingsFromBucketed({ panels: { tilt: { lyricFontSize: 40 } } })).toEqual({})
    expect(settingsFromBucketed({ panels: { classic: 'oops' } })).toEqual({})
    expect(settingsFromBucketed({ panels: { classic: ['oops'] } })).toEqual({})
  })

  it('panels 不是对象 → 空 Partial（数组 / 字符串 / 数字都不算桶集合）', () => {
    expect(settingsFromBucketed({ panels: [] })).toEqual({})
    expect(settingsFromBucketed({ panels: 'oops' })).toEqual({})
    expect(settingsFromBucketed({ panels: 1 })).toEqual({})
  })

  it('customFontFamily 旧格式 string 原样保留（本函数不做 normalize，调用方必须接着跑）', () => {
    const result = settingsFromBucketed(bucketed({ customFontFamily: 'SimSun' }))
    expect(result.customFontFamily).toBe('SimSun')
    expect(Array.isArray(result.customFontFamily)).toBe(false)
  })
})

describe('normalizeFontFamily 收编旧格式字体串', () => {
  /**
   * 造一个 customFontFamily 是旧格式的目标对象。真实来源是 localStorage 里未迁移的旧值
   * （string / 空串 / undefined），类型系统在这里必然说谎（声明是 string[]），
   * 只能显式越界断言 —— 这也正是 normalizeFontFamily 存在的理由。
   */
  function targetWithFontFamily(value: unknown): { customFontFamily: string[] } {
    return { customFontFamily: value as string[] }
  }

  it('string → 单元素数组，返回 true（发生了修改）', () => {
    const target = targetWithFontFamily('SimSun')
    expect(normalizeFontFamily(target)).toBe(true)
    expect(target.customFontFamily).toEqual(['SimSun'])
  })

  it('幂等：第二次调用返回 false 且值不变（数组再包一层会变成嵌套数组）', () => {
    const target = targetWithFontFamily('SimSun')
    normalizeFontFamily(target)
    expect(normalizeFontFamily(target)).toBe(false)
    expect(target.customFontFamily).toEqual(['SimSun'])
  })

  it('空串 / undefined / null → []（返回 true，同样要写回）', () => {
    for (const empty of ['', undefined, null]) {
      const target = targetWithFontFamily(empty)
      expect(normalizeFontFamily(target)).toBe(true)
      expect(target.customFontFamily).toEqual([])
    }
  })

  it('已经是数组 → 返回 false 且**引用不变**（不白造新数组，否则每次启动都写盘）', () => {
    const family = ['A', 'B']
    const target = targetWithFontFamily(family)
    expect(normalizeFontFamily(target)).toBe(false)
    expect(target.customFontFamily).toBe(family)
  })
})

describe('normalizeFoliaSettings 补齐 / 纠正嵌套设置', () => {
  it('旧存档完全没有 folia → 补默认对象，返回 true', () => {
    const target: { folia?: Record<string, unknown> } = {}
    expect(normalizeFoliaSettings(target)).toBe(true)
    expect(target.folia).toEqual(createDefaultSettings().folia)
  })

  it('合法 folia 原样保留且返回 false（bootstrap 不会无谓写盘）', () => {
    const folia: Record<string, unknown> = {
      ...createDefaultSettings().folia,
      colorScheme: 'light',
      subtitleContentMode: 'translation',
      subtitleBlur: false,
      colorMode: 'mono',
      backgroundModes: {
        tilt: 'sora',
        glow: 'native',
        fume: 'latent'
      },
      backgroundOpacity: 42,
      backgroundBlur: 8,
      wordColoring: false
    }
    const target = { folia: { ...folia } }
    expect(normalizeFoliaSettings(target)).toBe(false)
    expect(target.folia).toEqual(folia)
  })

  it('部分字段缺失 → 只补缺失项，已有合法值不变', () => {
    const target: { folia?: Record<string, unknown> } = {
      folia: { colorScheme: 'light', colorMode: 'daylight' }
    }
    expect(normalizeFoliaSettings(target)).toBe(true)
    expect(target.folia).toMatchObject({
      colorScheme: 'light',
      colorMode: 'daylight',
      subtitleContentMode: 'both',
      subtitleBlur: true,
      backgroundModes: {
        tilt: 'native',
        glow: 'native',
        fume: 'native'
      },
      backgroundOpacity: 100,
      backgroundBlur: 0,
      wordColoring: true
    })
  })

  it('非法枚举 / 非布尔 / 非数字 → 回退默认；数值越界 → 钳制', () => {
    const target: { folia?: Record<string, unknown> } = {
      folia: {
        colorScheme: 'sepia',
        subtitleContentMode: 'lyrics',
        subtitleBlur: 'yes',
        colorMode: 'rainbow',
        backgroundModes: {
          tilt: 'unknown',
          glow: 'common',
          fume: 'url'
        },
        backgroundOpacity: 900,
        backgroundBlur: -10,
        wordColoring: 'yes'
      }
    }
    expect(normalizeFoliaSettings(target)).toBe(true)
    expect(target.folia).toEqual({
      colorScheme: 'dark',
      subtitleContentMode: 'both',
      subtitleBlur: true,
      colorMode: 'song',
      backgroundModes: {
        tilt: 'native',
        glow: 'native',
        fume: 'native'
      },
      backgroundOpacity: 100,
      backgroundBlur: 0,
      wordColoring: true
    })

    const clamped: { folia?: Record<string, unknown> } = {
      folia: { backgroundOpacity: -5, backgroundBlur: 999 }
    }
    normalizeFoliaSettings(clamped)
    expect(clamped.folia).toMatchObject({ backgroundOpacity: 0, backgroundBlur: 40 })
  })

  it('旧 backgroundMode=url 回退 native，不会渲染空背景', () => {
    const target: { folia?: Record<string, unknown> } = {
      folia: {
        ...createDefaultSettings().folia,
        backgroundMode: 'url'
      }
    }
    delete (target.folia as Record<string, unknown>).backgroundModes

    expect(normalizeFoliaSettings(target, 'tilt')).toBe(true)
    expect(target.folia).toMatchObject({
      backgroundModes: { tilt: 'native', glow: 'native', fume: 'native' }
    })
  })

  it('旧字段 backgroundMode 只迁移到持久化主题，并且只迁移一次', () => {
    const target: { folia?: Record<string, unknown> } = {
      folia: {
        ...createDefaultSettings().folia,
        backgroundMode: 'sora'
      }
    }
    delete (target.folia as Record<string, unknown>).backgroundModes

    expect(normalizeFoliaSettings(target, 'fume')).toBe(true)
    expect(target.folia).toMatchObject({
      backgroundModes: { tilt: 'native', glow: 'native', fume: 'sora' }
    })
    expect(target.folia).not.toHaveProperty('backgroundMode')

    const before = JSON.stringify(target.folia)
    expect(normalizeFoliaSettings(target, 'fume')).toBe(false)
    expect(JSON.stringify(target.folia)).toBe(before)
  })

  it('历史 classic 皮肤把旧背景迁移到流光的槽位', () => {
    const target: { folia?: Record<string, unknown> } = {
      folia: {
        ...createDefaultSettings().folia,
        backgroundMode: 'monet'
      }
    }
    delete (target.folia as Record<string, unknown>).backgroundModes

    normalizeFoliaSettings(target, 'classic')
    expect(target.folia).toMatchObject({
      backgroundModes: { tilt: 'native', glow: 'monet', fume: 'native' }
    })
  })

  it('部分 backgroundModes 只补缺失键，非法值与 url 各自回退 native', () => {
    const target: { folia?: Record<string, unknown> } = {
      folia: {
        ...createDefaultSettings().folia,
        backgroundModes: {
          tilt: 'sora',
          fume: 'url'
        }
      }
    }

    expect(normalizeFoliaSettings(target, 'tilt')).toBe(true)
    expect(target.folia).toMatchObject({
      backgroundModes: { tilt: 'sora', glow: 'native', fume: 'native' }
    })
  })

  it('流光历史 common 归一为 native，设置页不再出现重复项', () => {
    const target: { folia?: Record<string, unknown> } = {
      folia: {
        ...createDefaultSettings().folia,
        backgroundModes: {
          tilt: 'common',
          glow: 'common',
          fume: 'common'
        }
      }
    }

    expect(normalizeFoliaSettings(target, 'glow')).toBe(true)
    expect(target.folia).toMatchObject({
      backgroundModes: { tilt: 'common', glow: 'native', fume: 'common' }
    })
  })

  it('folia 不是对象（null / 数组 / 字符串）→ 整体回退默认对象', () => {
    for (const bad of [null, [], 'oops', 42]) {
      const target: { folia?: unknown } = { folia: bad }
      expect(normalizeFoliaSettings(target as { folia?: Record<string, unknown> })).toBe(true)
      expect(target.folia).toEqual(createDefaultSettings().folia)
    }
  })
})

describe('sanitizeSkinId 非法皮肤 id 纠偏', () => {
  const ALLOWED = ['classic', 'tilt'] as const

  it('合法值原样返回', () => {
    expect(sanitizeSkinId('classic', ALLOWED, 'classic')).toBe('classic')
    expect(sanitizeSkinId('tilt', ALLOWED, 'classic')).toBe('tilt')
  })

  it('非法值一律返回 fallback（未注册 id / 空串 / 大小写不符）', () => {
    expect(sanitizeSkinId('bogus', ALLOWED, 'classic')).toBe('classic')
    expect(sanitizeSkinId('', ALLOWED, 'classic')).toBe('classic')
    expect(sanitizeSkinId('Tilt', ALLOWED, 'classic')).toBe('classic')
    expect(sanitizeSkinId('ghost', ALLOWED, 'tilt')).toBe('tilt')
  })
})

describe('store：扁平设置 + 全局皮肤 id 的初始状态', () => {
  it('skin 从默认皮肤起步，设置字段逐项等于默认值（不存在按面板分家的第二份）', () => {
    const store = useSettings()
    expect(store.skin).toBe(DEFAULT_SKIN_ID)
    expect(snapshotState(store)).toEqual({ ...defaultsRecord(), skin: DEFAULT_SKIN_ID })
    // 分桶结构已删除：state 里再出现 panels 就是设计回退了
    expect(store).not.toHaveProperty('panels')
  })
})

describe('store：切换面板（applySkin 是唯一入口）', () => {
  it('applySkin 只改 skin；设置字段一个都没变（设置只有一份，不随面板切换而改）', () => {
    const store = useSettings()
    // 先改点东西 —— 这样断言的是「设置原样保留」，而不只是「没被重置成默认值」
    store.lyricFontSize = 40
    const before = snapshotState(store)

    store.applySkin('tilt')

    expect(store.skin).toBe('tilt')
    expect(snapshotState(store)).toEqual({ ...before, skin: 'tilt' })
  })

  it('设置字段直接写在 store 顶层（扁平结构，没有面板桶中转）', () => {
    const store = useSettings()
    store.lyricFontSize = 40
    expect(store.lyricFontSize).toBe(40)
  })
})

describe('store.migrateBucketedSettings 旧分桶数据 → 扁平设置', () => {
  it('只取 classic 桶：lyricFontSize 取自 classic（不是 tilt 的 64），其余字段逐项保持默认', () => {
    seedStorage({
      skin: 'tilt',
      panels: {
        classic: { lyricFontSize: 40, bgDim: 20, customFontFamily: 'SimSun', foo: 1 },
        tilt: { lyricFontSize: 64 }
      }
    })
    const store = useSettings()

    expect(store.migrateBucketedSettings()).toBe(true)

    expect(store.lyricFontSize).toBe(40) // 来自 classic 桶
    expect(store.bgDim).toBe(20)
    // 未知键连 state 都不该进（settingsFromBucketed 按当前默认值的键集过滤）
    expect(store).not.toHaveProperty('foo')
    // 老数据没写过的键保留默认值（而不是 undefined）
    expect(store.lyricFontWeight).toBe(500)
    // 全局项 skin 不受迁移影响（它已由插件 hydrate 恢复进来）
    expect(store.skin).toBe('tilt')
    // 最强断言：除字体链（classic 桶带着旧 string，另有断言）外，其余字段整体逐项等于默认值
    expect(settingsOnly(snapshotState(store))).toEqual({
      ...settingsOnly(defaultsRecord()),
      lyricFontSize: 40,
      bgDim: 20
    })
  })

  it('迁移 → 落盘 → 再迁移：第二次返回 false 且状态不变（幂等）', () => {
    seedStorage(bucketed({ lyricFontSize: 40 }))
    const store = useSettings()
    expect(store.migrateBucketedSettings()).toBe(true)
    store.$persist() // bootstrapSettings 在 changed 时的写回：storage 换成扁平新结构
    const before = snapshotState(store)

    expect(store.migrateBucketedSettings()).toBe(false)
    expect(snapshotState(store)).toEqual(before)
  })

  it('不是分桶数据一律返回 false 且状态不变：空 storage / 扁平新结构 / 垃圾 / 数组 / 非 JSON', () => {
    const store = useSettings()
    const before = snapshotState(store)
    expect(store.migrateBucketedSettings()).toBe(false) // storage 为空

    for (const raw of [
      { skin: 'tilt' }, // 已是扁平新结构（正常升级路径，无需迁移）
      { foo: 1 }, // 两个判据都没有的垃圾对象
      [1, 2, 3], // 数组：typeof 也是 object，但绝不是设置对象
      'not an object'
    ]) {
      seedStorage(raw)
      expect(store.migrateBucketedSettings()).toBe(false)
    }

    seedStorage('{ 这可不是 JSON')
    expect(store.migrateBucketedSettings()).toBe(false)

    // 全程一次都没动过状态（快照逐字段对比，比抽查一两个字段严格）
    expect(snapshotState(store)).toEqual(before)
  })

  it('迁移后 $persist() 落盘的键集合 = 默认设置的全部键 + skin，且不含 panels', () => {
    seedStorage(bucketed({ lyricFontSize: 40 }))
    const store = useSettings()
    store.migrateBucketedSettings()
    store.$persist()

    const persisted = JSON.parse(storage.getItem(PERSIST_KEY) as string) as Record<string, unknown>
    // pick 的键集从 createDefaultSettings() 推导（见 store 的 PERSISTED_KEYS 注释）；
    // 缺键 = 有设置在磁盘上悄悄不存在，多键 = 有字段未经设计就落盘
    expect(Object.keys(persisted).sort()).toEqual(
      [...Object.keys(createDefaultSettings()), 'skin'].sort()
    )
    // 旧桶结构不能漏进新数据：迁移完还带着 panels 说明写回时 pick 失效了
    expect(persisted).not.toHaveProperty('panels')
  })
})

describe('store.bootstrapSettings 启动引导', () => {
  it('旧扁平存档没有 folia → bootstrap 补默认对象并写回', () => {
    const legacy = defaultsRecord()
    delete legacy.folia
    seedStorage({ ...legacy, skin: 'glow' })
    const store = useSettings()

    store.bootstrapSettings()

    expect(store.folia).toEqual(createDefaultSettings().folia)
    store.$persist()
    const persisted = JSON.parse(storage.getItem(PERSIST_KEY) as string) as Record<string, unknown>
    expect(persisted.folia).toEqual(createDefaultSettings().folia)
  })

  it('非法 Folia 字段在 bootstrap 时被纠正，经典设置不受影响', () => {
    const raw = defaultsRecord()
    raw.folia = {
      colorScheme: 'nope',
      subtitleContentMode: 'nope',
      subtitleBlur: 'nope',
      colorMode: 'nope',
      backgroundModes: {
        tilt: 'nope',
        glow: 'nope',
        fume: 'nope'
      },
      backgroundOpacity: 900,
      backgroundBlur: -1,
      wordColoring: 1
    }
    seedStorage({ ...raw, skin: 'fume', lyricFontSize: 40 })
    const store = useSettings()

    store.bootstrapSettings()

    expect(store.lyricFontSize).toBe(40)
    expect(store.folia).toEqual(createDefaultSettings().folia)
    expect(store.skin).toBe('fume')
  })

  it('迁移后把旧字体串收成数组（迁移 → normalize 的顺序不能反），并写回新结构', () => {
    seedStorage(bucketed({ customFontFamily: 'SimSun' }))
    const store = useSettings()

    store.bootstrapSettings()

    // 旧值是 string（'SimSun'）：若顺序反了这里还是 string，use-backdrop 的 .map() 直接崩
    expect(store.customFontFamily).toEqual(['SimSun'])
    expect(store.skin).toBe('tilt') // 合法 skin 不该被顺手改掉
    // 写回的就是新结构（plugins 的 pick / 迁移结果都反映在这一份落盘里）
    const persisted = JSON.parse(storage.getItem(PERSIST_KEY) as string) as Record<string, unknown>
    expect(Object.keys(persisted).sort()).toEqual(
      [...Object.keys(createDefaultSettings()), 'skin'].sort()
    )
  })

  it('幂等：第二次 bootstrap 不改状态、也不再写盘（用写入次数判定，不是比字符串）', () => {
    seedStorage(bucketed({ lyricFontSize: 40, customFontFamily: 'SimSun' }))
    const store = useSettings()
    store.bootstrapSettings() // 首次：迁移 + normalize 都有改动 → 写回
    const before = snapshotState(store)
    const writes = storage.writes

    store.bootstrapSettings()

    expect(storage.writes).toBe(writes) // 未 changed → 不 $persist（不是「原样重写了一遍」）
    expect(snapshotState(store)).toEqual(before)
  })

  it('非法 skin 纠正成默认皮肤并写回（垃圾值不能永久留在盘上），设置不受牵连', () => {
    seedStorage({ skin: 'ghost-skin', panels: { classic: { lyricFontSize: 40 } } })
    const store = useSettings()
    // 插件 hydrate 会原样恢复非法 skin（getter 只兜底读取，值本身还是错的）
    expect(store.skin).toBe('ghost-skin')

    store.bootstrapSettings()

    expect(store.skin).toBe(DEFAULT_SKIN_ID)
    expect(store.lyricFontSize).toBe(40) // classic 桶带过来的值没被顺手清掉
    const persisted = JSON.parse(storage.getItem(PERSIST_KEY) as string) as { skin: string }
    expect(persisted.skin).toBe(DEFAULT_SKIN_ID)
  })

  it('残留的旧字段（settingsTarget / panels）既不进 state，也不会被写回盘上', () => {
    seedStorage({
      skin: 'classic',
      settingsTarget: 'tilt',
      panels: { classic: { lyricFontSize: 40 } }
    })
    const store = useSettings()

    store.bootstrapSettings()
    store.$persist() // 显式写一次：确保断言的是「写回后的盘上内容」

    // 旧字段连 state 都不进：settingsTarget 被 pick 挡在 hydrate 外，
    // panels 由迁移自己读完就地丢掉（见 store 的 migrateBucketedSettings 说明）
    expect(store).not.toHaveProperty('settingsTarget')
    expect(store).not.toHaveProperty('panels')
    expect(store.lyricFontSize).toBe(40) // 有废字段也不影响已知键照常迁移
    const persisted = JSON.parse(storage.getItem(PERSIST_KEY) as string) as Record<string, unknown>
    expect(Object.keys(persisted).sort()).toEqual(
      [...Object.keys(createDefaultSettings()), 'skin'].sort()
    )
  })
})
