/**
 * 构建自定义安装界面的原生宿主:build/setup-host/YoupuSetupHost.exe
 *
 * 为什么需要一个独立的 .exe:
 *   NSIS 自带控件无法做出流畅动画与图片渐变。宿主用 WebView2(Win10+ 随 Edge
 *   提供)渲染一份自包含 HTML,既拿到现代 Web 动画能力,又不需要额外运行时。
 *
 * 为什么用 csc(.NET Framework 4)而不是 dotnet publish:
 *   Win10+ 自带 .NET Framework 4.x,csc.exe 是系统组件,产物是一个约 45KB 的
 *   托管 exe,没有 SDK 依赖、没有 self-contained 的体积代价;安装包里只需要
 *   再带一个 162KB 的 WebView2Loader.dll。
 *
 * 产物:
 *   build/setup-host/YoupuSetupHost.exe    引导程序(UI 已内嵌为资源)
 *   build/setup-host/WebView2Loader.dll    WebView2 原生加载器(x64)
 *
 * 由 `npm run build` 里的 build:setup-host 步骤调用(见 package.json)。
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(root, 'tools', 'setup-host')
const srcDir = join(hostDir, 'src')
const uiDir = join(hostDir, 'ui')
const outDir = join(root, 'build', 'setup-host')
const buildDir = join(root, 'build', 'setup-host-build')
const loaderDll = join(hostDir, 'native', 'x64', 'WebView2Loader.dll')
const iconPath = join(root, 'build', 'icon.ico')
const manifestPath = join(hostDir, 'YoupuSetupHost.exe.manifest')

const CSC_CANDIDATES = [
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
]

function fail(message) {
  console.error(`[setup-host] ${message}`)
  process.exit(1)
}

function findCompiler() {
  for (const candidate of CSC_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  fail(
    '未找到 .NET Framework 编译器 csc.exe。\n' +
      '  安装界面宿主用 .NET Framework 4 编译(Win10+ 自带),请确认系统存在\n' +
      `  ${CSC_CANDIDATES[0]}\n` +
      '  若确实要放弃自定义安装界面,可移除 electron-builder.ts 的 beforePack 钩子。'
  )
  return ''
}

/** 内联进 HTML 的脚本,顺序即执行顺序(场景数据在前,界面逻辑在后)。 */
const UI_SCRIPTS = ['scenes.js', 'youpu-setup.js']

function buildUiDocument() {
  const html = readFileSync(join(uiDir, 'index.html'), 'utf8')
  if (!html.includes('/*__YOUPU_SETUP_SCRIPT__*/')) {
    fail('ui/index.html 缺少 /*__YOUPU_SETUP_SCRIPT__*/ 占位符')
  }
  const scripts = UI_SCRIPTS.map((name) => {
    const file = join(uiDir, name)
    if (!existsSync(file)) {
      fail(`缺少界面脚本:${file}`)
    }
    return readFileSync(file, 'utf8')
  })
  // 内联脚本中出现 </script> 会提前结束标签,统一转义
  const safeScript = scripts.join('\n').replace(/<\/script>/gi, '<\\/script>')
  return html.replace('/*__YOUPU_SETUP_SCRIPT__*/', () => safeScript)
}

function main() {
  if (!existsSync(loaderDll)) {
    fail(
      `缺少 WebView2 原生加载器:${loaderDll}\n` +
        '  该文件随 tools/setup-host/native/x64 一起提交;若被清理,可从\n' +
        '  Microsoft.Web.WebView2 NuGet 包的 build/native/x64/WebView2Loader.dll 取回。'
    )
  }

  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith('.cs'))
    .map((name) => join(srcDir, name))
  if (sources.length === 0) fail(`没有找到任何 C# 源文件:${srcDir}`)

  rmSync(buildDir, { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })

  const uiHtmlPath = join(buildDir, 'YoupuSetupUi.html')
  writeFileSync(uiHtmlPath, buildUiDocument(), 'utf8')

  // 上一次调试可能还留着宿主进程,exe 被占用会让 csc 报 CS0016。
  // 只结束同名进程,不做任何其它清理。
  try {
    execFileSync('taskkill', ['/IM', 'YoupuSetupHost.exe', '/F'], { stdio: 'ignore' })
    console.log('[setup-host] 已结束残留的 YoupuSetupHost 进程')
  } catch {
    // 没有残留进程时 taskkill 会失败,属正常情况
  }
  const outExe = join(outDir, 'YoupuSetupHost.exe')
  const args = [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    `/out:${outExe}`,
    `/resource:${uiHtmlPath},YoupuSetupUi.html`,
    '/r:System.dll',
    '/r:System.Core.dll',
    '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll'
  ]
  if (existsSync(iconPath)) {
    args.push(`/win32icon:${iconPath}`)
  }
  if (existsSync(manifestPath)) {
    args.push(`/win32manifest:${manifestPath}`)
  } else {
    fail(`缺少应用程序清单:${manifestPath}(DPI 感知依赖它)`)
  }
  args.push(...sources)

  console.log(`[setup-host] 编译 ${sources.length} 个源文件 → ${outExe}`)
  try {
    execFileSync(findCompiler(), args, { stdio: 'inherit' })
  } catch {
    fail('csc 编译失败')
  }

  copyFileSync(loaderDll, join(outDir, 'WebView2Loader.dll'))

  console.log('[setup-host] 产物:')
  for (const name of readdirSync(outDir)) {
    const size = readFileSync(join(outDir, name)).length
    console.log(`  ${name}  ${(size / 1024).toFixed(1)} KB`)
  }
}

main()
