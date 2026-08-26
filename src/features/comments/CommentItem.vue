<script setup lang="ts">
import { computed } from 'vue'
import { HeartFilled, HeartOutlined } from '@ant-design/icons-vue'

import type { Comment } from '@/domain/comment'
import { formatNumber, formatRelativeTime } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    comment: Comment
    /** Disables the like button (e.g. while a sibling toggle is in flight). */
    likeBusy?: boolean
    /** 热评样式 + 角标 */
    hot?: boolean
    /** 入场错开延迟(ms) */
    enterDelayMs?: number
  }>(),
  {
    likeBusy: false,
    hot: false,
    enterDelayMs: 0
  }
)

defineEmits<{
  like: [commentId: number]
}>()

const timeLabel = computed(() => formatRelativeTime(props.comment.timeMs))
const likeLabel = computed(() => formatNumber(props.comment.likedCount))
const avatarFallback = computed(() => {
  const name = props.comment.user.nickname.trim()
  return name.charAt(0).toUpperCase() || '·'
})
</script>

<template>
  <article
    class="comment"
    :class="{ 'comment--hot': hot }"
    :style="{ '--d': `${Math.max(0, enterDelayMs)}ms` }"
  >
    <div class="comment__avatar" aria-hidden="true">
      <img
        v-if="comment.user.avatarUrl"
        :src="comment.user.avatarUrl"
        alt=""
        referrerpolicy="no-referrer"
        loading="lazy"
      />
      <span v-else>{{ avatarFallback }}</span>
    </div>
    <div class="comment__body">
      <header class="comment__head">
        <span class="comment__name" :title="comment.user.nickname">{{
          comment.user.nickname
        }}</span>
        <span v-if="hot" class="comment__badge">热评</span>
        <time class="comment__time">{{ timeLabel }}</time>
      </header>
      <p class="comment__content">{{ comment.content }}</p>
      <div v-if="comment.replyTo" class="comment__reply">
        <div class="comment__reply-bar" aria-hidden="true" />
        <div class="comment__reply-main">
          <span class="comment__reply-user">{{ comment.replyTo.user.nickname }}</span>
          <span class="comment__reply-text">{{ comment.replyTo.content }}</span>
        </div>
      </div>
      <footer class="comment__foot">
        <button
          type="button"
          class="comment__like"
          :class="{ 'comment__like--on': comment.liked }"
          :disabled="likeBusy"
          :aria-pressed="comment.liked"
          :aria-label="comment.liked ? '取消点赞' : '点赞'"
          @click="$emit('like', comment.id)"
        >
          <HeartFilled v-if="comment.liked" class="comment__heart" />
          <HeartOutlined v-else class="comment__heart" />
          <span class="comment__like-txt">{{ comment.likedCount > 0 ? likeLabel : '赞' }}</span>
        </button>
      </footer>
    </div>
  </article>
</template>

<style scoped lang="scss">
.comment {
  display: flex;
  gap: 12px;
  padding: 16px 4px 16px 2px;
  /* 每条独立入场：淡入 + 上浮，delay 由父级错开 */
  animation: comment-in 0.38s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--d, 0ms);

  + .comment {
    border-top: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  }

  &__avatar {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    margin-top: 2px;
    overflow: hidden;
    border-radius: 50%;
    background: var(--color-control);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-border) 65%, transparent);

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    span {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      color: var(--color-text-secondary);
      font-size: 14px;
      font-weight: 600;
    }
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    line-height: 1.25;
  }

  &__name {
    max-width: 50%;
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__badge {
    flex-shrink: 0;
    height: 18px;
    padding: 0 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-primary);
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    letter-spacing: 0.04em;
  }

  &__time {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--color-text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  &__content {
    margin: 6px 0 0;
    color: var(--color-text-primary);
    font-size: 14px;
    line-height: 1.7;
    letter-spacing: 0.01em;
    word-break: break-word;
    white-space: pre-wrap;
  }

  &__reply {
    display: flex;
    gap: 10px;
    margin-top: 10px;
    padding: 0;
  }

  &__reply-bar {
    width: 2px;
    flex-shrink: 0;
    border-radius: 2px;
    background: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
  }

  &__reply-main {
    min-width: 0;
    padding: 2px 0;
    color: var(--color-text-secondary);
    font-size: 12.5px;
    line-height: 1.55;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  &__reply-user {
    margin-right: 6px;
    color: var(--color-text-primary);
    font-weight: 600;
    opacity: 0.85;
  }

  &__foot {
    display: flex;
    align-items: center;
    margin-top: 10px;
  }

  &__like {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px 0 8px;
    margin-left: -8px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    cursor: pointer;
    transition:
      color 0.14s ease,
      background-color 0.14s ease;
  }

  // 目标是子组件（HeartFilled/HeartOutlined）根元素，Vue 会透传宿主 data-v，无需 :deep()
  &__heart {
    font-size: 14px;
  }

  &__like:hover:not(:disabled) {
    background: var(--color-control);
    color: var(--color-text-primary);
  }

  &__like--on {
    color: $color-danger;
  }

  &__like--on:hover:not(:disabled) {
    background: color-mix(in srgb, $color-danger 10%, transparent);
    color: $color-danger;
  }

  &__like:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  &--hot {
    .comment__badge {
      background: color-mix(in srgb, $color-hot 14%, transparent);
      color: $color-hot;
    }
  }
}

/* 条目之间用极细分割线（父列表最后一项可盖掉） */

/* 引用回复：细竖条 + 两行信息，不抢正文 */

@keyframes comment-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
