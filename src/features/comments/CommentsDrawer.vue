<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { CloseOutlined, FireFilled } from '@ant-design/icons-vue'

import { useCommentsContent } from './use-comments-content'
import { useCommentsPanel } from './use-comments-panel'
import CommentItem from './CommentItem.vue'

const { open, title, mode, close } = useCommentsPanel()
const drawerOpen = computed(() => open.value && mode.value === 'drawer')

const {
  bucket,
  likingId,
  sort,
  sortOptions,
  showHot,
  listTitle,
  onSortChange,
  onLoadMore,
  onRetry,
  onLike,
  isInitialLoading,
  isListLoading
} = useCommentsContent(() => drawerOpen.value)

const headerTitle = computed(() => title.value || '评论')
const totalHint = computed(() => {
  const n = bucket.value?.list.length ?? 0
  if (!bucket.value?.listLoaded) return ''
  if (bucket.value.hasMore) return `${n}+ 条`
  return n > 0 ? `${n} 条` : ''
})

const scrollRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function tryLoadMore(): void {
  const b = bucket.value
  if (!b || !b.hasMore || b.loadingMore || b.loading || b.error) return
  onLoadMore()
}

function bindObserver(): void {
  observer?.disconnect()
  observer = null
  const root = scrollRef.value
  const target = sentinelRef.value
  if (!root || !target || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) tryLoadMore()
    },
    { root, rootMargin: '180px 0px', threshold: 0 }
  )
  observer.observe(target)
}

function setScrollRef(el: Element | ComponentPublicInstance | null): void {
  scrollRef.value = (el as HTMLElement | null) ?? null
}

function setSentinelRef(el: Element | ComponentPublicInstance | null): void {
  sentinelRef.value = (el as HTMLElement | null) ?? null
}

watch(
  [drawerOpen, () => bucket.value?.list.length, () => bucket.value?.listLoaded, isInitialLoading],
  async ([isOpen]) => {
    if (!isOpen) {
      observer?.disconnect()
      observer = null
      return
    }
    await nextTick()
    bindObserver()
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

function onScroll(): void {
  const el = scrollRef.value
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) tryLoadMore()
}
</script>

<template>
  <a-drawer
    :open="drawerOpen"
    placement="right"
    :width="400"
    :closable="false"
    root-class-name="comment-drawer-root"
    :body-style="{
      padding: 0,
      height: '100%',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg-primary)'
    }"
    @close="close"
  >
    <template #title>
      <div class="comment-drawer__title-row">
        <div class="min-w-0">
          <h2 class="comment-drawer__title">{{ headerTitle }}</h2>
          <p v-if="totalHint" class="comment-drawer__sub">{{ totalHint }}</p>
        </div>
        <button type="button" class="comment-drawer__close" aria-label="关闭" @click="close">
          <CloseOutlined />
        </button>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <div v-if="isInitialLoading" class="flex flex-1 items-center justify-center">
        <a-spin tip="加载评论中…" />
      </div>
      <div
        v-else-if="bucket?.error && bucket.list.length === 0 && !bucket.listLoaded"
        class="flex flex-1 flex-col items-center justify-center gap-3 px-4"
      >
        <a-empty :description="bucket.error.message" />
        <a-button size="small" @click="onRetry">重试</a-button>
      </div>
      <template v-else>
        <div class="comment-drawer__tabs-wrap">
          <div class="comment-drawer__tabs">
            <button
              v-for="opt in sortOptions"
              :key="String(opt.value)"
              type="button"
              class="comment-drawer__tab"
              :class="{ 'comment-drawer__tab--on': sort === opt.value }"
              @click="onSortChange(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div
          :ref="setScrollRef"
          class="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4"
          @scroll.passive="onScroll"
        >
          <section v-if="showHot && bucket && bucket.hot.length > 0">
            <div class="comment-drawer__heading">
              <FireFilled class="text-[#ff5a36]" />
              精彩评论
              <span class="comment-drawer__count">{{ bucket.hot.length }}</span>
            </div>
            <CommentItem
              v-for="(item, idx) in bucket.hot"
              :key="`hot-${item.id}`"
              :comment="item"
              hot
              :like-busy="likingId !== null"
              :enter-delay-ms="Math.min(idx, 10) * 40"
              @like="onLike"
            />
          </section>

          <section>
            <div class="comment-drawer__heading">
              {{ listTitle }}
              <span v-if="bucket?.list.length" class="comment-drawer__count">
                {{ bucket.list.length }}{{ bucket.hasMore ? '+' : '' }}
              </span>
            </div>

            <div
              v-if="isListLoading"
              class="flex items-center justify-center gap-2 py-12 text-xs text-text-secondary"
            >
              <a-spin size="small" />
              正在切换排序…
            </div>
            <div
              v-else-if="bucket?.error && bucket.list.length === 0"
              class="flex flex-col items-center gap-3 py-10"
            >
              <a-empty :description="bucket.error.message" />
              <a-button size="small" @click="onRetry">重试</a-button>
            </div>
            <a-empty
              v-else-if="bucket && bucket.listLoaded && bucket.list.length === 0"
              description="暂无评论，来抢沙发吧"
              class="!py-12"
            />
            <template v-else>
              <CommentItem
                v-for="(item, idx) in bucket?.list ?? []"
                :key="item.id"
                :comment="item"
                :like-busy="likingId !== null"
                :enter-delay-ms="Math.min(idx, 14) * 38"
                @like="onLike"
              />
            </template>

            <div
              v-if="bucket && bucket.list.length > 0"
              :ref="setSentinelRef"
              class="comment-drawer__end"
            >
              <template v-if="bucket.loadingMore">
                <a-spin size="small" />
                <span>加载中…</span>
              </template>
              <button
                v-else-if="bucket.error"
                type="button"
                class="comment-drawer__retry"
                @click="onRetry"
              >
                加载失败，点此重试
              </button>
              <span v-else-if="!bucket.hasMore">已经到底啦</span>
              <span v-else class="opacity-60">继续下滑加载</span>
            </div>
          </section>
        </div>
      </template>
    </div>
  </a-drawer>
</template>

<style scoped lang="scss">
// .comment-drawer__* 为 a-drawer 标题/默认插槽内容，由本组件模板渲染；Teleport 不会剥离 data-v，可用普通 scoped 选择器命中。
// .comment-drawer-root（root-class-name 包装层）挂载于 body、无 data-v，样式在同目录 cmt-drawer.global.scss 中维护。

.comment-drawer {
  &__title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
  }

  &__title {
    margin: 0;
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: 15px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__sub {
    margin: 2px 0 0;
    color: var(--color-text-muted);
    font-size: 11.5px;
  }

  &__close {
    display: grid;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;

    &:hover {
      background: var(--color-control);
      color: var(--color-text-primary);
    }
  }

  &__tabs-wrap {
    flex-shrink: 0;
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-bg-secondary) 90%, transparent);
  }

  &__tabs {
    display: flex;
    gap: 3px;
    padding: 3px;
    border-radius: 999px;
    background: var(--color-control);
  }

  &__tab {
    flex: 1;
    height: 28px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;

    &--on {
      background: var(--color-bg-elevated);
      color: var(--color-text-primary);
      font-weight: 650;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }
  }

  &__heading {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 14px 10px 4px;
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 750;
  }

  &__count {
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 500;
  }

  &__end {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 14px 0 4px;
    color: var(--color-text-muted);
    font-size: 12px;
  }

  &__retry {
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--color-control);
    color: var(--color-text-primary);
    font-size: 12px;
    cursor: pointer;
  }
}
</style>
<style lang="scss" src="./cmt-drawer.global.scss"></style>
