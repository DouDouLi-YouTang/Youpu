#!/usr/bin/env node
// 一键发布有谱(Youpu)正式版 / Beta 版到 GitHub Releases。
// 用法:双击仓库根目录的 publish-release.bat,或运行 node scripts/publish-release.mjs。
// 原理:更新版本号 -> 提交 -> 打 tag -> 推送;由 .github/workflows/release.yml 自动构建发布。

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline/promises'

const root = join(import.meta.dirname, '..')
const pkgPath = join(root, 'package.json')
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
}
function shInherit(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}
function trySh(cmd) {
  try {
    return { ok: true, out: sh(cmd) }
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message || e).trim() }
  }
}
function bumpPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1) : null
}
function exit(msg) {
  console.error('\n✗ ' + msg)
  process.exit(1)
}

try {
  console.log('===== 有谱(Youpu)发布工具 =====\n')

  if (!trySh('git rev-parse --is-inside-work-tree').ok) exit('当前目录不是 git 仓库')
  const remotes = sh('git remote')
  if (!remotes.split(/\r?\n/).includes('github')) {
    exit('未找到名为 github 的远程仓库,请先执行:\n  git remote add github https://github.com/DouDouLi-YouTang/Youpu.git')
  }

  const branch = sh('git branch --show-current')
  if (branch !== 'main') {
    console.log('当前分支 ' + branch + ',切换到 main...')
    shInherit('git checkout main')
  }
  if (sh('git status --porcelain') !== '') exit('工作区有未提交的改动,请先 commit 或还原后再发布')
  console.log('同步 main 分支...')
  const pull = trySh('git pull github main --ff-only')
  if (!pull.ok) exit('拉取远程 main 失败(本地领先或有冲突):\n' + pull.out + '\n请先解决后再试')

  const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version
  console.log('当前版本: ' + current + '\n')
  console.log('请选择发布通道:')
  console.log('  1) 正式版 stable  -> 标记为 Latest,自动更新读 latest.yml')
  console.log('  2) Beta 版 beta    -> 标记为 Pre-release,自动更新读 beta 通道')
  const channel = ((await rl.question('请输入 1 或 2 [1]: ')) || '1').trim()
  const isBeta = channel === '2'

  const base = bumpPatch(current) || current
  const suggested = isBeta ? base + '-beta.1' : base
  const ver = ((await rl.question('请输入版本号(回车用建议值 ' + suggested + '): ')).trim() || suggested)

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(ver)) exit('版本号格式不合法: ' + ver + '(应为 x.y.z 或 x.y.z-beta.n)')
  if (isBeta && !ver.includes('-')) exit('Beta 版本号必须带预发布后缀,如 0.3.0-beta.1')
  if (!isBeta && ver.includes('-')) exit('正式版版本号不能带预发布后缀,如 0.3.0')

  console.log('\n即将发布: ' + (isBeta ? 'Beta 版' : '正式版') + ' v' + ver)
  const confirm = ((await rl.question('确认发布? (y/N): ')).trim().toLowerCase())
  if (confirm !== 'y' && confirm !== 'yes') {
    console.log('已取消')
    process.exit(0)
  }

  console.log('\n更新版本号并打 tag...')
  shInherit('npm version ' + ver + ' -m "chore(release): ' + ver + '"')

  console.log('\n推送 main 分支...')
  shInherit('git push github main')
  console.log('推送 tag v' + ver + '...')
  shInherit('git push github v' + ver)

  console.log('\n✓ 已推送!GitHub Actions 正在自动构建发布(约 5~10 分钟):')
  console.log('  进度: https://github.com/DouDouLi-YouTang/Youpu/actions')
  console.log('  完成: https://github.com/DouDouLi-YouTang/Youpu/releases/tag/v' + ver)
  process.exit(0)
} catch (e) {
  if (e && e.code === 'ABORT_ERR') {
    console.log('\n已取消')
    process.exit(0)
  }
  console.error('\n✗ 出错:', (e && e.message) || String(e))
  process.exit(1)
}
