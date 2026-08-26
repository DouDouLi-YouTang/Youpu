// CSS 等价对比工具（重构前基线 vs 重构后 SCSS 编译产物）
//
// 用法：
//   node scripts/css-equiv-check.mjs <baselineRef> <scssPath>
//      baselineRef 形如 HEAD:src/.../x.scss 或本地路径；编译时自动注入
//      '$color-* 内联变量（对齐 Vite
//      additionalData），用 --no-prelude 可关闭（旧行为）。
//   node scripts/css-equiv-check.mjs --vue <filePath> [--block N]
//      对比 .vue 文件 HEAD 版本与工作区版本的全部内联 <style> 块
//      （不含 src= 外链块），--block N 只对比第 N 个（1 起）。
//
// 判据：两边规则集（选择器+声明+媒体上下文）双向零差集 = 等价。
// 重构只允许嵌套展开与变量/函数抽取，不得增删 (选择器,声明) 组合。
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PRELUDE =
  '$color-danger: #ef4444;\n' +
  '$color-hot: #ff5a36;\n' +
  '$color-success: #22c55e;\n' +
  '$color-spotify: #1db954;\n' +
  '$color-white: #fff;\n' +
  '$color-black: #000;\n'
function getSource(ref) {
  if (ref.startsWith('HEAD:') || /^[A-Za-z0-9_.-]+:/.test(ref)) {
    const colon = ref.indexOf(':')
    return execFileSync('git', ['show', ref.slice(0, colon) + ':' + ref.slice(colon + 1)], {
      encoding: 'utf8'
    })
  }
  return readFileSync(ref, 'utf8')
}

/** 抽取 .vue 源码里的内联 <style> 块（跳过 src= 外链块），返回 [{attr, body}] */
function extractSfcBlocks(src) {
  const blocks = []
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(src))) {
    if (m[1].includes('src=')) continue
    blocks.push({ attr: m[1], body: m[2] })
  }
  return blocks
}

let tmpSeq = 0
/** 把一段 SCSS 文本编译成 CSS（剥离 @import，注入 package-vars prelude，走 load-path） */
function compileScss(srcText, { prelude = true } = {}) {
  let src = srcText
    .replace(/^\s*@import\s+[^;\n]+;?\s*$/gm, '')
    .replace(/^\s*@use\s+[^;\n]+;?\s*$/gm, '')
  if (prelude && !src.includes('$color-danger:')) src = PRELUDE + src
  const tmp = join(mkdtempSync(join(tmpdir(), 'css-equiv-')), 'in-' + tmpSeq++ + '.scss')
  writeFileSync(tmp, src, 'utf8')
  const args = ['sass', '--no-source-map', '--quiet', tmp]
  try {
    return execFileSync('npx', args, { encoding: 'utf8' })
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

/** 把一段 CSS 文本解析成规则集列表。每条规则 = selector|media => Set(declStrings) */
function parseCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = new Map()
  const stack = []
  let i = 0
  const n = css.length
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++
    if (i >= n) break
    if (css[i] === '@') {
      const atName = css.slice(i + 1).match(/^[a-zA-Z-]*/)[0]
      if (atName === 'media' || atName === 'supports' || atName === 'container') {
        const brace = css.indexOf('{', i)
        if (brace === -1) break
        const prelude = css.slice(i, brace).trim()
        stack.push(prelude)
        i = brace + 1
        continue
      }
      let semi = css.indexOf(';', i)
      const nl = css.indexOf('\n', i)
      const end = semi === -1 ? nl : nl === -1 ? semi : Math.min(semi, nl)
      i = (end === -1 ? css.length : end) + 1
      continue
    }
    if (css[i] === '}') {
      stack.pop()
      i++
      continue
    }
    const brace = css.indexOf('{', i)
    if (brace === -1) break
    const selectorRaw = css.slice(i, brace).trim()
    const close = findMatchingBrace(css, brace)
    const body = css.slice(brace + 1, close)
    i = close + 1
    if (selectorRaw.startsWith('@font-face') || selectorRaw.startsWith('@keyframes')) {
      const key = '@BLOCK::' + selectorRaw + '::' + stack.join('>>')
      addRule(rules, key, body.trim())
      continue
    }
    const media = stack.join('>>')
    for (const sel of selectorRaw.split(',')) {
      const s = normalizeSel(sel)
      if (!s) continue
      addRule(rules, media + '||' + s, body)
    }
  }
  return rules
}

function findMatchingBrace(s, open) {
  let depth = 1
  let i = open + 1
  while (i < s.length && depth > 0) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') depth--
    if (depth === 0) return i
    i++
  }
  return i
}

function normalizeDecl(raw) {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s || !s.includes(':')) return null
  s = s
    .replace(/'/g, '"')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/,\s+/g, ', ')
    .replace(/\[([a-zA-Z0-9_-]+)=["']([^"']+)["']\]/g, '[$1=$2]')
  return s
}

function normalizeSel(sel) {
  return sel
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/'/g, '"')
    .replace(/\[([a-zA-Z0-9_-]+)=["']([^"']+)["']\]/g, '[$1=$2]')
}

function addRule(rules, key, body) {
  const decls = parseDecls(body)
  if (!rules.has(key)) rules.set(key, new Set())
  const set = rules.get(key)
  for (const d of decls) set.add(d)
}

function parseDecls(body) {
  const out = new Set()
  for (const raw of body.split(';')) {
    const decl = normalizeDecl(raw)
    if (decl) out.add(decl)
  }
  return out
}

function diffRules(a, b) {
  let onlyInA = 0
  let onlyInB = 0
  const diffs = []
  for (const [key, decls] of a) {
    const other = b.get(key)
    if (!other) {
      onlyInA++
      diffs.push('  [仅基线] ' + key + '  (' + decls.size + ' 声明)')
      continue
    }
    for (const d of decls) {
      if (!other.has(d)) {
        onlyInA++
        diffs.push('  [基线独有声明] ' + key + ' :: ' + d)
      }
    }
  }
  for (const [key, decls] of b) {
    const other = a.get(key)
    if (!other) {
      onlyInB++
      diffs.push('  [仅编译] ' + key + '  (' + decls.size + ' 声明)')
      continue
    }
    for (const d of decls) {
      if (!other.has(d)) {
        onlyInB++
        diffs.push('  [编译独有声明] ' + key + ' :: ' + d)
      }
    }
  }
  return { onlyInA, onlyInB, diffs }
}

function runCompare(label, baselineSrc, currentSrc, opts) {
  let baselineCss, compiled
  try {
    baselineCss = compileScss(baselineSrc, opts)
    compiled = compileScss(currentSrc, opts)
  } catch (e) {
    console.log(
      label +
        ' ✗ 编译失败: ' +
        String(e.stderr || e.message)
          .split('\n')
          .slice(0, 8)
          .join(' | ')
    )
    return false
  }
  const a = parseCss(baselineCss)
  const b = parseCss(compiled)
  const { onlyInA, onlyInB, diffs } = diffRules(a, b)
  console.log(label + ' 基线规则键 ' + a.size + ' / 编译规则键 ' + b.size)
  if (onlyInA === 0 && onlyInB === 0) {
    console.log(label + ' ✓ 等价：未改变任何 (选择器,声明) 组合')
    return true
  }
  console.log(label + ' ✗ 不等价：基线独有 ' + onlyInA + '，编译独有 ' + onlyInB)
  for (const d of diffs.slice(0, 30)) console.log(d)
  if (diffs.length > 30) console.log('  ...另有 ' + (diffs.length - 30) + ' 条')
  return false
}

function main() {
  const args = process.argv.slice(2)
  const opts = { prelude: true }
  let vueMode = false
  let blockN = 0
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--vue') vueMode = true
    else if (a === '--no-prelude') opts.prelude = false
    else if (a === '--block') {
      blockN = parseInt(args[++i], 10)
    } else if (a === '--help') {
      console.log('用法: node scripts/css-equiv-check.mjs <baselineRef> <scssPath>')
      console.log('      node scripts/css-equiv-check.mjs --vue <filePath> [--block N]')
      process.exit(2)
    } else positional.push(a)
  }

  if (vueMode) {
    const file = positional[0]
    if (!file) {
      console.error('--vue 需要文件路径参数')
      process.exit(2)
    }
    const base = getSource('HEAD:' + file)
    const curr = readFileSync(file, 'utf8')
    const bb = extractSfcBlocks(base)
    const cb = extractSfcBlocks(curr)
    if (bb.length !== cb.length) {
      console.error('✗ 内联块数量不一致: HEAD ' + bb.length + ' 块 vs 工作区 ' + cb.length + ' 块')
      process.exit(1)
    }
    let allOk = true
    for (let i = 0; i < bb.length; i++) {
      if (blockN && i + 1 !== blockN) continue
      allOk = runCompare(file + ' [block ' + (i + 1) + ']', bb[i].body, cb[i].body, opts) && allOk
    }
    process.exit(allOk ? 0 : 1)
  }

  const [baselineRef, scssRef] = positional
  if (!baselineRef || !scssRef) {
    console.error('用法: node scripts/css-equiv-check.mjs <baselineRef> <scssPath>')
    console.error('      node scripts/css-equiv-check.mjs --vue <filePath> [--block N]')
    process.exit(2)
  }
  const ok = runCompare(scssRef, getSource(baselineRef), readFileSync(scssRef, 'utf8'), opts)
  process.exit(ok ? 0 : 1)
}

main()
