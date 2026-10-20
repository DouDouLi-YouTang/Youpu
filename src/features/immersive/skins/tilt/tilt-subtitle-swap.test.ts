import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SUBTITLE_SWAP_MOTION } from '../shared/subtitle-tracks'

/**
 * 「倾诉」副字幕的**留位**与**换行淡入**的跨文件一致性单测。
 *
 * 为什么值得一个测试：这两件事都写在一段 CSS 里，而它们各自对应一个**只在运行时
 * 才看得见**的行为，错了不会有任何报错：
 *
 *  1. **留位**（`.tilt-subtitle.is-placeholder` 的 `visibility: hidden`）——
 *     倾诉的副字幕在正常流里，舞台高度 = 扣掉副字幕后剩下的高度。占位行一旦被写成
 *     `display: none`（或干脆删掉），换行到"没有罗马音的那句"时舞台会当场变高、
 *     居中的歌词跟着跳 —— 实测 11px（2 行 → 1 行）/ 26px（2 行 → 0 行）。
 *     这是用户报的那类"切歌/换行时元素抖动"，且只有特定歌（部分行缺罗马音/译文）
 *     才复现，很容易在只测一首歌时被漏掉。
 *
 *  2. **换行淡入**（`.tilt-subtitles` 的 animation + `@keyframes`）—— 三个数字
 *     （200ms / 10px / ease-out）与「流光」「浮名」是**同一次换行动画**（上游三边
 *     共用一个 overlay 组件），唯一出处是 `SUBTITLE_SWAP_MOTION`。这里那份是渲染侧
 *     副本，本测试逐值比对，防止"流光改了、倾诉没改"这种口径漂移。
 *
 * 不做的事：不跑浏览器、不测动画是否真的在跑（那是 e2e 的事）—— 只锁源码里的数值与
 * 属性，与 `use-tilt-font.test.ts` 锁字体栈的思路一致。
 */

/** 读本目录下的源码文件 */
function readSource(relativeFromThisFile: string): string {
  return readFileSync(fileURLToPath(new URL(relativeFromThisFile, import.meta.url)), 'utf8')
}

const tiltScss = readSource('./tilt.scss')

/**
 * 剥掉注释后的 tilt.scss —— 断言跑在这份上。
 * 不剥的话，注释里写一句 `display: none` 就能满足断言（假阴性），而真正生效的
 * 那条可能已经坏了。真实 CSS 解析器同样把注释排除在声明之外。
 */
const css = tiltScss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** 取某个选择器那条规则块的内容（从 `{` 到配对的 `}`）。找不到返回 null */
function ruleBody(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{`).exec(source)
  if (!start) return null
  let depth = 0
  const from = start.index + start[0].length - 1
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(from + 1, i)
    }
  }
  return null
}

/** 取规则块里某条声明的值（`属性: 值;`）。找不到返回 null */
function declaration(body: string | null, property: string): string | null {
  if (body === null) return null
  const match = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+);`).exec(body)
  return match ? match[1].trim() : null
}

describe('倾诉副字幕：换行淡入的三段数值', () => {
  it('`.tilt-subtitles` 用 animation 简写声明了这段动画（并给出时长与曲线）', () => {
    const shorthand = declaration(ruleBody(css, '.tilt-subtitles'), 'animation')
    expect(shorthand, 'tilt.scss 的 .tilt-subtitles 里找不到 animation 简写').not.toBeNull()
    const parts = shorthand!.split(/\s+/)
    expect(parts).toContain('tilt-subtitle-swap-in')
    // 时长缺失时浏览器默认 0s（= 不播），且不会有任何提示 —— 所以这条必须显式断言
    expect(parts.some((part) => /^\d+(\.\d+)?m?s$/.test(part))).toBe(true)
    expect(parts.some((part) => part === SUBTITLE_SWAP_MOTION.cssEase)).toBe(true)
  })

  it('时长与共享档位一致（0.2s = SUBTITLE_SWAP_MOTION.durationMs）', () => {
    const shorthand = declaration(ruleBody(css, '.tilt-subtitles'), 'animation')!
    const duration = shorthand.split(/\s+/).find((part) => /^\d+(\.\d+)?m?s$/.test(part))!
    const ms = duration.endsWith('ms')
      ? Number.parseFloat(duration)
      : Number.parseFloat(duration) * 1000
    expect(ms).toBe(SUBTITLE_SWAP_MOTION.durationMs)
  })

  it('@keyframes 存在，from 是「全透明 + 从下方 offsetPx 处滑入」', () => {
    const keyframes = ruleBody(css, '@keyframes tilt-subtitle-swap-in')
    expect(keyframes, 'tilt.scss 里找不到 @keyframes tilt-subtitle-swap-in').not.toBeNull()
    const from = ruleBody(keyframes!, 'from')!
    expect(declaration(from, 'opacity')).toBe('0')
    expect(declaration(from, 'transform')).toBe(`translateY(${SUBTITLE_SWAP_MOTION.offsetPx}px)`)
  })

  it('@keyframes 的 to 是终态（不透明 + 无位移）', () => {
    const keyframes = ruleBody(css, '@keyframes tilt-subtitle-swap-in')!
    const to = ruleBody(keyframes, 'to')!
    expect(declaration(to, 'opacity')).toBe('1')
    expect(declaration(to, 'transform')).toBe('none')
  })
})

describe('倾诉副字幕：留位（舞台高度不随本行有没有副字幕变化）', () => {
  it('占位行用 visibility: hidden 保留行盒，不用 display: none', () => {
    const body = ruleBody(css, '.tilt-subtitle.is-placeholder')
    expect(body, 'tilt.scss 里找不到 .tilt-subtitle.is-placeholder 规则').not.toBeNull()
    expect(declaration(body, 'visibility')).toBe('hidden')
    // display: none 会让占位行不再占位 —— 那正是抖动复现的方式
    expect(declaration(body, 'display')).toBeNull()
  })

  it('`.tilt-subtitles` 仍在正常流里（absolute / fixed 会让舞台多吃一块高度）', () => {
    const position = declaration(ruleBody(css, '.tilt-subtitles'), 'position')
    expect(
      position === null || position === 'relative' || position === 'static',
      `.tilt-subtitles 的 position 是 ${position} —— 它会脱离正常流，舞台高度随之变化`
    ).toBe(true)
  })
})
