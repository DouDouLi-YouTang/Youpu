/* ============================================================================
   有谱 · 安装界面脚本(无依赖,离线可用)
   —— 与 C# 宿主的消息协议见 tools/setup-host/src/SetupProtocol.cs
   宿主 -> 页面 : init / bridgeReady / browseResult / spaceInfo / installStarted /
                 progress / installComplete / installFailed
   页面 -> 宿主 : ready / browse / querySpace / dragStart / beginInstall /
                 minimize / cancel / close
   ========================================================================== */
;(function () {
  'use strict'

  var bridge = window.chrome && window.chrome.webview ? window.chrome.webview : null
  var CIRCUMFERENCE = 2 * Math.PI * 72
  var CYCLE_MS = 6000 // 每页自动停留时长

  /** 品牌标记:构建期内联的 PNG(取自 build/icon-preview.png,已裁掉底部字标)。 */
  var LOGO_DATA_URI = 'data:image/png;base64,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'

  var ICONS = {
    check:
      '<svg viewBox="0 0 48 48"><path d="M13 25.5 20.5 33 35 16.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 48 48"><path d="M24 13v15" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/><circle cx="24" cy="35.5" r="2.6" fill="currentColor"/></svg>'
  }

  var state = {
    strings: {},
    lang: 'zh-Hans',
    appName: '有谱',
    installDir: '',
    defaultDir: '',
    requiredBytes: 0,
    freeBytes: -1,
    totalBytes: 0,
    isUpdate: false,
    phase: 'setup',
    percent: 0,
    shownPercent: 0,
    animating: false,
    installDirFinal: '',
    failed: false,
    designWidth: 960,
    slide: 0,
    slideCount: 0,
    hover: false,
    reduced: false
  }

  var el = {}
  var slides = []
  var auto = { raf: 0, elapsed: 0, last: 0, running: false }
  var spaceTimer = 0
  var carouselReady = false

  /* ---------------------------------------------------------------- 工具函数 */

  function $(id) {
    return document.getElementById(id)
  }

  function t(key, fallback) {
    var value = state.strings[key]
    return value === undefined || value === null || value === '' ? fallback || key : value
  }

  function send(payload) {
    if (!bridge) {
      console.log('[setup] no bridge, would send', payload)
      return
    }
    bridge.postMessage(JSON.stringify(payload))
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) {
      return t('spaceUnknown')
    }
    var gb = bytes / 1024 / 1024 / 1024
    if (gb >= 1) {
      return (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB'
    }
    return Math.round(bytes / 1024 / 1024) + ' MB'
  }

  function joinPath(dir, name) {
    if (!dir) {
      return name
    }
    return dir.replace(/[\\/]+$/, '') + '\\' + name
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function isAbsoluteWindowsPath(value) {
    return /^[a-zA-Z]:\\/.test(value || '')
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value)
  }

  /* ------------------------------------------------------------------ 视图 */

  function showView(name) {
    state.phase = name
    el.viewSetup.hidden = name !== 'setup'
    el.viewProgress.hidden = name !== 'progress'
    el.viewResult.hidden = name !== 'result'
  }

  /* ------------------------------------------------------------- 功能轮播 */

  function setProgress(ratio) {
    el.carouselProgress.style.transform = 'scaleX(' + ratio.toFixed(4) + ')'
  }

  function buildCarousel() {
    var scenes = window.YOUPU_SCENES || []
    state.slideCount = scenes.length
    var html = ''
    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i]
      html +=
        '<article class="slide' +
        (i === 0 ? ' is-active' : '') +
        '" data-index="' +
        i +
        '">' +
        '<div class="slide-art"><svg class="scene" viewBox="0 0 360 190" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
        scene.svg +
        '</svg></div>' +
        '<div class="slide-copy">' +
        '<div class="slide-meta"><b>' +
        pad2(i + 1) +
        '</b><span>/ ' +
        pad2(scenes.length) +
        '</span>' +
        '<span class="rule"></span><span>' +
        escapeHtml(String(scene.id).toUpperCase()) +
        '</span></div>' +
        '<h2 class="slide-title">' +
        escapeHtml(t(scene.name)) +
        '</h2>' +
        '<p class="slide-desc">' +
        escapeHtml(t(scene.desc)) +
        '</p>' +
        '</div></article>'
    }
    el.carouselViewport.innerHTML = html
    slides = []
    var nodes = el.carouselViewport.querySelectorAll('.slide')
    for (var n = 0; n < nodes.length; n++) {
      slides.push(nodes[n])
    }

    var dots = ''
    for (var d = 0; d < scenes.length; d++) {
      dots +=
        '<button class="dot' +
        (d === 0 ? ' is-active' : '') +
        '" type="button" data-index="' +
        d +
        '" aria-label="' +
        escapeHtml(t('next')) +
        '"></button>'
    }
    el.carouselDots.innerHTML = dots

    state.slide = 0
    el.carousel.classList.remove('dir-next', 'dir-prev', 'no-anim')
    setProgress(0)
    restartAuto()
  }

  /** 重复 init 时只刷新文案,不重建 DOM(重建会把当前页重置回第一页)。 */
  function refreshCarouselStrings() {
    var scenes = window.YOUPU_SCENES || []
    for (var i = 0; i < slides.length && i < scenes.length; i++) {
      var title = slides[i].querySelector('.slide-title')
      var desc = slides[i].querySelector('.slide-desc')
      if (title) {
        title.textContent = t(scenes[i].name)
      }
      if (desc) {
        desc.textContent = t(scenes[i].desc)
      }
    }
  }

  function markDots() {
    var nodes = el.carouselDots.querySelectorAll('.dot')
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].className = 'dot' + (i === state.slide ? ' is-active' : '')
    }
  }

  /**
   * 切页。dir = 1 下一页 / -1 上一页。
   * 过渡前一帧把手上的 transition 关掉,避免方向变化时旧位置参与补间。
   */
  function goTo(index, dir) {
    var count = state.slideCount
    if (count < 2) {
      return
    }
    var target = ((index % count) + count) % count
    if (target === state.slide) {
      return
    }
    var outgoing = slides[state.slide]
    var incoming = slides[target]

    el.carousel.classList.add('no-anim')
    el.carousel.classList.toggle('dir-next', dir >= 0)
    el.carousel.classList.toggle('dir-prev', dir < 0)
    if (outgoing) {
      outgoing.classList.remove('is-active')
      outgoing.classList.add('is-out')
    }
    // 强制一次样式解析,让上面的位移在无动画状态下先生效
    void el.carouselViewport.offsetWidth
    el.carousel.classList.remove('no-anim')

    if (incoming) {
      incoming.classList.add('is-active')
    }
    if (outgoing) {
      setTimeout(function () {
        outgoing.classList.remove('is-out')
      }, 680)
    }
    state.slide = target
    markDots()
    restartAuto()
  }

  function stopAuto() {
    auto.running = false
    if (auto.raf) {
      cancelAnimationFrame(auto.raf)
      auto.raf = 0
    }
  }

  function autoStep(timestamp) {
    if (!auto.running) {
      return
    }
    var delta = timestamp - auto.last
    auto.last = timestamp
    if (!state.hover) {
      auto.elapsed += delta
    }
    var ratio = Math.min(1, auto.elapsed / CYCLE_MS)
    setProgress(ratio)
    if (ratio >= 1) {
      auto.elapsed = 0
      goTo(state.slide + 1, 1)
      return
    }
    auto.raf = requestAnimationFrame(autoStep)
  }

  function restartAuto() {
    stopAuto()
    auto.elapsed = 0
    setProgress(0)
    if (state.reduced || state.slideCount < 2 || state.phase !== 'setup') {
      return
    }
    auto.running = true
    auto.last = performance.now()
    auto.raf = requestAnimationFrame(autoStep)
  }

  /* --------------------------------------------------------- 安装位置与空间 */

  function setInstallDir(value) {
    state.installDir = value || ''
    el.installDir.value = state.installDir
    el.legalPath.textContent = state.installDir || '—'
    el.dirHint.textContent = state.installDir ? joinPath(state.installDir, state.appName) : ''
  }

  function updateDiskMeter() {
    var required = state.requiredBytes || 0
    var free = state.freeBytes
    var total = state.totalBytes

    el.diskRequired.textContent = formatBytes(required)
    el.diskAvailable.textContent = free >= 0 ? formatBytes(free) : t('spaceUnknown')

    var low = free >= 0 && required > 0 && free < required
    el.diskBar.className = 'disk-bar' + (low ? ' is-low' : '')
    el.diskWarn.hidden = !low

    var ratio = 0
    if (total > 0 && free >= 0) {
      ratio = Math.max(0.03, Math.min(1, (total - free) / total))
    }
    el.diskFill.style.width = (ratio * 100).toFixed(1) + '%'
  }

  function requestSpace() {
    var dir = state.installDir || state.defaultDir
    if (!dir) {
      return
    }
    send({ type: 'querySpace', path: dir })
  }

  function scheduleSpaceQuery() {
    if (spaceTimer) {
      clearTimeout(spaceTimer)
    }
    spaceTimer = setTimeout(requestSpace, 320)
  }

  /* ----------------------------------------------------------- 进度环动画 */

  function renderPercent(value) {
    var clamped = Math.max(0, Math.min(100, value))
    el.percentValue.textContent = String(Math.round(clamped))
    el.ringBar.style.strokeDasharray = CIRCUMFERENCE.toFixed(2)
    el.ringBar.style.strokeDashoffset = (CIRCUMFERENCE * (1 - clamped / 100)).toFixed(2)
  }

  function animatePercentTo(target) {
    state.percent = Math.max(0, Math.min(100, target))
    if (state.animating) {
      return
    }
    state.animating = true
    var step = function () {
      var diff = state.percent - state.shownPercent
      if (Math.abs(diff) < 0.3) {
        state.shownPercent = state.percent
        renderPercent(state.shownPercent)
        state.animating = false
        if (state.shownPercent >= 100) {
          setTimeout(showResult, 480)
        }
        return
      }
      // 追赶式缓动:差距越大追得越快,视觉上始终有推进感
      state.shownPercent += diff * 0.14
      renderPercent(state.shownPercent)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function updateSteps(percent) {
    var nodes = el.steps.querySelectorAll('.step')
    var active = percent < 12 ? 0 : percent < 55 ? 1 : percent < 92 ? 2 : 3
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].className =
        'step' + (i < active ? ' is-done' : '') + (i === active ? ' is-active' : '')
    }
  }

  function showProgress(message) {
    showView('progress')
    stopAuto()
    if (message) {
      el.ringStage.textContent = message
    }
    animatePercentTo(Math.max(state.percent, 6))
  }

  /* ------------------------------------------------------------ 完成 / 失败 */

  function showResult() {
    if (state.phase !== 'progress') {
      return
    }
    showView('result')
    el.resultIcon.className = 'result-icon'
    el.resultGlyph.innerHTML = ICONS.check
    el.resultTitle.textContent = t('installed')
    el.resultNote.textContent = t('installedHint')
    el.resultPath.textContent = state.installDirFinal || ''
    el.resultPath.hidden = !state.installDirFinal
    el.btnPrimary.textContent = t('launchNow')
    el.btnSecondary.hidden = true
    burstConfetti()
  }

  function showFailure(message) {
    showView('result')
    el.resultIcon.className = 'result-icon is-failed'
    el.resultGlyph.innerHTML = ICONS.warn
    el.resultTitle.textContent = t('installFailed')
    el.resultNote.textContent = message || '安装程序未能完成,请重试。'
    el.resultPath.hidden = true
    el.btnPrimary.textContent = t('finish')
    el.btnSecondary.textContent = t('retry')
    el.btnSecondary.hidden = false
  }

  function burstConfetti() {
    var host = el.confetti
    host.innerHTML = ''
    var colors = ['#f43f5e', '#fb7185', '#fda4af', '#be123c', '#fafafa']
    for (var i = 0; i < 64; i++) {
      var piece = document.createElement('i')
      piece.style.left = (Math.random() * 100).toFixed(2) + '%'
      piece.style.background = colors[i % colors.length]
      piece.style.height = (8 + Math.random() * 10).toFixed(0) + 'px'
      piece.style.width = (4 + Math.random() * 5).toFixed(0) + 'px'
      piece.style.setProperty('--drift', ((Math.random() - 0.5) * 340).toFixed(0) + 'px')
      piece.style.setProperty('--spin', ((Math.random() - 0.5) * 900).toFixed(0) + 'deg')
      piece.style.setProperty('--dur', (2.4 + Math.random() * 2.2).toFixed(2) + 's')
      piece.style.setProperty('--delay', (Math.random() * 0.45).toFixed(2) + 's')
      host.appendChild(piece)
    }
    setTimeout(function () {
      host.innerHTML = ''
    }, 5600)
  }

  /* --------------------------------------------------------------- 文案填充 */

  function applyStrings() {
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN'
    document.title = t('windowTitle', '有谱 安装程序')
    el.cardTitle.textContent = t('optionsTitle')
    el.labelDir.textContent = t('installDirLabel')
    el.btnBrowse.textContent = t('browse')
    el.btnReset.textContent = t('resetDir')
    el.btnReset.title = t('resetDir')
    el.labelRequired.textContent = t('requiredSpace')
    el.labelAvailable.textContent = t('availableSpace')
    el.diskWarn.textContent = t('spaceInsufficient')
    el.labelDesktop.textContent = t('desktopShortcut')
    el.labelStartMenu.textContent = t('startMenuShortcut')
    el.labelLaunch.textContent = t('launchAfterInstall')
    el.btnInstall.textContent = t('install')
    el.btnCancel.textContent = t('cancel')
    el.btnMin.title = t('minimize')
    el.btnClose.title = t('close')
    el.carouselPrev.title = t('prev')
    el.carouselNext.title = t('next')
    el.carouselPrev.setAttribute('aria-label', t('prev'))
    el.carouselNext.setAttribute('aria-label', t('next'))
    el.ringStage.textContent = t('preparing')
    el.progressTitle.textContent =
      (state.lang === 'en' ? 'Installing ' : '正在安装 ') + state.appName
    el.progressNote.textContent =
      state.lang === 'en'
        ? 'Writing application files, please keep this window open.'
        : '正在写入程序文件,请不要关闭窗口。安装完成后会自动为你打开。'
    el.legal.innerHTML =
      (state.lang === 'en' ? 'Installs to ' : '安装到 ') +
      '<b id="legalPath"></b>' +
      (state.lang === 'en' ? ' · No data collected' : ' · 不会收集你的任何数据')
    el.legalPath = $('legalPath')

    el.diskRequired.textContent = formatBytes(state.requiredBytes)
    el.updatePill.hidden = !state.isUpdate
    el.updatePill.textContent = t('updateTitle')
    updateDiskMeter()
  }

  /* --------------------------------------------------------------- 交互绑定 */

  function onCloseOrCancel() {
    if (state.phase === 'progress') {
      return // 安装中不允许中断
    }
    send({ type: 'cancel' })
  }

  function bindUi() {
    el.btnMin.addEventListener('click', function () {
      send({ type: 'minimize' })
    })
    el.btnClose.addEventListener('click', onCloseOrCancel)
    el.btnCancel.addEventListener('click', onCloseOrCancel)
    el.btnBrowse.addEventListener('click', function () {
      send({ type: 'browse' })
    })
    el.btnReset.addEventListener('click', function () {
      if (state.defaultDir) {
        setInstallDir(state.defaultDir)
        requestSpace()
      }
    })
    el.installDir.addEventListener('input', function () {
      setInstallDir(el.installDir.value.trim())
    })
    el.installDir.addEventListener('change', scheduleSpaceQuery)
    el.installDir.addEventListener('blur', function () {
      var value = el.installDir.value.trim()
      var invalid = value !== '' && !isAbsoluteWindowsPath(value)
      el.installDir.className = 'path-input' + (invalid ? ' is-invalid' : '')
      setInstallDir(value)
      scheduleSpaceQuery()
    })

    el.btnInstall.addEventListener('click', function () {
      var dir = el.installDir.value.trim()
      if (!isAbsoluteWindowsPath(dir)) {
        el.installDir.className = 'path-input is-invalid'
        el.installDir.focus()
        return
      }
      setInstallDir(dir)
      el.btnInstall.disabled = true
      el.btnInstall.textContent = t('installing') + '…'
      send({
        type: 'beginInstall',
        installDir: dir,
        desktopShortcut: el.optDesktop.checked,
        startMenuShortcut: el.optStartMenu.checked,
        launchAfterInstall: el.optLaunch.checked
      })
    })

    el.btnPrimary.addEventListener('click', function () {
      // 完成页的主按钮是「立即启动」;失败页的是「完成」。只有前者要拉起应用。
      send({ type: 'close', launch: state.phase === 'result' && !state.failed })
    })
    el.btnSecondary.addEventListener('click', function () {
      state.failed = false
      state.percent = 0
      state.shownPercent = 0
      renderPercent(0)
      el.btnInstall.disabled = false
      el.btnInstall.textContent = t('install')
      showView('setup')
      restartAuto()
    })

    el.carouselPrev.addEventListener('click', function () {
      goTo(state.slide - 1, -1)
    })
    el.carouselNext.addEventListener('click', function () {
      goTo(state.slide + 1, 1)
    })
    el.carouselDots.addEventListener('click', function (event) {
      var dot = event.target.closest('.dot')
      if (!dot) {
        return
      }
      var index = parseInt(dot.getAttribute('data-index'), 10)
      goTo(index, index > state.slide ? 1 : -1)
    })
    el.carousel.addEventListener('mouseenter', function () {
      state.hover = true
    })
    el.carousel.addEventListener('mouseleave', function () {
      state.hover = false
    })

    // 无边框窗口的拖动:页面把「按在标题栏上」告诉宿主,
    // 由宿主 ReleaseCapture + WM_NCLBUTTONDOWN(HTCAPTION) 走系统拖动。
    el.titlebar.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || event.isPrimary === false) {
        return
      }
      var target = event.target
      if (target && target.closest && target.closest('button, input, a, .no-drag')) {
        return
      }
      send({ type: 'dragStart' })
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        onCloseOrCancel()
        return
      }
      if (state.phase !== 'setup' || state.slideCount < 2) {
        return
      }
      if (event.key === 'ArrowRight') {
        goTo(state.slide + 1, 1)
      } else if (event.key === 'ArrowLeft') {
        goTo(state.slide - 1, -1)
      }
    })
  }

  /* ------------------------------------------------------------- 宿主消息 */

  function handleInit(message) {
    state.strings = message.strings || {}
    state.lang = message.language || 'zh-Hans'
    state.appName = message.appName || '有谱'
    state.defaultDir = message.defaultInstallDir || ''
    state.requiredBytes = message.requiredBytes || 0
    state.isUpdate = !!message.isUpdate
    if (message.bridge && message.bridge.designWidth) {
      state.designWidth = message.bridge.designWidth
    }

    el.brandLogo.src = LOGO_DATA_URI
    el.brandName.textContent = state.appName
    el.brandSub.textContent = String(message.appNameEn || 'YOUPU').toUpperCase() + ' SETUP'
    el.brandVer.textContent = 'v' + (message.version || '0.0.0')
    el.brandVer.hidden = false

    applyStrings()
    if (!carouselReady) {
      buildCarousel()
      carouselReady = true
    } else {
      refreshCarouselStrings()
    }
    // 每次都回写一次:applyStrings 会重建 legal 节点,不重设会丢掉路径
    setInstallDir(state.installDir || state.defaultDir)
    updateDiskMeter()
    requestSpace()
    normalizeViewport()
  }

  function handleMessage(raw) {
    var message
    try {
      message = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      console.warn('[setup] 无法解析宿主消息', raw)
      return
    }
    if (!message || !message.type) {
      return
    }

    switch (message.type) {
      case 'init':
        handleInit(message)
        break
      case 'browseResult':
        if (!message.canceled && message.path) {
          setInstallDir(message.path)
          requestSpace()
        }
        break
      case 'spaceInfo':
        state.freeBytes = typeof message.freeBytes === 'number' ? message.freeBytes : -1
        state.totalBytes = typeof message.totalBytes === 'number' ? message.totalBytes : 0
        updateDiskMeter()
        break
      case 'installStarted':
        showProgress(t('stageWriting'))
        animatePercentTo(8)
        break
      case 'progress':
        el.ringStage.textContent = message.message || t('stageWriting')
        animatePercentTo(message.percent || 0)
        updateSteps(message.percent || 0)
        break
      case 'installComplete':
        state.installDirFinal = message.installDir || state.installDir
        animatePercentTo(100)
        break
      case 'installFailed':
        state.failed = true
        showFailure(message.message)
        break
      default:
        break
    }
  }

  /**
   * 视口归一化。
   * 宿主窗口的客户区是「物理像素」(设计尺寸 × DPI/96),而 WebView2 在部分
   * 缩放下按 dpr=1 计算 CSS 视口,页面就会拿到比设计尺寸更大的逻辑宽度,
   * 布局与设计稿对不上。这里按 dpr 反比设置一次 zoom,让 CSS 视口回到设计宽度。
   * 只在 init 后做一次,之后不再干扰(重复执行会来回抖)。
   */
  function normalizeViewport() {
    var design = state.designWidth || 960
    var ratio = window.devicePixelRatio || 1
    if (window.innerWidth >= design - 40) {
      return
    }
    var target = Math.round(100 / ratio)
    var candidates = [target, target + 5, target - 5, 100, 80, 125, 110, 90]
    var index = 0
    function attempt() {
      if (window.innerWidth >= design - 40 || index >= candidates.length) {
        return
      }
      document.documentElement.style.zoom = candidates[index] + '%'
      index += 1
      setTimeout(attempt, 30)
    }
    attempt()
  }

  function boot() {
    el = {
      viewSetup: $('viewSetup'),
      viewProgress: $('viewProgress'),
      viewResult: $('viewResult'),
      titlebar: $('titlebar'),
      carousel: $('carousel'),
      carouselViewport: $('carouselViewport'),
      carouselDots: $('carouselDots'),
      carouselPrev: $('carouselPrev'),
      carouselNext: $('carouselNext'),
      carouselProgress: $('carouselProgress'),
      brandLogo: $('brandLogo'),
      brandName: $('brandName'),
      brandSub: $('brandSub'),
      brandVer: $('brandVer'),
      cardTitle: $('cardTitle'),
      updatePill: $('updatePill'),
      labelDir: $('labelDir'),
      dirHint: $('dirHint'),
      installDir: $('installDir'),
      btnBrowse: $('btnBrowse'),
      btnReset: $('btnReset'),
      labelRequired: $('labelRequired'),
      labelAvailable: $('labelAvailable'),
      diskBar: $('diskBar'),
      diskFill: $('diskFill'),
      diskRequired: $('diskRequired'),
      diskAvailable: $('diskAvailable'),
      diskWarn: $('diskWarn'),
      labelDesktop: $('labelDesktop'),
      labelStartMenu: $('labelStartMenu'),
      labelLaunch: $('labelLaunch'),
      optDesktop: $('optDesktop'),
      optStartMenu: $('optStartMenu'),
      optLaunch: $('optLaunch'),
      btnInstall: $('btnInstall'),
      btnCancel: $('btnCancel'),
      btnMin: $('btnMin'),
      btnClose: $('btnClose'),
      legal: $('legal'),
      legalPath: $('legalPath'),
      ringBar: $('ringBar'),
      ringStage: $('ringStage'),
      percentValue: $('percentValue'),
      progressTitle: $('progressTitle'),
      progressNote: $('progressNote'),
      steps: $('steps'),
      resultIcon: $('resultIcon'),
      resultGlyph: $('resultGlyph'),
      resultTitle: $('resultTitle'),
      resultNote: $('resultNote'),
      resultPath: $('resultPath'),
      btnPrimary: $('btnPrimary'),
      btnSecondary: $('btnSecondary'),
      confetti: $('confetti')
    }

    state.reduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    renderPercent(0)
    bindUi()
    applyStrings()
    buildCarousel()

    if (bridge) {
      bridge.addEventListener('message', function (event) {
        handleMessage(event.data)
      })
    } else {
      window.addEventListener('message', function (event) {
        handleMessage(event.data)
      })
    }

    // 通知宿主界面已就绪;宿主可能重复下发 init,handleInit 幂等
    send({ type: 'ready' })
    setTimeout(function () {
      send({ type: 'ready' })
    }, 900)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
