import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

/**
 * 路由页面必须是「单根」模板。
 *
 * 原因:AppFrame 用 <Transition mode="out-in"> 包住 <RouterView> 的组件,而
 * Transition 要求子节点是单一元素。多根 fragment 页面(典型:根层并列写
 * <section> 与 <a-modal>)会让过渡状态机卡在 out 阶段:内容区只剩一个注释占位符,
 * 且之后切到任何页面都保持白屏(生产构建没有 Vue 告警,控制台无任何报错,排查成本极高)。
 *
 * 需要在页面里放弹窗/抽屉时,把它们放进根元素内部即可 —— a-modal/a-drawer 默认
 * Teleport 到 body,真实 DOM 与样式都不受影响。
 */
describe('路由页面模板根节点', () => {
  const root = process.cwd()
  const routerSource = readFileSync(join(root, 'src/app/router.ts'), 'utf8')

  // 路由表里的页面组件都是 () => import('@/pages/xxx/XxxPage.vue')
  const pageImports = [...routerSource.matchAll(/\(\)\s*=>\s*import\('(@\/[^']+)'\)/g)].map(
    (match) => match[1]
  )

  it('能从路由表里提取到页面组件', () => {
    expect(pageImports.length).toBeGreaterThan(10)
  })

  it.each(pageImports)('%s 只有单根', (specifier) => {
    const file = join(root, specifier.replace('@/', 'src/'))
    const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file })
    expect(errors).toEqual([])

    const children = descriptor.template?.ast?.children ?? []
    // 1=元素节点,2=插值 {{ }};注释/空白不算根节点
    const roots = children.filter((node) => node.type === 1 || node.type === 2)
    const tags = roots.map((node) => (node.type === 1 ? `<${node.tag}>` : '{{插值}}'))

    expect(
      roots.length,
      `${specifier} 有 ${roots.length} 个根节点:${tags.join(' + ')}。` +
        `请把它们包进单个根元素(弹窗/抽屉放进根元素内部即可,默认 Teleport 不影响 DOM)`
    ).toBe(1)
  })
})
