<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { CloseOutlined, FireFilled } from '@ant-design/icons-vue'

import { useCommentsContent } from './use-comments-content'
import { useCommentsPanel } from './use-comments-panel'
import CommentItem from './CommentItem.vue'

const { open, mode, title, close } = useCommentsPanel()
const viewOpen = computed(() => open.value && mode.value === 'page')

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
} = useCommentsContent(() => viewOpen.value)

const headerTitle = computed(() => title.value || '评论')
const totalHint = computed(() => {
  const n = bucket.value?.list.length ?? 0
  if (!bucket.value?.listLoaded) return ''
  if (bucket.value.hasMore) return `${n}+ 条评论`
  return n > 0 ? `${n} 条评论` : '暂无评论'
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
    { root, rootMargin: '240px 0px', threshold: 0 }
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
  [viewOpen, () => bucket.value?.list.length, () => bucket.value?.listLoaded, isInitialLoading],
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
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) tryLoadMore()
}
</script>

<template>
  <Transition name="comment-view">
    <section v-if="viewOpen" class="comment-view" aria-label="评论区">
      <header class="comment-view__bar">
        <div class="comment-view__heading min-w-0">
          <h2 class="comment-view__title">{{ headerTitle }}</h2>
          <p class="comment-view__sub">{{ totalHint }}</p>
        </div>
        <div class="comment-view__tabs" role="tablist" aria-label="排序">
          <button
            v-for="opt in sortOptions"
            :key="String(opt.value)"
            type="button"
            role="tab"
            class="comment-view__tab"
            :class="{ 'comment-view__tab--on': sort === opt.value }"
            :aria-selected="sort === opt.value"
            @click="onSortChange(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <button type="button" class="comment-view__close" aria-label="关闭评论" @click="close">
          <CloseOutlined />
        </button>
      </header>

      <div :ref="setScrollRef" class="comment-view__scroll" @scroll.passive="onScroll">
        <div v-if="isInitialLoading" class="comment-view__state">
          <a-spin tip="加载评论中…" />
        </div>
        <div
          v-else-if="bucket?.error && bucket.list.length === 0 && !bucket.listLoaded"
          class="comment-view__state flex-col gap-3"
        >
          <a-empty :description="bucket.error.message" />
          <a-button size="small" @click="onRetry">重试</a-button>
        </div>
        <div v-else class="comment-view__sheet">
          <!-- 精彩评论 -->
          <section v-if="showHot && bucket && bucket.hot.length > 0" class="comment-view__section">
            <div class="comment-view__section-heading">
              <span class="comment-view__fire"><FireFilled /></span>
              精彩评论
              <span class="comment-view__count">{{ bucket.hot.length }}</span>
            </div>
            <div class="comment-view__list">
              <CommentItem
                v-for="(item, idx) in bucket.hot"
                :key="`hot-${item.id}`"
                :comment="item"
                hot
                :like-busy="likingId !== null"
                :enter-delay-ms="Math.min(idx, 10) * 40"
                @like="onLike"
              />
            </div>
          </section>

          <!-- 列表 -->
          <section class="comment-view__section">
            <div class="comment-view__section-heading">
              {{ listTitle }}
              <span v-if="bucket?.list.length" class="comment-view__count">
                {{ bucket.list.length }}{{ bucket.hasMore ? '+' : '' }}
              </span>
            </div>

            <div v-if="isListLoading" class="comment-view__state comment-view__state--sm">
              <a-spin size="small" />
              <span class="ml-2 text-xs text-text-secondary">正在切换排序…</span>
            </div>
            <div
              v-else-if="bucket?.error && bucket.list.length === 0"
              class="comment-view__state flex-col gap-3 py-10"
            >
              <a-empty :description="bucket.error.message" />
              <a-button size="small" @click="onRetry">重试</a-button>
            </div>
            <a-empty
              v-else-if="bucket && bucket.listLoaded && bucket.list.length === 0"
              description="暂无评论，来抢沙发吧"
              class="!py-16"
            />
            <div v-else class="comment-view__list">
              <CommentItem
                v-for="(item, idx) in bucket?.list ?? []"
                :key="item.id"
                :comment="item"
                :like-busy="likingId !== null"
                :enter-delay-ms="Math.min(idx, 14) * 38"
                @like="onLike"
              />
            </div>

            <div
              v-if="bucket && bucket.list.length > 0"
              :ref="setSentinelRef"
              class="comment-view__end"
            >
              <template v-if="bucket.loadingMore">
                <a-spin size="small" />
                <span>加载中…</span>
              </template>
              <button
                v-else-if="bucket.error"
                type="button"
                class="comment-view__retry"
                @click="onRetry"
              >
                加载失败，点此重试
              </button>
              <span v-else-if="!bucket.hasMore" class="comment-view__end-txt">已经到底啦</span>
              <span v-else class="comment-view__end-txt comment-view__end-txt--dim"
                >继续下滑加载</span
              >
            </div>
          </section>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped lang="scss" src="./cmt-view.scss"></style>
