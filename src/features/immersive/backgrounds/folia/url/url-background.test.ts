import { describe, expect, it } from 'vitest'

import {
  mergeUrlBackgroundList,
  normalizeUrlBackgroundUrl,
  resolveSelectedUrlBackgroundItem,
  sanitizeUrlBackgroundItem,
  sanitizeUrlBackgroundList
} from './url-background'

describe('normalizeUrlBackgroundUrl', () => {
  it('缺协议时补 https://，并规范化成绝对 URL', () => {
    expect(normalizeUrlBackgroundUrl('example.com/a')).toBe('https://example.com/a')
    expect(normalizeUrlBackgroundUrl('  http://example.com  ')).toBe('http://example.com/')
  })

  it('只放行 http / https', () => {
    expect(normalizeUrlBackgroundUrl('file:///C:/secret.txt')).toBeNull()
    expect(normalizeUrlBackgroundUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrlBackgroundUrl('data:text/html,x')).toBeNull()
    expect(normalizeUrlBackgroundUrl('muice-file://local/?path=C:/a.mp3')).toBeNull()
  })

  it('非字符串 / 空串 / 解析失败 → null', () => {
    expect(normalizeUrlBackgroundUrl(null)).toBeNull()
    expect(normalizeUrlBackgroundUrl(42)).toBeNull()
    expect(normalizeUrlBackgroundUrl('   ')).toBeNull()
    expect(normalizeUrlBackgroundUrl('http://')).toBeNull()
  })
})

describe('sanitizeUrlBackgroundItem', () => {
  it('要求 id 与合法 url，note 为空时回退成 url', () => {
    expect(sanitizeUrlBackgroundItem({ id: ' a ', url: 'example.com' })).toEqual({
      id: 'a',
      url: 'https://example.com/',
      note: 'https://example.com/'
    })
    expect(sanitizeUrlBackgroundItem({ id: 'a', url: 'example.com', note: ' 我的背景 ' })).toEqual({
      id: 'a',
      url: 'https://example.com/',
      note: '我的背景'
    })
    expect(sanitizeUrlBackgroundItem({ id: '', url: 'example.com' })).toBeNull()
    expect(sanitizeUrlBackgroundItem({ id: 'a', url: 'javascript:1' })).toBeNull()
    expect(sanitizeUrlBackgroundItem('nope')).toBeNull()
  })
})

describe('mergeUrlBackgroundList', () => {
  it('按 id 覆盖，不删除已有项', () => {
    const current = [{ id: 'a', url: 'https://a.test/', note: 'A' }]
    const merged = mergeUrlBackgroundList(current, [
      { id: 'a', url: 'https://a2.test/', note: 'A2' },
      { id: 'b', url: 'b.test' }
    ])
    expect(merged).toEqual([
      { id: 'a', url: 'https://a2.test/', note: 'A2' },
      { id: 'b', url: 'https://b.test/', note: 'https://b.test/' }
    ])
  })

  it('非法 incoming 只保留原列表', () => {
    const current = [{ id: 'a', url: 'https://a.test/', note: 'A' }]
    expect(mergeUrlBackgroundList(current, 'nope')).toEqual(current)
    expect(mergeUrlBackgroundList(current, [null, { id: 'b', url: 'file:///x' }])).toEqual(current)
  })
})

describe('sanitizeUrlBackgroundList', () => {
  it('逐项清洗并按首次出现的 id 去重', () => {
    const source = [
      { id: 'a', url: 'a.test' },
      { id: 'a', url: 'a2.test' },
      { id: 'b', url: 'file:///x' },
      { id: 'c', url: 'c.test', note: 'C' }
    ]
    expect(sanitizeUrlBackgroundList(source)).toEqual([
      { id: 'a', url: 'https://a.test/', note: 'https://a.test/' },
      { id: 'c', url: 'https://c.test/', note: 'C' }
    ])
    expect(sanitizeUrlBackgroundList('nope')).toEqual([])
  })
})

describe('resolveSelectedUrlBackgroundItem', () => {
  const items = [
    { id: 'a', url: 'https://a.test/', note: 'A' },
    { id: 'b', url: 'https://b.test/', note: 'B' }
  ]

  it('命中时返回清洗后的项', () => {
    expect(resolveSelectedUrlBackgroundItem(items, 'b')).toEqual({
      id: 'b',
      url: 'https://b.test/',
      note: 'B'
    })
  })

  it('未命中 / 缺 id / 列表非法都返回 null（调用方连遮罩都不渲染）', () => {
    expect(resolveSelectedUrlBackgroundItem(items, 'missing')).toBeNull()
    expect(resolveSelectedUrlBackgroundItem(items, null)).toBeNull()
    expect(resolveSelectedUrlBackgroundItem(items, '')).toBeNull()
    expect(resolveSelectedUrlBackgroundItem(null, 'a')).toBeNull()
    expect(resolveSelectedUrlBackgroundItem('nope' as never, 'a')).toBeNull()
  })

  it('列表里混进非白名单 url 时会被这一层再次拦下（最后检查点）', () => {
    expect(
      resolveSelectedUrlBackgroundItem([{ id: 'x', url: 'file:///C:/secret.txt' } as never], 'x')
    ).toBeNull()
    expect(
      resolveSelectedUrlBackgroundItem(
        [{ id: 'x', url: 'javascript:alert(1)', note: 'x' } as never],
        'x'
      )
    ).toBeNull()
  })
})
