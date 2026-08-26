# 有谱 Youpu

[![License: MIT](https://img.shields.io/github/license/DouDouLi-YouTang/Youpu)](LICENSE)
[![Release](https://img.shields.io/github/v/release/DouDouLi-YouTang/Youpu?include_prereleases)](https://github.com/DouDouLi-YouTang/Youpu/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/DouDouLi-YouTang/Youpu/ci.yml?label=CI)](https://github.com/DouDouLi-YouTang/Youpu/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/DouDouLi-YouTang/Youpu?style=social)](https://github.com/DouDouLi-YouTang/Youpu/stargazers)

一个简洁好看的网易云音乐桌面客户端，免费、开源。

> 在电脑上，把听歌这件事做得更舒服一点。

## 它能做什么

- 🎵 **听歌**：搜索、播放、歌单、排行榜、每日推荐、私人 FM、心动模式
- 📝 **歌词**：沉浸式歌词面板，支持逐字卡拉OK、翻译、罗马音
- 📂 **歌单**：创建、收藏、管理自己的歌单
- 🎨 **好看**：多套主题色、封面取色、流畅的过渡动画
- 🖥️ **桌面体验**：迷你模式、系统托盘、倍速播放、多档音质
- 🔄 **自动更新**：内置更新器，正式版 / Beta 版双通道

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=DouDouLi-YouTang/Youpu&type=Date)](https://star-history.com/#DouDouLi-YouTang/Youpu&Date)

## 下载安装

前往 [Releases](https://github.com/DouDouLi-YouTang/Youpu/releases) 下载最新版本：

| 文件 | 说明 |
| --- | --- |
| `youpu-x.y.z-setup.exe` | 正式版安装包（NSIS） |
| `youpu-x.y.z-beta.n-setup.exe` | Beta 预发布安装包 |

- 正式版：稳定功能，推荐大多数用户
- Beta 版：更早体验新功能，可能不稳定

安装后应用会通过 GitHub Releases 自动检查更新（设置 -> 应用更新 可切换通道或关闭）。

## 版本与更新通道

版本号遵循 [SemVer](https://semver.org/)：

- `v0.2.0` -- 正式版
- `v0.2.0-beta.1` -- Beta 预发布版

应用内更新通道对应关系：

| 应用内通道 | 接收的版本 | GitHub Release |
| --- | --- | --- |
| 正式版（默认） | 仅 `x.y.z` | 普通 Release |
| Beta 版 | `x.y.z` 与 `x.y.z-beta.n` | 标记 Pre-release |

从 Beta 切回正式版：设置中将通道切为「正式版」，下一个更高版本号正式版发布后自动回到正式通道。

## 从源码运行

需要先装好 [Node.js](https://nodejs.org/)（20 或更高版本）。

```bash
# 1. 克隆仓库
git clone https://github.com/DouDouLi-YouTang/Youpu.git
cd Youpu

# 2. 安装依赖
npm install

# 3. 启动
npm run dev
```

如果 Electron 下载不动，可以先用国内镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

## 打包

想生成 Windows 安装包：

```bash
npm run dist
```

产物会输出到 `dist/<版本号>/` 目录。

## 发布新版本（维护者）

### 方式一：一键脚本（推荐）

双击仓库根目录的 `publish-release.bat`，按提示选择「正式版 / Beta 版」并输入版本号即可。脚本会自动完成：切到 main → 同步 → 更新版本号 → 提交 → 打 tag → 推送。

### 方式二：手动命令

```bash
# 正式版
npm version 0.2.1
git push github main
git push github v0.2.1

# Beta 版（版本号必须带 -beta.n 后缀，才会被标记为 Pre-release）
npm version 0.3.0-beta.1
git push github main
git push github v0.3.0-beta.1
```

> 注意：推送目标是 `github` 远程（GitHub 仓库），不是 `origin`（指向 gitee）。

推送 `v*` tag 后 GitHub Actions 自动打包并发布到 Releases：正式版为普通 Release（Latest），Beta 版自动标记为 Pre-release。

## 说明

- 音乐数据来自网易云音乐，本项目仅供学习交流使用
- 使用前请遵守相关服务条款

## License

[MIT](LICENSE)
