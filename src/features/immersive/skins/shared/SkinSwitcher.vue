<script setup lang="ts">
import { computed } from 'vue'
import { SkinOutlined } from '@ant-design/icons-vue'

import { useImmersiveSettingsStore } from '@/features/immersive/immersive-settings.store'
import { getSkin, skins } from '@/features/immersive/skins/registry'
import { useImmersivePanels } from '@/features/immersive/use-immersive-panels'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import type { SkinId } from '@/features/immersive/skins/types'

/**
 * 沉浸页顶部的面板主题切换按钮 —— **面板主题的唯一入口**（点击展开面板列表，
 * 选择即切并自动收起）。
 *
 * 「唯一」是 2026-10-11 用户明确要求的：设置面板里的「样式」tab 与页内切换条都已删除，
 * 「歌词面板样式是在外部设置，直接在顶部控制栏里选歌词面板的主题」。设置面板里不再有
 * 任何切换入口。
 *
 * **位置在控制栏第一排、紧挨设置按钮左侧**（同样是用户明确要求：「主题切换按钮直接放到
 * 设置旁边，不要放到第二排」）。两个按钮的列位关系见下面样式里的 right 计算。
 *
 * `hasSettings` 由外壳传入（= 当前面板有没有设置）：
 *  - true（经典）—— 设置按钮在，本按钮让位到它左侧（right:184 / 全屏 right:96）
 *  - false（倾诉）—— 设置按钮不存在，本按钮**占住那一格**（right:140 / 全屏 right:52），
 *    否则顶部那一排会空出一个洞
 *
 * ⚠️ z-index 必须高于设置面板（`.immersive-settings` 是 7）：展开的列表向下挂，
 * 正好落在设置面板所在的区域，z-index 不够就会被整个盖住 —— 而它是唯一入口，
 * 盖住就等于切不了。
 *
 * 2026-10-20 起两者**互斥**（谁开谁关，见 `use-immersive-panels`），正常情况下不会再
 * 同屏；z-index 这条留着是因为开关之间有过渡帧 —— 收起设置面板的 0.2s 里列表已经在
 * 展开，没有这层高度差就会看到列表从设置面板底下钻出来。
 *
 * 跟随 idle 显隐（与关闭按钮一致，共用 immersive-close-hidden），演示模式下隐藏。
 */
defineProps<{
  /** 当前面板是否自带设置（= 设置按钮是否存在）。见 skins/types.ts 的 SkinDefinition.hasSettings */
  hasSettings: boolean
}>()

const settings = useImmersiveSettingsStore()
const { idle } = useImmersivePlayer()

// 展开状态与设置面板**互斥**（见 use-immersive-panels）：两个弹层落点重叠，
// 同时开着会互相盖住；写入单一槽位即抢占，点设置按钮会顺手把这个列表收掉。
const panels = useImmersivePanels()
const expanded = panels.isOpen('skins')

// 高亮当前生效皮肤：持久化值无效时与外壳一致地回退到默认皮肤
const activeId = computed(() => getSkin(settings.skin).id)

function toggleExpanded(): void {
  panels.toggle('skins')
}

function select(id: SkinId): void {
  settings.applySkin(id)
  panels.close('skins')
}
</script>

<template>
  <div
    v-if="!settings.presentationMode"
    class="skin-switcher"
    :class="{ 'immersive-close-hidden': idle, 'no-settings': !hasSettings }"
  >
    <button
      type="button"
      class="skin-switcher-trigger"
      :class="{ expanded }"
      :aria-label="expanded ? '收起面板列表' : '切换歌词面板'"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      <SkinOutlined />
    </button>

    <Transition name="skin-switcher-fade">
      <div v-if="expanded" class="skin-switcher-panel">
        <button
          v-for="s in skins"
          :key="s.id"
          type="button"
          class="skin-switcher-item"
          :class="{ active: s.id === activeId }"
          @click="select(s.id)"
        >
          <span class="skin-switcher-item-name">{{ s.name }}</span>
          <span class="skin-switcher-item-desc">{{ s.desc }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.skin-switcher {
  position: fixed;
  // 控制栏第一排：与关/最小化/最大化/设置**同一行同一尺寸**（都是 top:8、36×36）。
  // 本按钮原先是控制条下方的悬浮胶囊（30×30，top:56），2026-10-11 挪到第一排后
  // 尺寸没跟着改，比兄弟按钮小一圈 —— 见下方 .skin-switcher-trigger 的注释。
  top: 8px;
  // 设置按钮 right:140（36 宽）+ 8px 间距 = 184。两者同一排、紧挨着。
  // 全屏档与「当前面板没有设置」档的覆写在 immersive-shell.scss（那些规则要看根元素状态）。
  right: 184px;
  // 高于设置面板(.immersive-settings 的 7)：展开的列表向下挂，正好落在面板区域，
  // 不高于它就会被整个盖住 —— 而本按钮是面板主题的唯一入口，盖住 = 切不了。
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  -webkit-app-region: no-drag;
  transition: opacity 0.3s ease;
}

.skin-switcher-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  // 与同排的关/最小化/最大化/设置按钮**逐值相同**（36×36、图标继承 16px 字号）：
  // 它现在跟它们是兄弟按钮，不再是自己一个人挂在下方的胶囊。改这里记得对齐
  // immersive-shell.scss 里那四个按钮的宽高。
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1);
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  // 不写 font-size：与那四个按钮一样继承基准字号（图标是 1em），
  // 原先写死 15px 是配合 30px 的小圆，现在跟着兄弟走
  cursor: pointer;
  transition:
    background 0.2s ease,
    opacity 0.2s ease,
    transform 0.2s ease;

  &:hover,
  &.expanded {
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.2);
  }
}

.skin-switcher-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 168px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(var(--rnp-accent-color-bg-rgb, 20, 20, 20), 0.78);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.skin-switcher-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rnp-accent-color-shade-2, var(--color-text-primary));
  text-align: left;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: rgba(var(--rnp-accent-color-shade-2-rgb, 255, 255, 255), 0.1);
  }

  &.active {
    background: var(--rnp-accent-color, var(--color-primary));
    color: var(--rnp-accent-color-on-primary, #fff);
  }
}

.skin-switcher-item-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.skin-switcher-item-desc {
  font-size: 11px;
  line-height: 1.3;
  opacity: 0.7;
}

.skin-switcher-fade-enter-active,
.skin-switcher-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.skin-switcher-fade-enter-from,
.skin-switcher-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
