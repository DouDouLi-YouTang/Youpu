export default {
  appId: 'com.youpu.desktop',
  productName: '有谱',
  // 自动更新源：GitHub Releases。detectUpdateChannel 默认开启--版本号带
  // prerelease 段(如 0.2.0-beta.1)时生成 beta.yml，正式版本生成 latest.yml，
  // 客户端按通道(latest/beta)各自取到对应元数据，实现 beta/正式双通道更新。
  publish: {
    provider: 'github',
    owner: 'DouDouLi-YouTang',
    repo: 'Youpu',
    // 默认发布为正式 Release(非草稿)。beta tag 由 CI 用 EP_PRE_RELEASE=true 覆盖为
    // pre-release，优先级高于这里的 releaseType。
    releaseType: 'release'
  },
  // ${version} 是 electron-builder 运行时宏（expandMacro 展开），非 TS 模板字符串。
  // 按版本号分子目录：同版本打包覆盖该目录，新版本则新建，互不干扰。
  directories: {
    output: 'dist/${version}'
  },
  files: ['out/**/*'],
  extraResources: [
    {
      from: 'server',
      to: 'server',
      filter: [
        '**/*',
        '!**/*.test.js',
        '!test/**',
        '!examples/**',
        '!.husky/**',
        '!.github/**',
        '!.travis.yml',
        '!.dockerignore',
        '!.editorconfig',
        '!.env.prod.example',
        '!.gitignore',
        '!.npmignore',
        '!.prettierrc',
        '!.probe-nenv.cjs',
        '!eslint.config.js',
        '!Dockerfile',
        '!scf_bootstrap',
        '!*.md',
        '!pnpm-lock.yaml',
        '!package-lock.json',
        '!node_modules/**',
        '!node_modules'
      ]
    },
    {
      from: 'build/server-node-modules.zip',
      to: 'server/node_modules.zip'
    },
    {
      from: 'scripts/netease-dns-preload.cjs',
      to: 'scripts/netease-dns-preload.cjs'
    },
    {
      from: 'scripts/start-api-server.cjs',
      to: 'scripts/start-api-server.cjs'
    },
    {
      from: 'build/icon.ico',
      to: 'icon.ico'
    }
  ],
  win: {
    icon: 'build/icon.ico',
    // nsis=安装包；zip=便携版(解压即用)。命名解析顺序：目标级 artifactName > win.artifactName。
    // zip 无目标级配置，故用 win.artifactName；nsis 用下面的 nsis.artifactName。
    target: ['nsis', 'zip'],
    artifactName: 'youpu-${version}-portable.${ext}'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '有谱',
    artifactName: 'youpu-${version}-setup.${ext}'
  }
}
