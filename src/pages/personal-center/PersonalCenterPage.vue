<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  CalendarOutlined,
  CustomerServiceOutlined,
  HeartFilled,
  PlayCircleOutlined
} from '@ant-design/icons-vue'

import PlaylistCard from '@/components/music/PlaylistCard.vue'
import type { PersonalCenterSection } from '@/domain/personal-center'
import type { UserPlayRecord } from '@/domain/personal-center'
import { usePersonalCenterStore } from '@/stores/personal-center.store'
import { usePlayerStore } from '@/stores/player.store'

/**
 * 个人中心展示策略(对照接口文档):
 * 有用:
 *  - 资料/VIP/签到 /user/detail + /daily_signin
 *  - 听歌等级 /user/level
 *  - 听歌排行 周/总 /user/record
 *  - 创建/收藏歌单 /user/playlist
 *  - 喜欢音乐 /likelist
 *  - 收藏歌手/专辑 /artist/sublist /album/sublist
 * 去掉:
 *  - 账号绑定(无操作价值)
 *  - 收藏 MV / 电台(桌面播放器几乎用不到)
 */
const router = useRouter()
const store = usePersonalCenterStore()
const player = usePlayerStore()

type RecordTab = 'week' | 'all'
type PlaylistTab = 'created' | 'subscribed'

const profile = computed(() => store.profile)
const stats = computed(() => store.stats)
const level = computed(() => store.level)
const createdPlaylists = computed(() => store.playlists.created)
const subscribedPlaylists = computed(() => store.playlists.subscribed)
const likedCount = computed(() => store.likedSongs.count)
const collections = computed(() => store.collections)
const dailySignin = computed(() => store.dailySignin)

const recordTab = ref<RecordTab>('week')
const playlistTab = ref<PlaylistTab>('created')

const records = computed<UserPlayRecord[]>(() =>
  recordTab.value === 'week' ? store.recordsWeek : store.recordsAll
)

const activePlaylists = computed(() =>
  playlistTab.value === 'created' ? createdPlaylists.value : subscribedPlaylists.value
)

const vipText = computed(() => {
  const vip = profile.value?.vipType
  if (!vip) return null
  if (vip === 11) return '黑椒 VIP'
  if (vip > 0) return 'VIP 会员'
  return null
})

const overviewStats = computed(() => [
  { key: 'liked', label: '喜欢音乐', value: likedCount.value },
  {
    key: 'created',
    label: '创建歌单',
    value: stats.value?.playlistCount ?? createdPlaylists.value.length
  },
  { key: 'sub', label: '收藏歌单', value: subscribedPlaylists.value.length },
  {
    key: 'artist',
    label: '收藏歌手',
    value: stats.value?.artistCount ?? collections.value.artistCount
  },
  {
    key: 'album',
    label: '收藏专辑',
    value: stats.value?.albumCount ?? collections.value.albumCount
  },
  {
    key: 'play',
    label: '累计听歌',
    value: level.value?.nowPlayCount ?? 0
  }
])

function isMaxLevel(): boolean {
  return level.value?.full === true
}

function levelProgressPercent(): number {
  if (isMaxLevel()) return 100
  const p = level.value?.progress
  if (p == null || !Number.isFinite(p)) return 0
  const normalized = p <= 1 ? p * 100 : p
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

function openArtist(id: number): void {
  void router.push(`/artist/${id}`)
}

function openAlbum(id: number): void {
  void router.push(`/album/${id}`)
}

function openPlaylist(id: number): void {
  void router.push(`/playlist/${id}`)
}

function playRecord(list: UserPlayRecord[], index: number): void {
  if (list.length === 0) return
  const songs = list.map((r) => r.song)
  player.playFromList(songs, index, 'manual')
}

function playAllRecords(): void {
  if (records.value.length === 0) return
  playRecord(records.value, 0)
}

async function handleSignin(): Promise<void> {
  await store.doDailySignin()
  if (dailySignin.value.message) {
    if (dailySignin.value.signed) message.success(dailySignin.value.message)
    else message.warning(dailySignin.value.message)
  }
}

async function retrySection(section: PersonalCenterSection): Promise<void> {
  await store.reloadSection(section)
}

async function retryAll(): Promise<void> {
  await store.loadCurrentUserCenter(true)
}

function thumbUrl(url?: string, size = 80): string | undefined {
  if (!url) return undefined
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}param=${size}y${size}`
}

onMounted(() => {
  void store.loadCurrentUserCenter(true)
})
</script>

<template>
  <section class="personal-center-page">
    <div v-if="store.loading && !profile" class="personal-center-state">
      <a-spin tip="加载个人中心中…" />
    </div>

    <div
      v-else-if="store.error && !profile"
      class="personal-center-state personal-center-state--column"
    >
      <a-empty :description="store.error.message" />
      <a-button size="small" @click="retryAll">重试</a-button>
    </div>

    <template v-else-if="profile">
      <!-- Hero：资料 + 签到 + 等级摘要 -->
      <header class="personal-center-hero">
        <div aria-hidden="true" class="personal-center-hero__visual">
          <div
            class="personal-center-hero__cover"
            :style="{
              backgroundImage:
                profile.backgroundUrl || profile.avatarUrl
                  ? `url('${profile.backgroundUrl || profile.avatarUrl}')`
                  : 'none'
            }"
          ></div>
          <div class="personal-center-hero__veil"></div>
        </div>

        <div class="personal-center-hero__body">
          <div class="personal-center-hero__avatar">
            <img
              v-if="profile.avatarUrl"
              :src="profile.avatarUrl"
              :alt="profile.nickname"
              referrerpolicy="no-referrer"
            />
            <span v-else>{{ profile.nickname.charAt(0).toUpperCase() }}</span>
          </div>

          <div class="min-w-0 flex-1">
            <div class="personal-center-hero__name-row">
              <h1 class="personal-center-hero__name">{{ profile.nickname }}</h1>
              <span v-if="vipText" class="personal-center-hero__vip">{{ vipText }}</span>
              <span v-if="level" class="personal-center-hero__level">Lv.{{ level.level }}</span>
            </div>
            <p v-if="profile.signature" class="personal-center-hero__signature">
              {{ profile.signature }}
            </p>
            <p v-if="level" class="personal-center-hero__listen">
              累计听歌 {{ level.nowPlayCount ?? 0 }} 次
              <template v-if="level.nowLoginCount != null">
                · 登录 {{ level.nowLoginCount }} 天
              </template>
            </p>
          </div>

          <button
            type="button"
            class="personal-center-daily-signin"
            :class="{ 'personal-center-daily-signin--done': dailySignin.signed }"
            :disabled="dailySignin.signed || store.sectionLoading.dailySignin"
            @click="handleSignin"
          >
            <CalendarOutlined />
            {{
              store.sectionLoading.dailySignin
                ? '签到中…'
                : dailySignin.signed
                  ? '今日已签'
                  : '每日签到'
            }}
          </button>
        </div>
      </header>

      <div class="personal-center-body">
        <!-- 关键概览：只留有用的数 -->
        <section class="personal-center-card">
          <div class="personal-center-card__head">
            <h3 class="personal-center-card__title">音乐资产</h3>
          </div>
          <div class="personal-center-stats">
            <div v-for="item in overviewStats" :key="item.key" class="personal-center-stat">
              <p class="personal-center-stat__value">{{ item.value }}</p>
              <p class="personal-center-stat__label">{{ item.label }}</p>
            </div>
          </div>
        </section>

        <!-- 听歌等级 -->
        <section v-if="level || store.sectionErrors.level" class="personal-center-card">
          <div class="personal-center-card__head">
            <h3 class="personal-center-card__title">听歌等级</h3>
            <button
              v-if="store.sectionErrors.level"
              type="button"
              class="personal-center-link-btn"
              @click="retrySection('level')"
            >
              重试
            </button>
          </div>
          <div v-if="store.sectionErrors.level" class="personal-center-empty">
            {{ store.sectionErrors.level.message }}
          </div>
          <div v-else-if="level" class="personal-center-level">
            <div class="personal-center-level__top">
              <span class="personal-center-level__badge">Lv.{{ level.level }}</span>
              <span class="personal-center-level__percent">{{ levelProgressPercent() }}%</span>
            </div>
            <div class="personal-center-level__bar">
              <div
                class="personal-center-level__fill"
                :style="{ width: `${levelProgressPercent()}%` }"
              ></div>
            </div>
            <div class="personal-center-level__meta">
              <template v-if="isMaxLevel()">
                <span class="personal-center-level__max">已达最高等级</span>
              </template>
              <template v-else>
                <span v-if="level.nextPlayCount != null"
                  >下一级还需听歌约 {{ level.nextPlayCount }} 次</span
                >
                <span v-if="level.nextLoginCount != null"
                  >还需登录 {{ level.nextLoginCount }} 天</span
                >
              </template>
            </div>
          </div>
        </section>

        <!-- 听歌排行：周 / 总，可直接播放 -->
        <section class="personal-center-card">
          <div class="personal-center-card__head">
            <h3 class="personal-center-card__title">听歌排行</h3>
            <div class="personal-center-tabs">
              <button
                type="button"
                class="personal-center-tab"
                :class="{ 'personal-center-tab--on': recordTab === 'week' }"
                @click="recordTab = 'week'"
              >
                最近一周
              </button>
              <button
                type="button"
                class="personal-center-tab"
                :class="{ 'personal-center-tab--on': recordTab === 'all' }"
                @click="recordTab = 'all'"
              >
                所有时间
              </button>
            </div>
          </div>

          <div v-if="store.sectionErrors.records" class="personal-center-empty">
            {{ store.sectionErrors.records.message }}
            <button type="button" class="personal-center-link-btn" @click="retrySection('records')">
              重试
            </button>
          </div>
          <div v-else-if="records.length === 0" class="personal-center-empty">
            {{ recordTab === 'week' ? '本周还没有听歌记录' : '暂无听歌记录' }}
          </div>
          <template v-else>
            <div class="personal-center-rank-toolbar">
              <span class="personal-center-rank-toolbar__count">共 {{ records.length }} 首</span>
              <button type="button" class="personal-center-play-all" @click="playAllRecords">
                <PlayCircleOutlined />
                播放全部
              </button>
            </div>
            <div class="personal-center-records">
              <button
                v-for="(item, idx) in records"
                :key="`${recordTab}-${item.song.id}-${idx}`"
                type="button"
                class="personal-center-record"
                @click="playRecord(records, idx)"
              >
                <span
                  class="personal-center-record__idx"
                  :class="{ 'personal-center-record__idx--top': idx < 3 }"
                >
                  {{ idx + 1 }}
                </span>
                <span class="personal-center-record__cover">
                  <img
                    v-if="thumbUrl(item.song.coverUrl)"
                    :src="thumbUrl(item.song.coverUrl)"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                  <CustomerServiceOutlined v-else />
                </span>
                <span class="personal-center-record__meta">
                  <span class="personal-center-record__name">{{ item.song.name }}</span>
                  <span class="personal-center-record__artist">
                    {{ item.song.artists.map((a) => a.name).join(' / ') || '未知' }}
                  </span>
                </span>
                <span class="personal-center-record__count">{{ item.playCount }} 次</span>
              </button>
            </div>
          </template>
        </section>

        <!-- 我的歌单：创建 / 收藏 -->
        <section class="personal-center-card">
          <div class="personal-center-card__head">
            <h3 class="personal-center-card__title">我的歌单</h3>
            <div class="personal-center-tabs">
              <button
                type="button"
                class="personal-center-tab"
                :class="{ 'personal-center-tab--on': playlistTab === 'created' }"
                @click="playlistTab = 'created'"
              >
                创建 {{ createdPlaylists.length }}
              </button>
              <button
                type="button"
                class="personal-center-tab"
                :class="{ 'personal-center-tab--on': playlistTab === 'subscribed' }"
                @click="playlistTab = 'subscribed'"
              >
                收藏 {{ subscribedPlaylists.length }}
              </button>
            </div>
          </div>

          <div v-if="store.sectionErrors.playlists" class="personal-center-empty">
            {{ store.sectionErrors.playlists.message }}
            <button
              type="button"
              class="personal-center-link-btn"
              @click="retrySection('playlists')"
            >
              重试
            </button>
          </div>
          <div v-else-if="activePlaylists.length === 0" class="personal-center-empty">
            {{ playlistTab === 'created' ? '还没有创建歌单' : '还没有收藏歌单' }}
          </div>
          <div v-else class="personal-center-playlist-grid">
            <PlaylistCard
              v-for="(pl, idx) in activePlaylists.slice(0, 12)"
              :key="pl.id"
              :playlist="pl"
              :liked="pl.specialType === 5"
              :subtitle="`${pl.trackCount} 首`"
              :enter-delay-ms="Math.min(idx, 10) * 30"
              @open="openPlaylist(pl.id)"
            />
          </div>
          <div v-if="activePlaylists.length > 12" class="personal-center-more">
            <a-button type="link" @click="router.push('/library')">查看全部歌单</a-button>
          </div>
        </section>

        <!-- 收藏：只保留歌手 + 专辑 -->
        <section class="personal-center-card">
          <div class="personal-center-card__head">
            <h3 class="personal-center-card__title">收藏</h3>
            <button
              v-if="store.sectionErrors.collections"
              type="button"
              class="personal-center-link-btn"
              @click="retrySection('collections')"
            >
              重试
            </button>
          </div>
          <div v-if="store.sectionErrors.collections" class="personal-center-empty">
            {{ store.sectionErrors.collections.message }}
          </div>
          <div v-else class="personal-center-collections">
            <div class="personal-center-collection-group">
              <div class="personal-center-collection-group__head">
                <span>歌手</span>
                <span class="personal-center-collection-group__count">{{
                  collections.artistCount
                }}</span>
              </div>
              <div
                v-if="collections.artists.length === 0"
                class="personal-center-empty personal-center-empty--sm"
              >
                暂无收藏歌手
              </div>
              <div v-else class="personal-center-collection-list">
                <button
                  v-for="a in collections.artists.slice(0, 10)"
                  :key="a.id"
                  type="button"
                  class="personal-center-collection-item"
                  @click="openArtist(a.id)"
                >
                  <img
                    v-if="thumbUrl(a.picUrl)"
                    :src="thumbUrl(a.picUrl)"
                    alt=""
                    class="personal-center-collection-item__thumbnail personal-center-collection-item__thumbnail--round"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                  <span
                    v-else
                    class="personal-center-collection-item__thumbnail personal-center-collection-item__thumbnail--round"
                    >♪</span
                  >
                  <span class="personal-center-collection-item__name">{{ a.name }}</span>
                </button>
              </div>
            </div>

            <div class="personal-center-collection-group">
              <div class="personal-center-collection-group__head">
                <span>专辑</span>
                <span class="personal-center-collection-group__count">{{
                  collections.albumCount
                }}</span>
              </div>
              <div
                v-if="collections.albums.length === 0"
                class="personal-center-empty personal-center-empty--sm"
              >
                暂无收藏专辑
              </div>
              <div v-else class="personal-center-collection-list">
                <button
                  v-for="a in collections.albums.slice(0, 10)"
                  :key="a.id"
                  type="button"
                  class="personal-center-collection-item"
                  @click="openAlbum(a.id)"
                >
                  <img
                    v-if="thumbUrl(a.picUrl)"
                    :src="thumbUrl(a.picUrl)"
                    alt=""
                    class="personal-center-collection-item__thumbnail"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                  <span v-else class="personal-center-collection-item__thumbnail">♪</span>
                  <span class="min-w-0">
                    <span class="personal-center-collection-item__name">{{ a.name }}</span>
                    <span v-if="a.artistName" class="personal-center-collection-item__sub">{{
                      a.artistName
                    }}</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 喜欢音乐入口 -->
        <section class="personal-center-liked-entry">
          <HeartFilled class="personal-center-liked-entry__ico" />
          <div class="min-w-0 flex-1">
            <p class="personal-center-liked-entry__title">我喜欢的音乐</p>
            <p class="personal-center-liked-entry__sub">共 {{ likedCount }} 首红心歌曲</p>
          </div>
          <a-button type="primary" @click="router.push('/library')">打开歌单</a-button>
        </section>
      </div>
    </template>

    <div v-else class="personal-center-state personal-center-state--column">
      <a-empty description="请先登录后查看个人中心">
        <a-button type="primary" @click="router.push('/login?redirect=/me')">去登录</a-button>
      </a-empty>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.pc-page {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.pc-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 24px;

  &--col {
    flex-direction: column;
    gap: 12px;
  }
}

.pc-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 28px 24px 24px;

  &__visual {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
  }

  &__cover {
    position: absolute;
    inset: -40px;
    background-position: center;
    background-size: cover;
    filter: blur(48px) saturate(1.12);
    opacity: 0.55;
    transform: scale(1.1);
  }

  &__veil {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(
        180deg,
        rgba(12, 14, 16, 0.4) 0%,
        rgba(12, 14, 16, 0.55) 45%,
        color-mix(in srgb, var(--color-bg-primary) 92%, $color-black) 100%
      ),
      linear-gradient(90deg, rgba(10, 12, 14, 0.4), transparent 60%);
  }

  &__body {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 18px 20px;
  }

  &__avatar {
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 50%;
    background: var(--color-control);
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.35),
      0 0 0 3px rgba(255, 255, 255, 0.12);

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
      color: $color-white;
      font-size: 32px;
      font-weight: 700;
    }
  }

  &__name-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  &__name {
    margin: 0;
    color: $color-white;
    font-size: 28px;
    font-weight: 750;
    letter-spacing: -0.02em;
    line-height: 1.15;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  }

  &__vip {
    height: 22px;
    padding: 0 8px;
    border-radius: 6px;
    background: linear-gradient(120deg, #f5d78e, #e8b84a);
    color: #3a2a08;
    font-size: 11px;
    font-weight: 700;
    line-height: 22px;
  }

  &__lv {
    height: 22px;
    padding: 0 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.16);
    color: $color-white;
    font-size: 11px;
    font-weight: 700;
    line-height: 22px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  }

  &__sign {
    margin: 8px 0 0;
    max-width: 36rem;
    color: rgba(255, 255, 255, 0.78);
    font-size: 13px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  &__listen {
    margin: 8px 0 0;
    color: rgba(255, 255, 255, 0.72);
    font-size: 12.5px;
  }
}

.pc-signin {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--color-primary);
  color: $color-white;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  box-shadow: 0 8px 22px color-mix(in srgb, var(--color-primary) 40%, transparent);

  &:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  &:disabled {
    cursor: default;
    opacity: 0.9;
  }

  &--done {
    background: rgba(255, 255, 255, 0.18);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
  }
}

.pc-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 960px;
  margin: 0 auto;
  padding: 8px 20px 40px;
}

.pc-card {
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-bg-secondary);
  padding: 14px 16px 16px;

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  &__title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 15px;
    font-weight: 700;
  }
}

.pc-link-btn {
  border: 0;
  background: transparent;
  color: var(--color-primary);
  font-size: 12px;
  cursor: pointer;
}

.pc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 8px;
  color: var(--color-text-muted);
  font-size: 13px;
  text-align: center;

  &--sm {
    padding: 16px 4px;
    font-size: 12px;
  }
}

.pc-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  @media (min-width: 720px) {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.pc-stat {
  padding: 14px 10px;
  border-radius: 12px;
  background: var(--color-control);
  text-align: center;

  &__value {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 20px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  &__label {
    margin: 6px 0 0;
    color: var(--color-text-muted);
    font-size: 11.5px;
  }
}

.pc-tabs {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  background: var(--color-control);
}

.pc-tab {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;

  &--on {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    font-weight: 650;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }
}

.pc-level {
  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  &__badge {
    display: inline-flex;
    height: 28px;
    align-items: center;
    padding: 0 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 16%, transparent);
    color: var(--color-primary);
    font-size: 13px;
    font-weight: 750;
  }

  &__pct {
    color: var(--color-text-secondary);
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  &__bar {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-control);
  }

  &__fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-primary) 70%, $color-white),
      var(--color-primary)
    );
    transition: width 0.35s ease;
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    margin-top: 12px;
    color: var(--color-text-secondary);
    font-size: 12px;
  }

  &__max {
    color: var(--color-primary);
    font-weight: 600;
  }
}

.pc-rank-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;

  &__n {
    color: var(--color-text-muted);
    font-size: 12px;
  }
}

.pc-play-all {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 22%, transparent);
  }
}

.pc-records {
  display: flex;
  flex-direction: column;
  max-height: 420px;
  overflow-y: auto;
}

.pc-record {
  display: grid;
  grid-template-columns: 28px 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--color-control);
  }

  &__idx {
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;

    &--top {
      color: var(--color-primary);
    }
  }

  &__cover {
    width: 40px;
    height: 40px;
    overflow: hidden;
    border-radius: 8px;
    background: var(--color-control);
    color: var(--color-text-muted);
    display: grid;
    place-items: center;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__name {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__artist {
    overflow: hidden;
    color: var(--color-text-muted);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__count {
    color: var(--color-text-muted);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
}

.pc-playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px 12px;
}

.pc-more {
  display: flex;
  justify-content: center;
  margin-top: 8px;
}

.pc-collections {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;

  @media (min-width: 720px) {
    grid-template-columns: 1fr 1fr;
  }
}

.pc-col-block {
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 650;
  }

  &__n {
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 500;
  }
}

.pc-col-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 360px;
  overflow-y: auto;
}

.pc-col-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--color-control);
  }

  &__av {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 8px;
    background: var(--color-control);
    color: var(--color-text-muted);
    font-size: 12px;
    object-fit: cover;

    &--round {
      border-radius: 50%;
    }
  }

  &__name {
    display: block;
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: 12.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__sub {
    display: block;
    overflow: hidden;
    color: var(--color-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.pc-liked {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 16px;
  background: linear-gradient(
    120deg,
    color-mix(in srgb, #ff4d6d 18%, var(--color-bg-secondary)),
    var(--color-bg-secondary)
  );
  border: 1px solid color-mix(in srgb, #ff4d6d 22%, var(--color-border));

  &__ico {
    color: #ff4d6d;
    font-size: 22px;
  }

  &__title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 14px;
    font-weight: 700;
  }

  &__sub {
    margin: 2px 0 0;
    color: var(--color-text-secondary);
    font-size: 12px;
  }
}
</style>

<!-- package-0.1.21 拆分样式（家族: pc）：置于所有旧内联块之后，靠 cascade 后者赢复现原 #app 前缀压过关系 -->
<style scoped lang="scss" src="./personal-center.scss"></style>
