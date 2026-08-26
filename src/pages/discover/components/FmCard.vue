<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MessageOutlined, MoreOutlined, StepForwardOutlined } from '@ant-design/icons-vue'

import { usePlayerStore } from '@/stores/player.store'
import { useSettingsStore, type FmCardSize } from '@/stores/settings.store'
import { useImmersivePlayer } from '@/features/immersive/use-immersive-player'
import { useColorExtraction } from '@/features/immersive/use-color-extraction'
import { fetchCommentList } from '@/services/api/endpoints/comment.api'
import type { Comment } from '@/domain/comment'
import { formatNumber } from '@/utils/format'
import CtrlButton from '@/components/common/CtrlButton.vue'
import FluidBackground from './FluidBackground.vue'

const player = usePlayerStore()
const settings = useSettingsStore()
const { openPanel } = useImmersivePlayer()

/** FM 模式用当前播放封面,否则用预拉第一首封面做预览(无图标占位)。 */
const coverUrl = computed(() => (player.fmMode ? player.coverUrl : player.fmPreviewCoverUrl))
const { accentVars } = useColorExtraction(coverUrl)
const isPlaying = computed(() => {
  if (!player.isPlaying) return false
  return player.currentItem?.song.id === songId.value
})
const fmMode = computed(() => player.fmMode)

/** 播放按钮 SVG mask 唯一 id：白色圆 + 透明图标透出底层封面。 */
const fmPlayMaskId = `fm-play-mask-${Math.random().toString(36).slice(2, 8)}`

const size = computed<FmCardSize>(() => settings.fmCardSize)
const sizes: FmCardSize[] = ['large-h', 'large-v', 'medium-h', 'small']

/** 模块级评论缓存:songId -> { total, comments(按点赞降序) },切回同一首歌不重复请求。 */
const commentCache = new Map<number, { total: number; comments: Comment[] }>()

/** 当前歌曲 id:FM 模式取当前播放歌,否则取预拉第一首(与封面/歌名同一首)。 */
const songId = computed(() =>
  player.fmMode ? (player.currentItem?.song.id ?? null) : (player.fmPrefetchSongs[0]?.id ?? null)
)

/** 当前歌曲名(标题用);无歌名回退"私人 FM"。 */
const displayTitle = computed(() => {
  const name = player.fmMode ? player.currentItem?.song.name : player.fmPrefetchSongs[0]?.name
  return name ?? '私人 FM'
})

/** 当前歌曲评论总数;null 表示未加载/失败/无歌曲,不显示。 */
const commentTotal = ref<number | null>(null)
/** 当前歌曲轮播评论列表(按点赞降序)。 */
const comments = ref<Comment[]>([])
/** 轮播当前评论索引。 */
const commentIdx = ref(0)
/** 当前展示的评论。 */
const currentComment = computed(() => comments.value[commentIdx.value] ?? null)

watch(
  songId,
  async (id) => {
    commentIdx.value = 0
    if (id == null) {
      commentTotal.value = null
      comments.value = []
      return
    }
    if (commentCache.has(id)) {
      const cached = commentCache.get(id)!
      commentTotal.value = cached.total
      comments.value = cached.comments
      return
    }
    try {
      const r = await fetchCommentList({ type: 0, id }, { pageNo: 1, sort: 'hot' })
      // sort:'hot' 服务端按 likedCount 降序,客户端再排一次保险
      const sorted = r.comments.slice().sort((a, b) => b.likedCount - a.likedCount)
      commentCache.set(id, { total: r.total, comments: sorted })
      commentTotal.value = r.total
      comments.value = sorted
    } catch {
      commentTotal.value = null
      comments.value = []
    }
  },
  { immediate: true }
)

/** 评论轮播:多于 1 条时每 4 秒切换,切歌/卸载时清除。 */
let commentTimer: ReturnType<typeof setInterval> | null = null
watch(
  comments,
  (list) => {
    if (commentTimer) {
      clearInterval(commentTimer)
      commentTimer = null
    }
    if (list.length <= 1) return
    commentTimer = setInterval(() => {
      commentIdx.value = (commentIdx.value + 1) % list.length
    }, 8000)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (commentTimer) clearInterval(commentTimer)
})

/** 非 FM 模式时确保有预览封面:挂载/退出 FM/预览空时触发预拉(已登录才拉,幂等)。 */
watch(
  () => !player.fmMode && player.fmPreviewCoverUrl == null,
  (need) => {
    if (need) void player.prefetchFm()
  },
  { immediate: true }
)

/** 是否显示评论数：有数据且非 mini 尺寸。 */
const showComments = computed(() => commentTotal.value != null && size.value !== 'mini')

/** 评论数格式化文本。 */
const commentText = computed(() =>
  commentTotal.value != null ? formatNumber(commentTotal.value) : ''
)

/** 尺寸名称（用于 tooltip）。 */
const sizeNameMap: Record<FmCardSize, string> = {
  'large-h': '大（横）',
  'large-v': '大（竖）',
  'medium-h': '中',
  small: '小',
  mini: '迷你'
}

/** 各尺寸布局参数。 */
interface SizeLayout {
  width: number
  height: number
  radius: string
  cover: number
  showDesc: boolean
  showNext: boolean
  vertical: boolean
  /** 文字与按钮是否垂直排列（flex-col）；mini 保持水平 flex-row。 */
  textCol: boolean
  playSize: number
  nextSize: number
  padding: string
  /** 封面右边缘距卡片左的距离(含 padding+gap),medium-h/small 按钮组容器定位用 */
  coverRight?: number
  /** 封面宽高比(宽/高),默认 1 正方形;medium-h/small 用 2/3 竖向 */
  coverRatio?: number
}

const layoutMap: Record<FmCardSize, SizeLayout> = {
  'large-h': {
    width: 360,
    height: 180,
    radius: '1rem',
    cover: 126,
    showDesc: true,
    showNext: true,
    vertical: false,
    textCol: true,
    playSize: 46,
    nextSize: 32,
    padding: '1rem 1.25rem'
  },
  'large-v': {
    width: 280,
    height: 360,
    radius: '1rem',
    cover: 220,
    showDesc: true,
    showNext: true,
    vertical: true,
    textCol: true,
    playSize: 44,
    nextSize: 28,
    padding: '5rem 1.25rem 2rem'
  },
  'medium-h': {
    width: 280,
    height: 120,
    radius: '0.875rem',
    cover: 96,
    showDesc: true,
    showNext: true,
    vertical: false,
    textCol: true,
    playSize: 28,
    nextSize: 20,
    padding: '0.75rem 1rem',
    coverRight: 88,
    coverRatio: 2 / 3
  },
  small: {
    width: 220,
    height: 94,
    radius: '0.75rem',
    cover: 74,
    showDesc: true,
    showNext: true,
    vertical: false,
    textCol: true,
    playSize: 20,
    nextSize: 20,
    padding: '0.625rem 0.75rem',
    coverRight: 69,
    coverRatio: 2 / 3
  },
  mini: {
    width: 210,
    height: 64,
    radius: '9999px',
    cover: 44,
    showDesc: true,
    showNext: true,
    vertical: false,
    textCol: false,
    playSize: 26,
    nextSize: 18,
    padding: '0.25rem 0.625rem'
  }
}

const layout = computed<SizeLayout>(() => layoutMap[size.value])

const cardStyle = computed(() => ({
  width: `${layout.value.width}px`,
  height: `${layout.value.height}px`,
  borderRadius: layout.value.radius,
  '--color-primary': accentVars.value['--rnp-accent-color'] ?? undefined,
  '--cover-right': layout.value.coverRight ? `${layout.value.coverRight}px` : undefined
}))

const coverStyle = computed(() => {
  const ratio = layout.value.coverRatio ?? 1
  return {
    width: `${Math.round(layout.value.cover * ratio)}px`,
    height: `${layout.value.cover}px`
  }
})

function cycleSize(): void {
  const idx = sizes.indexOf(size.value)
  settings.fmCardSize = sizes[(idx + 1) % sizes.length]
}

async function startFm(): Promise<void> {
  if (player.currentItem?.song.id === songId.value) {
    player.togglePlay()
    return
  }
  await player.startFm()
}

/** 卡片点击:打开沉浸页(播放由播放按钮专门负责,点击卡片本身不播放)。
 *  无当前歌曲时(尚未播放任何歌曲)沉浸页只会空白,禁止点击打开。 */
function onCardClick(): void {
  if (!player.currentItem?.song) return
  openPanel()
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="fm-card group relative shrink-0 cursor-pointer overflow-hidden bg-black/30 text-white shadow-lg hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    :style="cardStyle"
    @click="onCardClick"
    @keydown.enter="onCardClick"
    @keydown.space.prevent="onCardClick"
  >
    <!-- 背景:large-v 用清晰封面(去模糊),其他尺寸用流体模糊背景 -->
    <img
      v-if="size === 'large-v' && coverUrl"
      :src="coverUrl"
      alt="心动雷达封面"
      class="pointer-events-none absolute inset-0 h-full w-full object-cover"
      referrerpolicy="no-referrer"
    />
    <div
      v-else-if="size === 'large-v'"
      class="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/60 to-[var(--color-primary)]/20"
    ></div>
    <FluidBackground v-else :cover-url="coverUrl" />
    <!-- 遮罩：竖版底部渐变保证白字可读，其他尺寸纯色 -->
    <div
      v-if="size === 'large-v'"
      class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent"
    ></div>
    <div v-else class="pointer-events-none absolute inset-0 bg-black/40"></div>

    <!-- 三点菜单：循环切换尺寸 -->
    <a-tooltip :title="sizeNameMap[size]">
      <button
        type="button"
        class="absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded-full bg-black/30 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
        aria-label="切换尺寸"
        @click.stop="cycleSize"
      >
        <MoreOutlined style="font-size: 14px" />
      </button>
    </a-tooltip>

    <!-- 左下角评论数（多少人在听这首歌的近似展示） -->
    <div
      v-if="showComments && size !== 'medium-h'"
      class="pointer-events-none absolute z-10 flex items-center gap-1 text-[10px] text-white/70"
      :class="size === 'large-v' ? 'right-10 top-2 h-6' : 'bottom-3 left-3'"
    >
      <MessageOutlined style="font-size: 11px" />
      <span>{{ commentText }}</span>
    </div>

    <!-- 主体内容 -->
    <div
      class="fm-content relative z-10 flex h-full"
      :class="
        layout.vertical
          ? 'flex-col items-center justify-end gap-2'
          : size === 'medium-h' || size === 'small' || size === 'mini'
            ? 'flex-row items-center gap-2'
            : 'flex-row items-center gap-3'
      "
      :style="{ padding: layout.padding }"
    >
      <!-- 封面:medium-h 用圆角卡片(不旋转),其他尺寸用圆形旋转 -->
      <div
        v-if="size !== 'large-v'"
        class="fm-cover relative shrink-0 overflow-hidden shadow-lg"
        :class="
          size === 'medium-h' || size === 'small'
            ? 'rounded-xl'
            : [isPlaying ? 'fm-cover--spin' : 'fm-cover--paused', 'rounded-full']
        "
        :style="coverStyle"
      >
        <img
          v-if="coverUrl"
          :src="coverUrl"
          alt="心动雷达封面"
          class="block h-full w-full object-cover"
          referrerpolicy="no-referrer"
        />
        <div
          v-else
          class="h-full w-full bg-gradient-to-br from-[var(--color-primary)]/60 to-[var(--color-primary)]/20"
        ></div>
      </div>

      <!-- 标题 + 描述 + 按钮 -->
      <div
        class="min-w-0 flex-1"
        :class="
          layout.textCol
            ? layout.vertical
              ? 'flex flex-col items-start w-full'
              : size === 'medium-h' || size === 'small'
                ? 'flex flex-col h-full justify-start'
                : 'flex flex-col h-full justify-center'
            : 'flex flex-row items-center gap-2'
        "
      >
        <!-- 标题 + 描述 -->
        <div :class="{ 'text-left': layout.vertical, 'flex-1 min-w-0': !layout.textCol }">
          <div
            v-if="layout.showDesc"
            class="inline-flex items-center gap-1 rounded-md bg-black/30 px-2.5 py-1 backdrop-blur-sm"
            :class="
              size === 'large-v'
                ? 'absolute left-3 top-3 z-10'
                : size === 'medium-h' || size === 'small'
                  ? 'mb-1.5 px-2 py-0.5'
                  : size === 'mini'
                    ? 'mb-0.5 px-1 py-0'
                    : 'mb-2.5'
            "
          >
            <span
              class="font-semibold leading-none"
              :class="
                size === 'medium-h'
                  ? 'text-[10px]'
                  : size === 'small'
                    ? 'text-[9px]'
                    : size === 'mini'
                      ? 'text-[8px]'
                      : 'text-xs'
              "
              >FM</span
            >
            <svg
              :width="size === 'mini' ? 9 : 12"
              :height="size === 'mini' ? 9 : 12"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="1" y="6" width="2.2" height="4" rx="1" />
              <rect x="5" y="3" width="2.2" height="10" rx="1" />
              <rect x="9" y="5" width="2.2" height="6" rx="1" />
              <rect x="13" y="2" width="2.2" height="12" rx="1" />
            </svg>
          </div>
          <p
            class="fm-title truncate font-bold leading-tight text-white"
            :style="{
              fontSize:
                size === 'medium-h'
                  ? '13px'
                  : size === 'small'
                    ? '15px'
                    : size === 'mini'
                      ? '13px'
                      : layout.showDesc
                        ? '16px'
                        : '14px'
            }"
          >
            {{ displayTitle }}
          </p>
          <p
            v-if="layout.showDesc && size !== 'small' && size !== 'mini'"
            class="mt-1 truncate text-white/70"
            :class="size === 'medium-h' ? 'text-[11px] leading-tight' : 'text-xs'"
          >
            {{ currentComment?.content ?? '暂无评论' }}
          </p>
        </div>

        <!-- 按钮区:medium-h 时评论数量与按钮同行对齐,其他尺寸跟随文本列流 -->
        <div
          class="flex shrink-0 items-center gap-2"
          :class="
            size === 'medium-h' || size === 'small'
              ? 'absolute bottom-3 left-[var(--cover-right)] right-3 z-10'
              : layout.vertical
                ? 'mt-auto'
                : { 'mt-4': layout.textCol }
          "
        >
          <!-- medium-h/small: 评论数量(封面右侧,与按钮同行中心对齐) -->
          <div
            v-if="(size === 'medium-h' || size === 'small') && showComments"
            class="flex items-center gap-1 text-[10px] text-white/70"
          >
            <MessageOutlined style="font-size: 11px" />
            <span>{{ commentText }}</span>
          </div>
          <!-- 播放/暂停 -->
          <button
            type="button"
            class="fm-play-btn"
            :class="size === 'medium-h' || size === 'small' ? 'ml-auto' : ''"
            :style="{ width: `${layout.playSize}px`, height: `${layout.playSize}px` }"
            aria-label="播放"
            @click.stop="startFm"
          >
            <svg viewBox="0 0 48 48" class="fm-play-svg">
              <defs>
                <mask :id="fmPlayMaskId">
                  <circle cx="24" cy="24" r="24" fill="white" />
                  <path v-if="!isPlaying" d="M19 14 L19 34 L34 24 Z" fill="black" />
                  <g v-else fill="black">
                    <rect x="17" y="14" width="5" height="20" rx="2" />
                    <rect x="26" y="14" width="5" height="20" rx="2" />
                  </g>
                </mask>
              </defs>
              <circle cx="24" cy="24" r="24" fill="#ffffff" :mask="`url(#${fmPlayMaskId})`" />
            </svg>
          </button>

          <!-- 下一曲 -->
          <CtrlButton
            v-if="layout.showNext"
            variant="ghost"
            :size="layout.nextSize"
            :disabled="!fmMode"
            aria-label="下一首"
            @click.stop="player.next()"
          >
            <StepForwardOutlined />
          </CtrlButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.fm-card {
  transition:
    transform 0.2s ease,
    width 0.3s ease,
    height 0.3s ease;
}

.fm-cover {
  transition:
    width 0.3s ease,
    height 0.3s ease;

  &--spin {
    animation: fm-spin 20s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  &--paused {
    animation: fm-spin 20s linear infinite;
    animation-play-state: paused;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }
}

.fm-play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  background: transparent;
  transition:
    transform 0.1s,
    filter 0.2s;

  &:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }
}

.fm-play-svg {
  width: 100%;
  height: 100%;
}

.fm-content {
  transition: padding 0.3s ease;
}

.fm-title {
  transition: font-size 0.3s ease;
}

@keyframes fm-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>

<!-- package-0.1.21 拆分样式（fm）：追加在上方旧内联块之后，同特异性下 cascade 后者赢，压住旧内联 -->
<style scoped lang="scss" src="./fm-card.package.scss"></style>
