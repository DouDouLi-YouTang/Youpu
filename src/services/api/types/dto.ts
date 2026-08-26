/**
 * Raw api-enhanced / NetEase response shapes. Field names mirror the upstream
 * abbreviations (`ar`, `al`, `dt`, `picUrl`) on purpose — conversion to the
 * readable domain model happens in the mapper layer, never here.
 *
 * Every field is optional-ish: NetEase omits or nulls fields depending on the
 * endpoint and resource, so consumers must treat them defensively. Mappers
 * provide the safe defaults.
 */

export interface ArtistDto {
  id: number
  name: string
}

export interface AlbumDto {
  id: number
  name: string
  picUrl?: string | null
  /** Primary artist (single). Present on `/album`, absent on the brief album ref in songs. */
  artist?: ArtistDto | null
  /** All credited artists. Present on `/album`. */
  artists?: ArtistDto[] | null
  description?: string | null
  /** Epoch ms. */
  publishTime?: number | null
  /** Track count. */
  size?: number | null
}

export interface SongDto {
  id: number
  name: string
  ar?: ArtistDto[] | null
  artists?: ArtistDto[] | null
  al?: AlbumDto | null
  album?: AlbumDto | null
  dt?: number | null
  duration?: number | null
  /** NetEase song alias names, usually surfaced as the single-page alias row. */
  alia?: string[] | null
  alias?: string[] | null
  /** Translated names returned by some endpoints. */
  tns?: string[] | null
  transNames?: string[] | null
}

export interface PlaylistCreatorDto {
  userId: number
  nickname: string
}

export interface PlaylistDto {
  id: number
  name: string
  coverImgUrl?: string | null
  picUrl?: string | null
  trackCount?: number | null
  tracks?: SongDto[] | null
  trackIds?: { id: number }[] | null
  creator?: PlaylistCreatorDto | null
  /** `5` = the user's "我喜欢的音乐" playlist. */
  specialType?: number | null
}

/** `/search?type=1` (single) response body. */
export interface SearchResponseDto {
  code: number
  result: {
    songs?: SongDto[] | null
    songCount?: number | null
  }
}

/** `/playlist/detail` response body. */
export interface PlaylistDetailResponseDto {
  code: number
  playlist: PlaylistDto
}

/** `/song/detail` response body. */
export interface SongDetailResponseDto {
  code: number
  songs: SongDto[]
}

/** Single entry in `/song/url/v1`'s `data` array. */
export interface SongUrlDataDto {
  id: number
  /** Signed playback URL. `null` when the song is not playable (VIP / no copyright / removed). */
  url: string | null
  /** Bitrate in bps. */
  br?: number | null
  /** URL expiry in seconds from response time. */
  expi?: number | null
  /** Per-song status. 200 = playable. */
  code?: number | null
  type?: string | null
  size?: number | null
  level?: string | null
  /** Present when NetEase only grants a short trial segment instead of full playback. */
  freeTrialInfo?: unknown
}

/** `/song/url/v1` response body. */
export interface SongUrlResponseDto {
  code: number
  data: SongUrlDataDto[]
}

// ---------------------------------------------------------------------------
// Album / Artist detail DTOs (public, no login)
// ---------------------------------------------------------------------------

/** `/album` response body. `songs` is the full track list. */
export interface AlbumResponseDto {
  code: number
  album?: AlbumDto | null
  songs?: SongDto[] | null
}

/**
 * NetEase artist detail object (from `/artist/head/info/get` → `data.artist`).
 *
 * Image fields vary by endpoint version: `/artist/detail` returns `cover`
 * (landscape) + `avatar` (square), while older shapes return `img1v1Url` /
 * `picUrl`. The mapper tries all of them.
 */
export interface ArtistDetailDto {
  id: number
  name: string
  /** Square avatar (preferred), from `/artist/detail`. */
  avatar?: string | null
  /** Landscape cover, from `/artist/detail`. */
  cover?: string | null
  img1v1Url?: string | null
  picUrl?: string | null
  albumSize?: number | null
  musicSize?: number | null
  briefDesc?: string | null
}

/** `/artist/head/info/get` response body: payload nested under `data`. */
export interface ArtistDetailResponseDto {
  code: number
  data?: { artist?: ArtistDetailDto | null } | null
  /** Some shapes return `artist` at the top level — unwrap defensively. */
  artist?: ArtistDetailDto | null
}

/** `/artist/songs` response body. `songs` is a page; `total`/`more` for paging. */
export interface ArtistSongsResponseDto {
  code: number
  songs?: SongDto[] | null
  total?: number | null
  more?: boolean | null
  moreText?: string | null
}

/** `/artist/top/song` response body. Hot 50. */
export interface ArtistTopSongsResponseDto {
  code: number
  songs?: SongDto[] | null
}

/**
 * NetEase album entry inside `/artist/albums` → `hotAlbums`. Lighter than the
 * full album object: id/name/cover/publish time.
 */
export interface ArtistAlbumDto {
  id: number
  name: string
  picUrl?: string | null
  publishTime?: number | null
  size?: number | null
}

/** `/artist/albums` response body. Album list under `hotAlbums`. */
export interface ArtistAlbumsResponseDto {
  code: number
  hotAlbums?: ArtistAlbumDto[] | null
  more?: boolean | null
}

// ---------------------------------------------------------------------------
// User data DTOs (require login cookie)
// ---------------------------------------------------------------------------

/** `/user/playlist` response body. First entry is the user's "我喜欢的音乐". */
export interface UserPlaylistResponseDto {
  code: number
  playlist?: PlaylistDto[] | null
  more?: boolean | null
}

// ---------------------------------------------------------------------------
// Personal center DTOs (require login cookie)
// ---------------------------------------------------------------------------

/** `/user/subcount` response: various collection counts. Fields vary by account. */
export interface UserSubcountDto {
  code: number
  programCount?: number | null
  djRadioCount?: number | null
  mvCount?: number | null
  artistCount?: number | null
  albumCount?: number | null
  playlistCount?: number | null
  newProgramCount?: number | null
  createDjRadioCount?: number | null
  subEventCount?: number | null
}

/** `/user/level` response body. Level info under `data`. */
export interface UserLevelDto {
  code: number
  data?: {
    userId?: number | null
    level?: number | null
    /** 是否已达满级。 */
    full?: boolean | null
    /** 当前等级进度(满级为 1,非满级通常为 0-1 小数)。 */
    progress?: number | null
    nowLoginCount?: number | null
    nowPlayCount?: number | null
    nextLoginCount?: number | null
    nextPlayCount?: number | null
    /** 等级权益信息($ 分隔多条)。 */
    info?: string | null
  } | null
}

/** Single binding entry in `/user/binding`. */
export interface UserBindingItemDto {
  /** 绑定类型编码:1 手机,2 邮箱,3 微博,4 微信,5 QQ,10 网易等。 */
  type?: number | null
  url?: string | null
  expired?: boolean | null
  bindingTime?: number | null
  refreshTime?: number | null
}

/** `/user/binding` response. `bindings` may also appear as `binding`. */
export interface UserBindingResponseDto {
  code: number
  bindings?: UserBindingItemDto[] | null
  binding?: UserBindingItemDto[] | null
}

/** `/user/record` response. `weekData` (type=1) or `allData` (type=0). */
export interface UserRecordResponseDto {
  code: number
  weekData?: UserRecordItemDto[] | null
  allData?: UserRecordItemDto[] | null
}

export interface UserRecordItemDto {
  playCount?: number | null
  score?: number | null
  song: SongDto
}

/** `/artist/sublist` response. */
export interface ArtistSublistResponseDto {
  code: number
  data?: {
    count?: number | null
    hasMore?: boolean | null
    artists?: { id: number; name: string; picUrl?: string | null }[] | null
  } | null
}

/** `/album/sublist` response. */
export interface AlbumSublistResponseDto {
  code: number
  data?: {
    count?: number | null
    hasMore?: boolean | null
    albums?:
      | {
          id: number
          name: string
          picUrl?: string | null
          artist?: { name?: string | null } | null
          artists?: { name?: string | null }[] | null
        }[]
      | null
  } | null
}

/** `/mv/sublist` response. */
export interface MvSublistResponseDto {
  code: number
  data?: {
    count?: number | null
    hasMore?: boolean | null
    mvs?:
      | {
          id: number
          name?: string | null
          title?: string | null
          cover?: string | null
          imgurl?: string | null
          artistName?: string | null
          artists?: { name?: string | null }[] | null
        }[]
      | null
  } | null
}

/** `/daily_signin` response. Success: `{ code: 200, point }`; already signed: `{ code: -2, msg }`. */
export interface DailySigninDto {
  code: number
  point?: number | null
  msg?: string | null
  message?: string | null
}

/** `/recommend/songs` (v3) response body. Daily songs live under `data.dailySongs`. */
export interface RecommendSongsResponseDto {
  code: number
  data?: { dailySongs?: SongDto[] | null } | null
}

/** `/lyric` response body. `lrc.lyric` is standard LRC; `tlyric.lyric` is the translation;
 *  `yrc.lyric` is per-word timed lyric (YRC) for karaoke animation.
 *  `lyricUser`/`transUser`/`roles`/`source` 是贡献者信息(词/曲/译作者、来源),
 *  /lyric/new(v1)响应本就返回,用于沉浸页贡献者显示。 */
export interface LyricResponseDto {
  code: number
  lrc?: { lyric?: string | null } | null
  tlyric?: { lyric?: string | null } | null
  yrc?: { lyric?: string | null } | null
  /**
   * 罗马音/音译歌词。romalrc 为行级(常带词间空格,粤拼/日罗可读);
   * yromalrc 对齐 YRC,部分曲目音节粘连无空格。mapper 优先 romalrc 显示。
   */
  romalrc?: { lyric?: string | null } | null
  yromalrc?: { lyric?: string | null } | null
  lyricUser?: { nickname: string; userid: number } | null
  transUser?: { nickname: string; userid: number } | null
  roles?:
    | {
        roleName: string
        /** 真实响应中可能缺失或为 null,mapper 负责规整为数组。 */
        artistMetaList?: { artistId: number; artistName: string }[] | null
      }[]
    | null
  source?: { name?: string } | string | null
}

// ---------------------------------------------------------------------------
// Auth / QR-login DTOs
// ---------------------------------------------------------------------------

/** NetEase account object (from `/login/status` and `/user/account`). */
export interface AccountDto {
  id: number
  userName?: string | null
  type?: number | null
}

/** NetEase user profile object. Field names mirror upstream abbreviations. */
export interface ProfileDto {
  userId: number
  nickname: string
  avatarUrl?: string | null
  backgroundUrl?: string | null
  signature?: string | null
  vipType?: number | null
}

/** `/login/qr/key` response body. */
export interface QrKeyDto {
  code: number
  data: { unikey: string }
}

/** `/login/qr/create` response body. */
export interface QrCreateDto {
  code: number
  data: { qrurl: string; qrimg: string }
}

/**
 * `/login/qr/check` response body. The top-level `code` IS the business state:
 * 800=expired, 801=waiting scan, 802=scanned awaiting confirm, 803=authorized
 * (returns the session cookie string).
 */
export interface QrCheckDto {
  code: 800 | 801 | 802 | 803
  message?: string | null
  avatarUrl?: string | null
  nickname?: string | null
  cookie?: string | null
}

/**
 * account + profile payload. Returned nested under `data` by `/login/status`,
 * but at the TOP LEVEL by `/user/account` — the two api-enhanced modules differ
 * (login_status.js wraps `{ data: {...} }`, user_account.js returns raw). The
 * mapper unwraps `dto.data ?? dto` to support both.
 */
export interface AccountProfileDto {
  code?: number | null
  account?: AccountDto | null
  profile?: ProfileDto | null
}

/**
 * `/login/status` response body: the payload sits under `data` (with no
 * top-level `code`). Typed loosely to also accept the flat `/user/account`
 * shape so a single mapper can handle both.
 */
export interface LoginStatusDto extends AccountProfileDto {
  data?: AccountProfileDto | null
}

/**
 * `/user/account` response body: the payload is at the TOP LEVEL (no `data`
 * wrapper), unlike `/login/status`. Structurally identical handling via the
 * shared mapper.
 */
export type AccountResultDto = LoginStatusDto

/** `/login/refresh` response body. `cookie` is the refreshed session string. */
export interface RefreshDto {
  code: number
  cookie?: string | null
}

/** `/captcha/sent` response body. `data: false` = rate-limited (still code 200). */
export interface CaptchaSentDto {
  code: number
  data?: boolean | null
  message?: string | null
}

/** `/login/cellphone` response body. `cookie` is the session string on success. */
export interface LoginCellphoneDto {
  code: number
  cookie?: string | null
  message?: string | null
}

// ---------------------------------------------------------------------------
// Rank / Toplist DTOs (public, no login)
// ---------------------------------------------------------------------------

/** Single ranking entry in `/toplist/detail/v2` → `data[].list[]`. Its `id` doubles as a playlist id. */
export interface RankItemDto {
  id: number
  name: string
  coverImgUrl?: string | null
  coverUrl?: string | null
  updateFrequency?: string | null
  /** "PLAYLIST" for real charts; "H5" for NetEase campaign pages (id is always 0, filtered out by the mapper). */
  targetType?: string | null
}

/** Ranking category in `/toplist/detail/v2` → `data[]`. */
export interface RankCategoryDto {
  name: string
  categoryCode?: string | null
  list?: RankItemDto[] | null
}

/** `/toplist/detail/v2` response body. */
export interface RankListResponseDto {
  code: number
  data?: RankCategoryDto[] | null
}

// ---------------------------------------------------------------------------
// Comment DTOs (public reads; writes need cookie)
// ---------------------------------------------------------------------------

/** Comment author block. NetEase nests it inside every comment record. */
export interface CommentUserDto {
  userId: number
  nickname: string
  avatarUrl?: string | null
}

/**
 * Single comment record. Common shape across `/comment/new` (`data.comments[]`)
 * and `/comment/hot` (`hotComments[]`). `liked` reflects the current cookie's
 * user; for public reads it's effectively always `false` server-side.
 */
export interface CommentDto {
  commentId: number
  user: CommentUserDto
  content?: string | null
  /** Epoch ms. */
  time?: number | null
  likedCount?: number | null
  liked?: boolean | null
  /** The comment being replied to; the upstream returns at most one entry here. */
  beReplied?: CommentDto[] | null
}

/**
 * Unified envelope for both comment endpoints. `/comment/new` nests pagination
 * under `data`; `/comment/hot` exposes the array + pagination at the top level.
 * Mappers pick the right branch — both fields are optional here on purpose.
 */
export interface CommentListDto {
  code: number
  /** v2 (`/comment/new`) payload. */
  data?: {
    cursor?: string | number | null
    hasMore?: boolean | null
    totalCount?: number | null
    comments?: CommentDto[] | null
  } | null
  /** v1 (`/comment/hot`) payload. */
  hotComments?: CommentDto[] | null
  hasMore?: boolean | null
  total?: number | null
}
