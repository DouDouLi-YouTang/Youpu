<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarOutlined, CaretRightOutlined } from '@ant-design/icons-vue'

import { useAuthStore } from '@/stores/auth.store'
import { useDailyStore } from '@/stores/daily.store'
import { useDiscoverStore } from '@/stores/discover.store'
import { usePlayerStore } from '@/stores/player.store'
import { useDiscoverLayout } from '@/composables/useDiscoverLayout'
import { useDiscoverEntrance } from '@/composables/useDiscoverEntrance'
import FmCard from './components/FmCard.vue'
import DiscoverTile from './components/DiscoverTile.vue'

const router = useRouter()
const auth = useAuthStore()
const dailyStore = useDailyStore()
const discoverStore = useDiscoverStore()
const player = usePlayerStore()

const containerRef = ref<HTMLElement | null>(null)
const fmRef = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)
const dailyRef = ref<HTMLElement | null>(null)
const stageCoverRef = ref<HTMLElement | null>(null)
const tileCount = computed(() => discoverStore.playlists.length)
const stageCoverUrl = computed(() => player.coverUrl ?? player.fmPreviewCoverUrl)
const today = new Date().getDate()

const { dailyPos, tilePositions, containerHeight } = useDiscoverLayout({
  containerRef,
  fmRef,
  count: tileCount,
  tileW: 120,
  tileH: 168,
  dailyW: 200,
  dailyH: 180,
  gap: 16
})

useDiscoverEntrance({
  containerRef,
  fmRef,
  headerRef,
  dailyRef,
  stageCoverRef,
  playlists: computed(() => discoverStore.playlists),
  tilePositions
})

function openPlaylist(id: number): void {
  void router.push('/playlist/' + id)
}

function goDaily(): void {
  void router.push('/daily')
}

/** 每日推荐:加载后从第一首开始播放(参考 DailyPage.vue 的 playAll)。 */
async function playDaily(): Promise<void> {
  if (!auth.isLoggedIn) return
  await dailyStore.loadDailySongs()
  if (dailyStore.songs.length === 0) return
  player.playFromList(dailyStore.songs, 0, 'daily')
}

function handleRetry(): void {
  void discoverStore.loadRecommendPlaylists()
}

onMounted(() => {
  void discoverStore.loadRecommendPlaylists()
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-6 overflow-y-auto px-4 py-4 pr-1">
    <header ref="headerRef">
      <h2 class="text-2xl font-semibold tracking-tight text-text-primary">发现音乐</h2>
      <p class="mt-1 text-sm text-text-secondary">从私人 FM 开始，继续探索新的歌单</p>
    </header>

    <!--
      布局画布:FM 钉左上角,每日推荐钉 FM 右侧第一行,歌单方块用 bin-packing 填满周围所有空隙。
      舞台外壳只提供氛围和留白,内画布仍由 useDiscoverLayout 测量并控制高度。
    -->
    <div class="discover-stage relative isolate w-full p-3">
      <div aria-hidden="true" class="discover-stage__visual pointer-events-none">
        <div
          ref="stageCoverRef"
          class="discover-stage__cover"
          :style="{ backgroundImage: stageCoverUrl ? `url('${stageCoverUrl}')` : 'none' }"
        ></div>
        <div class="discover-stage__veil"></div>
      </div>

      <div
        ref="containerRef"
        class="relative z-10 w-full"
        :style="{ height: containerHeight + 'px' }"
      >
        <!-- FM 卡:wrapper 承载尺寸 ref,FmCard 原样嵌入不改其样式逻辑 -->
        <div ref="fmRef" class="absolute left-0 top-0 z-20">
          <FmCard />
        </div>

        <!-- 每日推荐:查看与播放使用独立的原生按钮,避免嵌套交互 -->
        <div
          ref="dailyRef"
          class="discover-daily absolute z-10 h-[180px] w-[200px] shrink-0 transition-[left,top] duration-300 ease-out"
          :style="{ left: dailyPos.x + 'px', top: dailyPos.y + 'px' }"
        >
          <button
            type="button"
            class="discover-daily__open absolute inset-0 w-full rounded-2xl border border-[var(--color-border)] text-left shadow-sm transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label="查看每日推荐"
            @click="goDaily"
          ></button>
          <span class="discover-daily__date" aria-hidden="true">{{ today }}</span>
          <div class="pointer-events-none absolute inset-0 z-[1] flex flex-col justify-between p-4">
            <div class="flex items-center gap-2 text-[var(--color-primary)]">
              <CalendarOutlined class="text-xl" />
              <span class="text-sm font-medium text-text-secondary">每日推荐</span>
            </div>
            <div class="min-w-0 pr-11">
              <p class="truncate text-base font-bold text-text-primary">每日精选</p>
              <p class="mt-1 text-xs text-text-secondary">根据你的口味每日刷新</p>
            </div>
          </div>
          <button
            type="button"
            title="播放每日推荐"
            class="absolute bottom-4 right-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-[var(--color-primary)] text-white shadow-md transition-transform hover:brightness-110 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-elevated)]"
            aria-label="播放每日推荐"
            :disabled="!auth.isLoggedIn"
            @click="playDaily"
          >
            <CaretRightOutlined style="font-size: 14px" />
          </button>
        </div>

        <!-- 歌单方块:位置由 bin-packing 计算,填满 FM/每日推荐周围 -->
        <DiscoverTile
          v-for="(item, idx) in discoverStore.playlists"
          :key="item.id"
          class="z-10"
          :playlist="item"
          :x="tilePositions[idx]?.x ?? -9999"
          :y="tilePositions[idx]?.y ?? -9999"
          :w="tilePositions[idx]?.w ?? 120"
          @open="openPlaylist(item.id)"
        />
      </div>
    </div>

    <!-- Error -->
    <div v-if="discoverStore.error" class="flex flex-1 flex-col items-center justify-center gap-3">
      <a-empty :description="discoverStore.error.message" />
      <a-button size="small" @click="handleRetry">重试</a-button>
    </div>

    <!-- 加载中 -->
    <div v-else-if="discoverStore.loading" class="flex justify-center py-10">
      <a-spin />
    </div>

    <!-- 空 -->
    <a-empty v-else-if="!discoverStore.playlists.length" description="暂无推荐" class="py-10" />
  </section>
</template>

<style lang="scss" scoped>
.discover-stage {
  &__visual {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 20px;
    background: var(--color-bg-secondary);
    box-shadow: 0 16px 36px color-mix(in srgb, var(--color-border) 45%, transparent);
  }

  &__cover {
    position: absolute;
    inset: -24px;
    background-position: center;
    background-size: cover;
    filter: blur(22px);
    opacity: 0.82;
    transform: scale(1.06);
  }

  &__veil {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-bg-primary) 78%, transparent),
        color-mix(in srgb, var(--color-bg-secondary) 74%, transparent)
      ),
      color-mix(in srgb, var(--color-bg-elevated) 62%, transparent);
  }
}

.discover-daily__open {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-elevated)),
    var(--color-bg-elevated)
  );
}

.discover-daily__date {
  position: absolute;
  right: 0.75rem;
  top: 0.25rem;
  z-index: 1;
  font-size: 3rem;
  font-weight: 700;
  line-height: 1;
  color: color-mix(in srgb, var(--color-primary) 22%, transparent);
  pointer-events: none;
}
</style>
