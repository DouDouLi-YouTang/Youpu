<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { DashboardOutlined } from '@ant-design/icons-vue'

import {
  getLowMemoryStatus as fetchLowMemoryStatus,
  setLowMemoryMode,
  type LowMemoryStatus
} from '@/platform/electron/low-memory'
import { isElectronRuntime } from '@/platform/electron/commands'

const available = isElectronRuntime()
const enabled = ref(false)
const busy = ref(false)

async function loadStatus(): Promise<void> {
  if (!available) return
  try {
    const status: LowMemoryStatus = await fetchLowMemoryStatus()
    enabled.value = status.mode === 'on'
  } catch {
    /* 读取失败保持默认(关),下次切换会覆盖 */
  }
}

async function handleSwitch(checked: boolean): Promise<void> {
  if (!available) {
    enabled.value = false
    return
  }
  busy.value = true
  try {
    await setLowMemoryMode(checked ? 'on' : 'off')
    enabled.value = checked
  } catch {
    await loadStatus()
  } finally {
    busy.value = false
  }
}

onMounted(loadStatus)
</script>

<template>
  <section class="settings-card">
    <div class="settings-card__head">
      <span class="settings-card__icon"><DashboardOutlined /></span>
      <div>
        <h3 class="settings-card__title">低内存模式</h3>
        <p class="settings-card__sub">最小化到托盘后释放渲染进程占用的内存</p>
      </div>
    </div>
    <div class="settings-card__rows">
      <div class="settings-row">
        <div class="settings-row__meta">
          <p class="settings-row__label">回收渲染进程</p>
          <p class="settings-row__hint">
            窗口最小化到托盘后一段时间即回收，约省 200–400MB
            内存。音频由独立的小进程引擎播放，音乐不中断；重新打开窗口自动恢复界面与歌单。
          </p>
        </div>
        <a-switch :checked="enabled" :disabled="!available || busy" @change="handleSwitch" />
      </div>
    </div>
  </section>
</template>

<!-- 卡片皮肤(settings-card / settings-row / …)定义在 settings-card-skin.scss。
     父页 SettingsPage.vue 的那份是 scoped,只能作用到本组件的根元素,内部节点
     拿不到任何样式 —— 会出现"设置卡片掉皮"(无边框圆角、标题挤成一团)。
     与父页同一份皮肤、各自 scoped 引入:规则带各自的 data-v,互不污染。 -->
<style scoped lang="scss" src="../settings-card-skin.scss"></style>
