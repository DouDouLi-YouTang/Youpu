import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { TILT_FONT_HANZI, TILT_FONT_KANA, TILT_LYRIC_FONT_FAMILIES } from './use-tilt-font'

/**
 * 「倾诉」字体栈的**跨文件一致性**单测。
 *
 * 为什么值得一个测试：字体栈在这三个地方各写了一遍，而它们**必须逐字对应**，
 * 偏偏三处都不报错、只在运行时表现为「测量宽度和渲染宽度对不上」——
 * 具体是排版忽宽忽窄、溢出缩放算错，且只在特定语言/字体的歌词上才看得出来：
 *
 *  1. `use-tilt-font.ts` 的常量 —— 加载探测与（若将来需要）JS 侧拼 font string 的出处；
 *  2. `@/assets/fonts/fonts.scss` 的 `@font-face` —— 注册的族名，写错就是「字体没生效」；
 *  3. `skins/tilt/tilt.scss` 的 `font-family` 栈 —— 渲染顺序，决定「谁先出字」。
 *
 * 尤其是 3：`use-tilt-layout` 的测量是 `getComputedStyle(panel).fontFamily` 读出来的
 * （pretext 需要 CSS font shorthand），所以**栈里前两项的名字与顺序一变，测量口径就跟着变**。
 *
 * 本测试**锁住的范围**（别把它当成全栈锁）：栈的**前两项**必须逐字等于 TS 常量，
 * 且每项都有对应的 `@font-face`（其 src 文件真实存在）、末尾有通用兜底族。
 * 栈的**第三项及以后**不受约束 —— 这是刻意的：测量读的是 CSS computed style，
 * 与 TS 常量无关，末尾增删族名不会造成「测量与渲染脱节」，锁死反而会挡住正常的扩展。
 *
 * 不做的事：不测 `document.fonts` 本身（vitest 是 node 环境，没有 Font Loading API，
 * 见 use-tilt-font.ts 的降级分支）。
 */

/**
 * 读源码文件。入参是「相对本文件所在目录」的路径（本文件在
 * `src/features/immersive/skins/tilt/`，故 `src/assets/**` 是 `../../../../assets/**`）。
 */
function readSource(relativeFromThisFile: string): string {
  return readFileSync(fileURLToPath(new URL(relativeFromThisFile, import.meta.url)), 'utf8')
}

const fontsScss = readSource('../../../../assets/fonts/fonts.scss')
const tiltScss = readSource('./tilt.scss')
// 歌词行自己的样式表：字体是靠继承铺过去的，它这里任何一条非 inherit 的
// font-family 都会在这个子树上换掉内置字体，所以要一起扫（见文件末尾那条用例）
const tiltLineScss = readSource('./tilt-line.scss')

describe('倾诉字体族名的常量', () => {
  it('两个族名互不相同（写成同一个等于假名兜底失效）', () => {
    expect(TILT_FONT_HANZI).not.toBe(TILT_FONT_KANA)
  })

  it('栈的顺序是「汉字优先、假名兜底」（反了会让汉字用圆体出字）', () => {
    expect(TILT_LYRIC_FONT_FAMILIES).toEqual([TILT_FONT_HANZI, TILT_FONT_KANA])
  })
})

describe('fonts.scss 注册的族名与常量一致', () => {
  /**
   * 剥掉注释后的 fonts.scss —— 断言跑在这份上。
   * 不剥的话，一条**注释**里写着 `font-family: 'ZCOOL KuaiLe';` 就能满足断言，
   * 而真正的 @font-face 可能已经坏了（假阴性）。
   */
  const fontsScssNoComments = fontsScss
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('两个族各有一条 @font-face，且 src 指向仓库里真实存在的 woff2', () => {
    for (const family of TILT_LYRIC_FONT_FAMILIES) {
      // 族名转义后插进正则：将来新增含 `+` / `.` / `(` 的族名（例如 "M+ 1c"）
      // 不会让 `new RegExp` 自己炸掉或匹配错东西
      const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const declaration = new RegExp(`font-family:\\s*'${escaped}';`)
      expect(fontsScssNoComments, `fonts.scss 里缺 @font-face 族名 ${family}`).toMatch(declaration)
    }
  })

  it('@font-face 的 src 文件名与 assets/fonts 下的实际文件对得上', () => {
    // 单引号与双引号都认：引用形式是书写风格，不该成为「数量不符」这种难懂的失败
    const sources = [...fontsScssNoComments.matchAll(/url\(['"]\.\/([^'"]+\.woff2)['"]\)/g)].map(
      (m) => m[1]
    )
    // ⚠️ 这里**不**断言「引用数 === 倾诉字体族数」：fonts.scss 是全部内置字体的注册表，
    // 除了倾诉的两个族，还注册了「流光 / 浮名」的衬线字体（同一族的 400 / 500 两条）。
    // 数量相等只在「只有倾诉用内置字体」的那段时间成立，钉死它会让新增字体必然误报。
    // 真正要守的是下面两条：倾诉的两个族各有引用、每个引用都指向真实文件。
    expect(sources.length).toBeGreaterThanOrEqual(TILT_LYRIC_FONT_FAMILIES.length)
    // 真去读文件：文件名打错时，构建能过（Vite 会当资源引用处理），但测试拦下来
    for (const file of sources) {
      expect(
        () => readSource(`../../../../assets/fonts/${file}`),
        `fonts.scss 引用的 ${file} 不存在`
      ).not.toThrow()
    }
  })
})

describe('OFL 许可证原文的两份副本保持同步', () => {
  /*
   * 为什么要有这个测试：许可证原文刻意存了两份（理由见 fonts.scss 的注释）——
   * `src/assets/fonts/` 那份给改字体的开发者看，`public/licenses/` 那份才是**随包分发**的
   * （打包只带 out/**，src/ 不进安装包）。两份一旦漂移，最坏情况是「发出去的安装包里
   * 带的是一份过期/不匹配的许可证」—— 这正是 OFL 要求附带原文想避免的事，
   * 而且不会有任何构建或运行期报错来提醒。所以用测试把两份钉成必须一致。
   */
  const LICENSES = [
    'ZCOOL-KuaiLe-OFL.txt',
    'M-PLUS-Rounded-1c-OFL.txt',
    'Noto-Serif-SC-OFL.txt'
  ] as const

  it.each(LICENSES)('%s：src 与 public 两份逐字相同，且都是 OFL 原文', (file) => {
    const inSrc = readSource(`../../../../assets/fonts/${file}`)
    const inPublic = readSource(`../../../../../public/licenses/${file}`)
    expect(inSrc).toBe(inPublic)
    // 抽一句 OFL 特有的措辞，防止有人用别的文件（或空文件）占位
    expect(inSrc).toContain('SIL OPEN FONT LICENSE')
  })

  it('每个内置字体都有一份对应的许可证文件（新增字体时别漏）', () => {
    /*
     * 校验的是「每个字体**族**都有许可证」，不是「woff2 文件数 === 许可证数」：
     * 一个族可以有多个字面（Noto Serif SC 就是 400 / 500 两个 woff2 共用一份 OFL），
     * 按文件数比对会在加字面的那一刻误报。按族比对才对应 OFL 的实际要求。
     */
    const fontFamilySlugs = [
      ...new Set(
        [...fontsScss.matchAll(/url\(['"]\.\/([^'"]+?)-\d+\.woff2['"]\)/g)].map((m) =>
          m[1].toLowerCase().replace(/[^a-z0-9]/g, '')
        )
      )
    ]
    expect(fontFamilySlugs.length, 'fonts.scss 里没扫到任何 woff2 引用').toBeGreaterThan(0)

    const licenseSlugs = LICENSES.map((file) => ({
      file,
      slug: file.toLowerCase().replace(/[^a-z0-9]/g, '')
    }))

    for (const slug of fontFamilySlugs) {
      expect(
        licenseSlugs.some((license) => license.slug.includes(slug)),
        `字体族 ${slug} 没有对应的 OFL 许可证文件（新增字体时别漏）`
      ).toBe(true)
    }
  })
})

describe('tilt.scss 的字体栈与常量逐字对应', () => {
  /** 剥掉 CSS 注释。注释里**提到** `font-family`（例如解释「.tilt-row 写了
   * font-family: inherit」），不删的话正则会从注释里的那个词开始吞 —— 真实 CSS
   * 解析器也把注释排除在声明之外，所以这不是取巧，是照它的行为来。 */
  function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  /** 取某个选择器那条规则块的内容（从 `{` 到配对的 `}`）。找不到返回 null */
  function ruleBody(css: string, selector: string): string | null {
    // 选择器在正则里有元字符（`.` 等），必须转义 —— 否则 `.tilt-lyric` 里的点
    // 会匹配任意字符，碰巧命中别的东西
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const start = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{`).exec(css)
    if (!start) return null
    // 从 `{` 之后逐字符数括号，取到配对的那个 `}`（CSS 里没有转义花括号的情况，
    // 这个规则块里也不会再嵌套别的块 —— 真嵌套了也只会多算，不会读到块外）
    let depth = 0
    const from = start.index + start[0].length - 1
    for (let i = from; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) return css.slice(from + 1, i)
      }
    }
    return null
  }

  /**
   * 解析**.tilt-lyric 那条规则**里的 font-family 栈（剥引号与空白）。
   *
   * ⚠️ 锚定到 `.tilt-lyric` 而不是「文件里第一条 font-family」：那些字都是继承它的
   * （歌词行 / 空态卡 / 副字幕），所以「整块面板用什么字体」的正源是这一条。
   * 若改成取全文第一条，将来在更靠前的位置给别的选择器加一条 font-family（比如
   * 单独给 .tilt-placeholder 指定），这条测试就会去解析那条、报一个指向错误位置的失败 ——
   * 更坏的情况是那条恰好前两项相同，于是真正的栈被改坏了却依然通过。
   */
  function parseStack(): string[] | null {
    const body = ruleBody(stripComments(tiltScss), '.tilt-lyric')
    if (body === null) return null
    const match = body.match(/font-family:\s*([^;]+);/)
    if (!match) return null
    return match[1]
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  }

  it('.tilt-lyric 规则存在（整块面板的字体都继承它）', () => {
    expect(
      ruleBody(stripComments(tiltScss), '.tilt-lyric'),
      'tilt.scss 里找不到 .tilt-lyric 规则块'
    ).not.toBeNull()
  })

  it('栈存在，且前两项恰好是「快乐体 → 圆体」（顺序决定谁先出字）', () => {
    const stack = parseStack()
    expect(stack, '.tilt-lyric 里找不到 font-family 栈').not.toBeNull()
    expect(stack!.slice(0, 2)).toEqual([...TILT_LYRIC_FONT_FAMILIES])
  })

  it('栈尾必须留通用兜底族（两个内置字体都没有的生僻字 / 韩文 / emoji 全靠它）', () => {
    const stack = parseStack()!
    const generic = ['sans-serif', 'serif', 'monospace', 'system-ui']
    // `!important` 会让末项带上后缀（`sans-serif !important`），此时应报「栈尾缺兜底族」；
    // 这里先把它剥掉，让断言说的是真正的问题，而不是被书写形式误伤
    const normalized = stack.map((family) => family.replace(/\s*!important\s*$/, '').trim())
    expect(
      normalized.some((family) => generic.includes(family)),
      `栈尾应有通用兜底族，实际栈尾是「${stack[stack.length - 1]}」`
    ).toBe(true)
  })

  /**
   * 除了 `.tilt-lyric` 上那个栈，**不允许**再有别的 `font-family` 声明去覆盖它。
   *
   * 为什么这条必要（审查发现的漏洞）：字体是靠**继承**铺到整块面板的，所以任何一条
   * 写在后代选择器上的 `font-family` 都能把那个子树换成别的字体 —— 而上面那几条断言
   * 只盯 `.tilt-lyric` 自己，会**照常通过**。例如给 `.tilt-stage` 加一条
   * `font-family: 'Comic Sans MS', cursive;`：歌词行的字体真的变了（`.tilt-row` 是它的
   * 后代，且 `font-family: inherit` 会把新值继续往下带），测量端 `readFontFamily`
   * 读到的也正是新值，可测试全绿 —— 静默的字体替换，正是这个测试文件存在要防的东西。
   *
   * 允许的唯一例外是 `font-family: inherit`：它是**显式声明「沿用父级」**，
   * 不引入新字体（tilt-line.scss 的 .tilt-row 用它把栈带进逐字 span），语义上正是本约束要的。
   */
  it('tilt 的样式表里除 .tilt-lyric 的栈外，没有别的 font-family 覆盖（只允许 inherit）', () => {
    const offenders: string[] = []
    for (const [file, raw] of [
      ['tilt.scss', tiltScss],
      ['tilt-line.scss', tiltLineScss]
    ] as const) {
      // 逐条声明地看：先剥注释（注释里也会出现 font-family 字样），再按 `;` 切开找
      const declarations = stripComments(raw).match(/font-family:\s*[^;]+;/g) ?? []
      for (const declaration of declarations) {
        // 归一到「值」：去掉属性名、结尾分号、!important 与所有空白，便于比对
        const value = declaration
          .replace(/^font-family:\s*/, '')
          .replace(/;$/, '')
          .replace(/\s*!important\s*$/, '')
          // 引号与空格都不影响「是不是 inherit」的判断
          .replace(/["']/g, '')
          .replace(/\s+/g, '')
        if (value === 'inherit') continue
        offenders.push(`${file}: ${declaration.trim()}`)
      }
    }
    // 恰好一条：.tilt-lyric 上的那个栈。多了任何一条都在此处暴露
    expect(
      offenders.length,
      `除 .tilt-lyric 的内置字体栈外不应再有 font-family 声明（inherit 除外），实际多出：\n${offenders.join('\n')}`
    ).toBe(1)
  })
})
