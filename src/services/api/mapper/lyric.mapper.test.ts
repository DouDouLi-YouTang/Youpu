import { describe, expect, it } from 'vitest'
import { mapLyricDto } from './lyric.mapper'
import type { LyricResponseDto } from '../types/dto'

/** 构造最小 dto,仅填充传入的字段。 */
function dto(partial: Partial<LyricResponseDto> = {}): LyricResponseDto {
  return { code: 200, ...partial }
}

describe('mapLyricDto', () => {
  describe('YRC 分支', () => {
    it('有 YRC 时 lines 来自 YRC,words 有值,text 由 words 拼接', () => {
      const result = mapLyricDto(
        dto({
          yrc: { lyric: '[1000,3000](1000,500,0)你好(1500,500,0)世界' }
        })
      )
      expect(result.lines).toHaveLength(1)
      const line = result.lines[0]
      expect(line.timeMs).toBe(1000)
      expect(line.text).toBe('你好世界')
      expect(line.words).toHaveLength(2)
      expect(line.words![0]).toMatchObject({ timeMs: 1000, word: '你好' })
      expect(line.words![1]).toMatchObject({ timeMs: 1500, word: '世界' })
      expect(result.hasLyric).toBe(true)
    })

    it('YRC 分支翻译对齐:YRC 整数 ms 与 tlyric 10ms 不同源,经桥接+编辑距离正确附着', () => {
      const result = mapLyricDto(
        dto({
          lrc: { lyric: '[00:01.00]你好世界\n[00:04.00]第二行歌词' },
          yrc: {
            lyric:
              '[1000,3000](1000,500,0)你好(1500,500,0)世界\n[4000,2000](4000,1000,0)第二行(5000,1000,0)歌词'
          },
          tlyric: { lyric: '[00:01.00]Hello World\n[00:04.00]Second line' }
        })
      )
      expect(result.lines).toHaveLength(2)
      expect(result.lines[0]).toMatchObject({
        timeMs: 1000,
        text: '你好世界',
        translation: 'Hello World'
      })
      expect(result.lines[1]).toMatchObject({
        timeMs: 4000,
        text: '第二行歌词',
        translation: 'Second line'
      })
    })
  })

  describe('lrc 分支(无 YRC)', () => {
    it('无 YRC 时 lines 来自 lrc,words 为 undefined', () => {
      const result = mapLyricDto(dto({ lrc: { lyric: '[00:01.00]第一行\n[00:02.00]第二行' } }))
      expect(result.lines).toHaveLength(2)
      expect(result.lines[0]).toMatchObject({ timeMs: 1000, text: '第一行' })
      expect(result.lines[1]).toMatchObject({ timeMs: 2000, text: '第二行' })
      expect(result.lines[0].words).toBeUndefined()
      expect(result.hasLyric).toBe(true)
    })

    it('lrc 分支翻译精确对齐:lrc 与 tlyric 同源时间戳,精确命中', () => {
      const result = mapLyricDto(
        dto({
          lrc: { lyric: '[00:01.00]第一行\n[00:02.00]第二行' },
          tlyric: { lyric: '[00:01.00]Line 1\n[00:02.00]Line 2' }
        })
      )
      expect(result.lines[0].translation).toBe('Line 1')
      expect(result.lines[1].translation).toBe('Line 2')
    })
  })

  describe('romaji 来源', () => {
    it('同时有 romalrc 与 yromalrc 时优先 romalrc(带词间空格,可读)', () => {
      // 真实 LoveU2: yromalrc 粘连 "lingsansiyingsizoipoupou",
      // romalrc 有空格 "ling san si ying si zoi pou pou"
      const result = mapLyricDto(
        dto({
          lrc: { lyric: '[00:30.26]凌晨时仍是在抱抱' },
          yrc: {
            lyric:
              '[30260,1320](30260,165,0)凌(30425,165,0)晨(30590,165,0)时(30755,165,0)仍(30920,165,0)是(31085,165,0)在(31250,165,0)抱(31415,165,0)抱'
          },
          yromalrc: { lyric: '[00:30.44]lingsansiyingsizoipoupou' },
          romalrc: { lyric: '[00:30.26]ling san si ying si zoi pou pou' }
        })
      )
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0].romaji).toBe('ling san si ying si zoi pou pou')
    })

    it('仅 yromalrc 时回退使用 yromalrc', () => {
      const result = mapLyricDto(
        dto({
          lrc: { lyric: '[00:30.26]凌晨时仍是在抱抱' },
          yromalrc: { lyric: '[00:30.26]ling san si ying si zoi pou pou' }
        })
      )
      expect(result.lines[0].romaji).toBe('ling san si ying si zoi pou pou')
    })
  })

  describe('isPureMusic / hasLyric', () => {
    it('无任何歌词时 hasLyric=false, isPureMusic=true', () => {
      const result = mapLyricDto(dto())
      expect(result.lines).toEqual([])
      expect(result.hasLyric).toBe(false)
      expect(result.isPureMusic).toBe(true)
    })

    it('lrc 含"纯音乐"标记时 isPureMusic=true', () => {
      const result = mapLyricDto(dto({ lrc: { lyric: '[00:00.00]纯音乐请欣赏' } }))
      expect(result.hasLyric).toBe(true)
      expect(result.isPureMusic).toBe(true)
    })

    it('有正常歌词时 isPureMusic=false', () => {
      const result = mapLyricDto(dto({ lrc: { lyric: '[00:01.00]正常歌词' } }))
      expect(result.isPureMusic).toBe(false)
    })
  })

  describe('contributors', () => {
    it('解析 lyricUser/transUser/roles/source', () => {
      const result = mapLyricDto(
        dto({
          lrc: { lyric: '[00:01.00]词' },
          lyricUser: { nickname: '词作者', userid: 1 },
          transUser: { nickname: '译者', userid: 2 },
          roles: [
            { roleName: '作曲', artistMetaList: [{ artistId: 10, artistName: '曲作者' }] },
            { roleName: '编曲', artistMetaList: [{ artistId: 10, artistName: '曲作者' }] },
            { roleName: '空角色', artistMetaList: [{ artistId: 0, artistName: '无' }] }
          ],
          source: { name: '网易云' }
        })
      )
      expect(result.contributors.original).toEqual({ name: '词作者', userid: 1 })
      expect(result.contributors.translation).toEqual({ name: '译者', userid: 2 })
      expect(result.contributors.roles).toHaveLength(1)
      expect(result.contributors.roles[0].roleName).toBe('作曲、编曲')
      expect(result.contributors.roles[0].artistMetaList).toEqual([
        { artistId: 10, artistName: '曲作者' }
      ])
      expect(result.contributors.lyricSource).toEqual({ name: '网易云' })
    })

    it('source 为字符串时规整为 {name}', () => {
      const result = mapLyricDto(dto({ lrc: { lyric: '[00:01.00]词' }, source: '来源字符串' }))
      expect(result.contributors.lyricSource).toEqual({ name: '来源字符串' })
    })

    it('roles 缺失/artistMetaList 为 null 时不报错,roles 为空数组', () => {
      const result = mapLyricDto(
        dto({
          lrc: { lyric: '[00:01.00]词' },
          roles: [
            { roleName: '作曲', artistMetaList: null },
            { roleName: '作词', artistMetaList: [{ artistId: 5, artistName: '词作者' }] }
          ]
        })
      )
      expect(result.contributors.roles).toHaveLength(1)
      expect(result.contributors.roles[0].roleName).toBe('作词')
    })

    it('无贡献者信息时返回空结构', () => {
      const result = mapLyricDto(dto({ lrc: { lyric: '[00:01.00]词' } }))
      expect(result.contributors.original).toBeUndefined()
      expect(result.contributors.translation).toBeUndefined()
      expect(result.contributors.roles).toEqual([])
      expect(result.contributors.lyricSource).toBeUndefined()
    })
  })
})
