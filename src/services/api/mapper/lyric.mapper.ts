import type { LyricContributors, LyricData, LyricLine } from '@/domain/lyric'
import { parseLrc } from '@/features/lyric/parse-lrc'
import { parseJsonLrc } from '@/features/lyric/parse-json-lrc'
import { parseYrc } from '@/features/lyric/parse-yrc'
import type { RawLine } from '@/features/lyric/types'
import type { LyricResponseDto } from '../types/dto'

/**
 * Map a raw `/lyric/new` (NetEase /api/song/lyric/v1) response to the `LyricData`
 * domain model.
 *
 * v1 响应里 lrc.lyric / yrc.lyric 可能是新版富文本 JSON `{"t":ms,"c":[{"tx":"字"}]}`,
 * 也可能是混合格式(开头 JSON 元信息行 + 后续标准 YRC)。三种格式我们都能解析:
 *  - parseYrc:标准 YRC `[time,dur](wordTime,wordDur,flag)word...`,跳过 JSON 行
 *  - parseJsonLrc:JSON 行级时间戳,带 LRC 时间戳回退
 *  - parseLrc:标准 LRC `[mm:ss.xx]text`(旧端点响应)
 *
 * 优先用 YRC 逐字时间戳构建行,无 YRC 时依次回退到 parseJsonLrc、parseLrc,
 * LyricLine.words 留空,LyricLines 渲染自然回退到行级文本(对齐参考项目 ——
 * 无逐字数据时仅 parsePureLyric 走行级,不合成假逐字)。
 *
 * translation(tlyric)对齐:YRC 行时间戳(整数 ms,来自 [time,dur] 头)与 tlyric
 * 行时间戳(来自 [mm:ss.xx],10ms 分辨率,且常与 YRC 不同源)**并不总是相等**,
 * 精确 Map 查找会大量 miss → 翻译全部丢失。故移植参考项目 liblyric/index.ts 的
 * 两步法:先 attachOriginalText 把 lrc 原文按时间贴到翻译/罗马音行上(桥接),再
 * attachAuxiliaryLyric 对每条附属行找时间最近的主歌词行、±5 行窗口内用「桥接原文 vs
 * YRC 原文」的编辑距离(calcSimilarity,同语言)择优附着,即使时间差几十 ms 或行数
 * 错位也能正确对齐。
 * contributors(lyricUser/transUser/roles/source)按参考 lyric-provider.js 解析。
 */
export function mapLyricDto(dto: LyricResponseDto): LyricData {
  // tlyric / romalrc:尝试 JSON 再回退标准 LRC
  const tlyricRaw = dto.tlyric?.lyric ?? ''
  const transRaw = tlyricRaw.startsWith('{') ? parseJsonLrc(tlyricRaw) : parseLrc(tlyricRaw)
  // 罗马音显示为整行文本(非逐字卡拉OK)。romalrc 带词间空格
  // (粤拼/日罗 "ling san …"); yromalrc 对齐 YRC 时常见无空格粘连
  // ("lingsan…")。优先 romalrc 以保证可读性,仅缺失时回退 yromalrc。
  const romajiRawText = dto.romalrc?.lyric ?? dto.yromalrc?.lyric ?? ''
  const romajiRaw = romajiRawText.startsWith('{')
    ? parseJsonLrc(romajiRawText)
    : parseLrc(romajiRawText)

  const yrcLines = parseYrc(dto.yrc?.lyric ?? '')

  // lrc.lyric 行级歌词:YRC 分支用作翻译/罗马音附着的「原文桥」,回退分支直接作主歌词。
  // 可能 JSON 也可能标准 LRC —— 据首字符探测。
  const lrcRaw = dto.lrc?.lyric ?? ''
  const lrcParsed = lrcRaw.startsWith('{') ? parseJsonLrc(lrcRaw) : parseLrc(lrcRaw)

  let lines: LyricLine[]

  if (yrcLines.length > 0) {
    // YRC 逐字行
    lines = yrcLines.map((l) => ({
      timeMs: l.timeMs,
      text: l.text,
      words: l.words
    }))
    // 桥接(参考项目 attachOriginalLyric):把 lrc 原文按时间贴到翻译/罗马音行上,
    // 之后 attachAuxiliaryLyric 的编辑距离比较用「贴上的原文 vs YRC 行原文」(同语言,
    // 正确行距离≈0 必胜)。跳过桥接直接拿罗马音(拉丁)/译文与原文比,零共同字符时
    // Levenshtein 退化为两串长度的较大值,±5 窗口全体平局 → 系统性附着到错误行。
    attachOriginalText(transRaw, lrcParsed)
    attachOriginalText(romajiRaw, lrcParsed)
  } else {
    const mainRaw = lrcParsed
    // 同时尝试 JSON(可能元信息在 JSON、歌词在 LRC,合并去重按 timeMs)
    const jsonRaw = lrcRaw.startsWith('{') ? [] : parseJsonLrc(lrcRaw)
    const merged = [...mainRaw, ...jsonRaw]
    const seen = new Set<number>()
    lines = merged
      .filter((l) => {
        if (seen.has(l.timeMs)) return false
        seen.add(l.timeMs)
        return true
      })
      .map((l) => ({
        timeMs: l.timeMs,
        text: l.text
      }))
      .sort((a, b) => a.timeMs - b.timeMs)
  }

  // translation 对齐:lrc 分支(lrc 与 tlyric 同源时间戳)精确优先,YRC 分支
  // (YRC 整数 ms 与 tlyric 10ms 不同源)用容差 + 编辑距离。见 attachAuxiliaryLyric 注释。
  attachAuxiliaryLyric(lines, transRaw, yrcLines.length === 0, 'translation')
  attachAuxiliaryLyric(lines, romajiRaw, yrcLines.length === 0, 'romaji')

  // 无 YRC 逐字时间戳时,LyricLine.words 留空(undefined),LyricLines 自然回退到
  // 行级文本(rnp-lyrics-line-original)渲染 —— 与参考项目一致:reference 有真 YRC
  // 才注入 dynamicLyric 走逐字卡拉OK分支,无 YRC 直接 parsePureLyric 走行级文本,
  // 不合成假逐字。有真 YRC 的歌用真实时间戳,上方 YRC 分支已注入 words + trailing。

  const hasLyric = lines.length > 0
  const isPureMusic = !hasLyric || /纯音乐/.test(dto.lrc?.lyric ?? '')

  return { lines, hasLyric, isPureMusic, contributors: mapContributors(dto) }
}

/**
 * Levenshtein 编辑距离 —— 移植参考项目 liblyric/index.ts calcSimularity。
 * 用于在时间最近的主歌词行 ±5 窗口内择优附着翻译:距离越小越相似。
 */
function calcSimilarity(a: string, b: string): number {
  const x = a ?? ''
  const y = b ?? ''
  const m = x.length
  const n = y.length
  if (m === 0) return n
  if (n === 0) return m
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] =
        x[i - 1] === y[j - 1]
          ? d[i - 1][j - 1]
          : Math.min(d[i - 1][j - 1] + 1, d[i][j - 1] + 1, d[i - 1][j] + 1)
    }
  }
  return d[m][n]
}

/** 附属歌词行(翻译/罗马音):桥接后带同时间点的 lrc 原文,供同语言相似度比较。 */
type AuxRawLine = RawLine & { originalText?: string }

/**
 * 桥接步骤 —— 移植参考项目 liblyric/index.ts attachOriginalLyric。
 *
 * 把行级原文(lrc)按时间贴到每条附属歌词行(翻译/罗马音)上。匹配模式对齐参考:
 * 附属行与原文行时间戳交集占附属行 ≥ 10% 时视为同源,用 <20ms 容差等值匹配
 * (从后往前找,等价参考 findLast);否则退化为全表最近时间匹配。同一附属行可累积
 * 多条原文(空格连接)。lrc 缺失时不贴,后续比较回退用附属行自身文本(旧行为)。
 */
function attachOriginalText(aux: AuxRawLine[], original: RawLine[]): void {
  if (aux.length === 0 || original.length === 0) return
  const auxTimes = new Set(aux.map((l) => l.timeMs))
  const originalTimes = new Set(original.map((l) => l.timeMs))
  let hits = 0
  for (const t of auxTimes) if (originalTimes.has(t)) hits++
  const equalMode = hits / auxTimes.size >= 0.1
  for (const line of original) {
    let target: AuxRawLine | undefined
    if (equalMode) {
      for (let i = aux.length - 1; i >= 0; i--) {
        if (Math.abs(aux[i].timeMs - line.timeMs) < 20) {
          target = aux[i]
          break
        }
      }
    } else {
      target = aux[0]
      for (const v of aux) {
        if (Math.abs(target.timeMs - line.timeMs) > Math.abs(v.timeMs - line.timeMs)) target = v
      }
    }
    if (!target) continue
    target.originalText = target.originalText ? `${target.originalText} ${line.text}` : line.text
  }
}

/**
 * 把翻译行(transRaw)附着到主歌词行(lines)。
 *
 * 两种策略:
 *  - preferExact=true(lrc 分支):lrc 与 tlyric 同源时间戳,精确 timeMs 命中 100% 准确,
 *    故精确优先。跨语言翻译(外文→中文)主歌词与译文无共同字符,编辑距离被长度主导,
 *    若用相似度会把译文贴到最短的相邻行 → 故同源分支必须精确优先,仅未命中时回退相似度。
 *  - preferExact=false(YRC 分支):YRC 整数 ms 与 tlyric 10ms 不同源,精确查找大量 miss,
 *    故用参考项目 attachLyricToDynamic:找时间最近行 + ±5 窗口编辑距离择优
 *    (weight = similarity*1000 + (已附着?1:0),最小者胜出)。比较文本用桥接贴上的
 *    lrc 原文(raw.originalText,同语言),而非附属歌词自身(跨语言编辑距离退化,见
 *    attachOriginalText 注释);未桥接时回退自身文本。
 */
function attachAuxiliaryLyric(
  lines: LyricLine[],
  rawLines: AuxRawLine[],
  preferExact: boolean,
  field: 'translation' | 'romaji'
): void {
  if (rawLines.length === 0 || lines.length === 0) return
  const attached = new Set<number>()
  for (const raw of rawLines) {
    let targetIndex = -1
    // 同源分支:精确 timeMs 命中优先
    if (preferExact) {
      const exact = lines.findIndex((l) => l.timeMs === raw.timeMs)
      if (exact >= 0) targetIndex = exact
    }
    // 未精确命中(或不同源分支):容差找最近行 + ±5 窗口编辑距离择优
    if (targetIndex < 0) {
      let nearest = 0
      for (let i = 1; i < lines.length; i++) {
        if (Math.abs(lines[nearest].timeMs - raw.timeMs) > Math.abs(lines[i].timeMs - raw.timeMs)) {
          nearest = i
        }
      }
      // ±5 行窗口(参考项目顺序:先正偏移入栈再 reverse,等价于按距离从小到大)
      const sequence: number[] = [nearest]
      for (let offset = 1; offset <= 5; offset++) {
        if (nearest - offset >= 0) sequence.push(nearest - offset)
        if (nearest + offset < lines.length) sequence.push(nearest + offset)
      }
      sequence.reverse()
      // 编辑距离择优,已附着行权重 +1(轻微倾向未附着行,避免一行吞多条附属歌词)。
      // 比较用桥接原文(同语言);未桥接(lrc 缺失/同源分支)回退附属行自身文本。
      let minWeight = Infinity
      for (const index of sequence) {
        const v = lines[index]
        const similarity = calcSimilarity(raw.originalText ?? raw.text, v.text)
        const weight = similarity * 1000 + (attached.has(index) ? 1 : 0)
        if (weight < minWeight) {
          minWeight = weight
          targetIndex = index
        }
      }
    }
    attached.add(targetIndex)
    const target = lines[targetIndex]
    target[field] = target[field] ? `${target[field]} ${raw.text}` : raw.text
  }
}

/**
 * 解析贡献者 —— 移植参考项目 lyric-provider.js:100-133。
 * /lyric/new(v1)响应本就返回 lyricUser/transUser/roles/source,无需新增接口。
 * roles 过滤掉空角色(artistName==='无' && artistId===0),按 artistMetaList 去重
 * 并合并 roleName(用「、」连接)。
 */
function mapContributors(dto: LyricResponseDto): LyricContributors {
  const contributors: LyricContributors = { roles: [] }

  if (dto.lyricUser) {
    contributors.original = {
      name: dto.lyricUser.nickname,
      userid: dto.lyricUser.userid
    }
  }
  if (dto.transUser) {
    contributors.translation = {
      name: dto.transUser.nickname,
      userid: dto.transUser.userid
    }
  }

  // 真实响应中 artistMetaList 可能缺失/为 null:先规整为数组(顺带复制对象,后面
  // 合并 roleName 时不再改写 dto 入参),空列表角色无可显示内容,一并过滤。
  const roles = (dto.roles ?? [])
    .map((role) => ({
      roleName: role.roleName,
      artistMetaList: Array.isArray(role.artistMetaList) ? role.artistMetaList : []
    }))
    .filter(
      (role) =>
        role.artistMetaList.length > 0 &&
        !(
          role.artistMetaList.length === 1 &&
          role.artistMetaList[0].artistName === '无' &&
          role.artistMetaList[0].artistId === 0
        )
    )
  // 按 artistMetaList 去重,合并 roleName(参考项目用 JSON.stringify 比对)
  for (let i = 0; i < roles.length; i++) {
    const metaList = JSON.stringify(roles[i].artistMetaList)
    for (let j = i + 1; j < roles.length; j++) {
      if (JSON.stringify(roles[j].artistMetaList) === metaList) {
        roles[i].roleName += `、${roles[j].roleName}`
        roles.splice(j, 1)
        j--
      }
    }
  }
  contributors.roles = roles

  if (dto.source) {
    // 部分接口版本 source 是字符串而非 {name} 对象,统一规整为 {name}
    contributors.lyricSource = typeof dto.source === 'string' ? { name: dto.source } : dto.source
  }

  return contributors
}
