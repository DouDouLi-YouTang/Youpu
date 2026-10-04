/* ============================================================================
   有谱 · 安装界面轮播场景
   —— 六幕 2D 矢量动画,纯内联 SVG + CSS 动画(见 index.html 的 .scene 段)。
   设计约定:
     · viewBox 统一 360x190,画布留 10px 安全边距;
     · 线条统一圆头圆角,主体描边 2px / 细节 1.4px;
     · 只动 transform / opacity(stroke-dashoffset 仅用于两处进度环),
       所有动画走合成器,避免逐帧重排;
     · 重复元素(均衡器、歌词行、火花)在这里循环生成,避免手写几十个节点。
   ========================================================================== */
;(function () {
  'use strict'

  var uid = 0
  function nextId(prefix) {
    uid += 1
    return prefix + '-' + uid
  }

  /** 圆角矩形卡片底(每幕统一的玻璃质感画框)。 */
  function frame() {
    return (
      '<rect class="sc-card" x="10" y="12" width="340" height="166" rx="22" />' +
      '<ellipse class="sc-bloom" cx="118" cy="66" rx="150" ry="96" />' +
      '<rect class="sc-card-line" x="10.5" y="12.5" width="339" height="165" rx="21.5" />'
    )
  }

  function bar(x, y, w, h, cls, delay) {
    return (
      '<rect class="' +
      cls +
      '" x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      w +
      '" height="' +
      h +
      '" rx="' +
      h / 2 +
      '"' +
      (delay ? ' style="--d:' + delay + 's"' : '') +
      ' />'
    )
  }

  /* ------------------------------------------------------------ 1. 在线播放 */
  function scenePlayback() {
    var bars = ''
    for (var i = 0; i < 18; i++) {
      var h = 16 + (i % 5) * 6
      bars +=
        '<rect class="eq" x="' +
        (142 + i * 10) +
        '" y="' +
        (134 - h) +
        '" width="5" height="' +
        h +
        '" rx="2.5" style="--d:' +
        (i * 0.075).toFixed(3) +
        's" />'
    }
    var clip = nextId('ypArt')
    return (
      frame() +
      '<defs><clipPath id="' +
      clip +
      '"><rect x="34" y="42" width="88" height="88" rx="16" /></clipPath></defs>' +
      '<g class="sc-float">' +
      '<rect class="sc-art" x="34" y="42" width="88" height="88" rx="16" />' +
      '<g clip-path="url(#' +
      clip +
      ')"><rect class="sc-sweep" x="-70" y="34" width="44" height="104" /></g>' +
      '<g class="sc-note">' +
      '<path d="M62 98V64l30-7.6v25.2" />' +
      '<circle cx="56.6" cy="99.4" r="6.2" />' +
      '<circle cx="86.6" cy="91.8" r="6.2" />' +
      '</g>' +
      '</g>' +
      bar(142, 48, 118, 9, 'sc-fg') +
      bar(142, 64, 74, 7, 'sc-fg-dim') +
      '<g class="sc-playbtn">' +
      '<circle cx="316" cy="62" r="15" />' +
      '<path d="M311.6 55.6 322 62l-10.4 6.4z" class="sc-playglyph" />' +
      '</g>' +
      bars +
      '<rect class="sc-track" x="142" y="146" width="176" height="4" rx="2" />' +
      '<rect class="sc-trackfill" x="142" y="146" width="176" height="4" rx="2" />' +
      '<circle class="sc-dot" cx="142" cy="148" r="4" />'
    )
  }

  /* ------------------------------------------------------------ 2. 沉浸歌词 */
  function sceneLyrics() {
    var lines = [188, 236, 268, 214, 158]
    var body = ''
    for (var i = 0; i < lines.length; i++) {
      var active = i === 2
      body +=
        '<rect class="ly' +
        (active ? ' ly-active' : '') +
        '" x="' +
        (180 - lines[i] / 2) +
        '" y="' +
        (33 + i * 26) +
        '" width="' +
        lines[i] +
        '" height="' +
        (active ? 12 : 8) +
        '" rx="' +
        (active ? 6 : 4) +
        '" style="--i:' +
        i +
        '" />'
    }
    var clip = nextId('ypLy')
    return (
      frame() +
      '<defs><clipPath id="' +
      clip +
      '"><rect x="46" y="82" width="268" height="11" rx="5.5" /></clipPath></defs>' +
      '<ellipse class="ly-glow" cx="180" cy="87.5" rx="150" ry="26" />' +
      '<g class="ly-stack">' +
      body +
      '</g>' +
      '<g clip-path="url(#' +
      clip +
      ')"><rect class="ly-sweep" x="-80" y="78" width="60" height="19" /></g>' +
      '<g class="ly-playhead">' +
      '<rect x="26" y="26" width="3" height="138" rx="1.5" />' +
      '<circle cx="27.5" cy="95" r="6" />' +
      '</g>'
    )
  }

  /* ------------------------------------------------------------ 3. 桌面体验 */
  function sceneDesktop() {
    return (
      frame() +
      '<g class="sc-window">' +
      '<rect class="sc-win" x="40" y="24" width="216" height="130" rx="15" />' +
      '<path class="sc-win-line" d="M40 52h216" />' +
      '<circle class="sc-dotr" cx="57" cy="38" r="3.2" />' +
      '<circle class="sc-dotr" cx="68" cy="38" r="3.2" />' +
      '<circle class="sc-dotr" cx="79" cy="38" r="3.2" />' +
      '<rect class="sc-side" x="52" y="64" width="38" height="76" rx="9" />' +
      bar(100, 64, 84, 8, 'sc-fg') +
      bar(100, 79, 54, 6, 'sc-fg-dim') +
      '<rect class="sc-cover" x="100" y="94" width="140" height="46" rx="11" />' +
      '<g class="sc-float-slow">' +
      '<rect class="sc-mini" x="60" y="104" width="176" height="34" rx="12" />' +
      '<rect class="sc-miniart" x="68" y="111" width="20" height="20" rx="6" />' +
      bar(94, 114, 48, 6, 'sc-fg') +
      bar(94, 126, 30, 5, 'sc-fg-dim') +
      '<g class="sc-minictl">' +
      '<circle cx="206" cy="121" r="8" />' +
      '<path d="M203.6 117.4 209 121l-5.4 3.6z" class="sc-playglyph" />' +
      '</g>' +
      '<circle class="sc-minibtn" cx="224" cy="121" r="3.4" />' +
      '</g>' +
      '</g>' +
      '<g class="sc-tray">' +
      '<circle class="sc-tray-ring" cx="302" cy="84" r="24" />' +
      '<rect class="sc-tray-box" x="286" y="68" width="32" height="32" rx="10" />' +
      '<path class="sc-tray-mark" d="M304 75v13" />' +
      '<circle class="sc-tray-note" cx="300.4" cy="89.4" r="3.4" />' +
      '</g>' +
      bar(288, 116, 34, 7, 'sc-fg-dim') +
      bar(288, 130, 22, 7, 'sc-fg-dim')
    )
  }

  /* ------------------------------------------------------------ 4. 离线缓存 */
  function sceneOffline() {
    var r = 38
    var c = 2 * Math.PI * r
    return (
      frame() +
      '<g class="sc-ring">' +
      '<circle class="sc-ring-track" cx="118" cy="96" r="' +
      r +
      '" />' +
      '<circle class="sc-ring-bar" cx="118" cy="96" r="' +
      r +
      '" style="stroke-dasharray:' +
      c.toFixed(1) +
      ';stroke-dashoffset:' +
      c.toFixed(1) +
      '" />' +
      '</g>' +
      '<g class="sc-arrow">' +
      '<path d="M118 74v32" />' +
      '<path d="M105 95l13 13 13-13" />' +
      '</g>' +
      '<g class="sc-check">' +
      '<circle cx="118" cy="96" r="15" />' +
      '<path d="M111 96.5l5 5 9.5-10" />' +
      '</g>' +
      '<g class="sc-cloud">' +
      '<path d="M236 60a16 16 0 0 1 15.4 11.6A11 11 0 0 1 250 93h-26a11 11 0 0 1-1.4-21.9A16 16 0 0 1 236 60z" />' +
      '<path d="M228 66l16 22" class="sc-cloud-slash" />' +
      '</g>' +
      bar(196, 116, 118, 8, 'sc-fg') +
      bar(196, 132, 76, 6, 'sc-fg-dim') +
      '<rect class="sc-cache" x="196" y="148" width="126" height="10" rx="5" />' +
      '<rect class="sc-cache-fill" x="196" y="148" width="126" height="10" rx="5" />'
    )
  }

  /* ------------------------------------------------------------ 5. 外观随心 */
  function sceneTheme() {
    var clip = nextId('ypCover')
    var swatches = ''
    for (var i = 0; i < 3; i++) {
      swatches +=
        '<g class="sc-swatch sw' +
        i +
        '" style="--d:' +
        (i * 0.9).toFixed(2) +
        's">' +
        '<circle cx="' +
        (196 + i * 50) +
        '" cy="74" r="17" />' +
        '<circle class="sc-swatch-face" cx="' +
        (196 + i * 50) +
        '" cy="74" r="17" />' +
        '<path class="sc-swatch-tick" d="M' +
        (196 + i * 50 - 6) +
        ' 74.5l4.4 4.6 8-9" />' +
        '</g>'
    }
    return (
      frame() +
      '<defs><clipPath id="' +
      clip +
      '"><rect x="36" y="40" width="96" height="96" rx="20" /></clipPath></defs>' +
      '<rect class="sc-coverbase" x="36" y="40" width="96" height="96" rx="20" />' +
      '<g clip-path="url(#' +
      clip +
      ')">' +
      '<rect class="sc-tint t1" x="36" y="40" width="96" height="96" />' +
      '<rect class="sc-tint t2" x="36" y="40" width="96" height="96" />' +
      '<rect class="sc-tint t3" x="36" y="40" width="96" height="96" />' +
      '<rect class="sc-tint-sweep" x="-60" y="30" width="40" height="116" />' +
      '</g>' +
      '<g class="sc-covernote">' +
      '<path d="M70 112V78l34-8.6v28.4" />' +
      '<circle cx="64" cy="113.5" r="7" />' +
      '<circle cx="98" cy="104.9" r="7" />' +
      '</g>' +
      bar(150, 44, 96, 8, 'sc-fg') +
      bar(150, 60, 62, 6, 'sc-fg-dim') +
      swatches +
      '<rect class="sc-accentbar" x="36" y="152" width="288" height="8" rx="4" />' +
      '<rect class="sc-accentfill af1" x="36" y="152" width="288" height="8" rx="4" />' +
      '<rect class="sc-accentfill af2" x="36" y="152" width="288" height="8" rx="4" />' +
      '<rect class="sc-accentfill af3" x="36" y="152" width="288" height="8" rx="4" />'
    )
  }

  /* ------------------------------------------------------------ 6. 自动更新 */
  function sceneUpdate() {
    var sparks = ''
    for (var i = 0; i < 7; i++) {
      var a = ((-90 + i * 51) * Math.PI) / 180
      sparks +=
        '<circle class="sc-spark" cx="' +
        (128 + Math.cos(a) * 30).toFixed(1) +
        '" cy="' +
        (92 + Math.sin(a) * 30).toFixed(1) +
        '" r="2.6" style="--a:' +
        (i * 51 - 90) +
        'deg;--d:' +
        (i * 0.05).toFixed(2) +
        's" />'
    }
    return (
      frame() +
      '<g class="sc-refresh">' +
      '<circle class="sc-refresh-track" cx="128" cy="92" r="40" />' +
      '<path class="sc-refresh-arc" d="M158.3 63.7A40 40 0 1 1 97.7 63.7" />' +
      '<path class="sc-refresh-tip" d="M158.3 63.7l-13.4-1.6 6.4-11.9z" />' +
      '</g>' +
      '<g class="sc-sparks">' +
      sparks +
      '</g>' +
      '<g class="sc-upcheck">' +
      '<circle cx="128" cy="92" r="14" />' +
      '<path d="M121 92.5l5 5 9-9.6" />' +
      '</g>' +
      bar(196, 52, 110, 8, 'sc-fg') +
      bar(196, 68, 70, 6, 'sc-fg-dim') +
      '<rect class="sc-track" x="196" y="92" width="126" height="6" rx="3" />' +
      '<rect class="sc-upfill" x="196" y="92" width="126" height="6" rx="3" />' +
      '<rect class="sc-chip" x="196" y="116" width="88" height="22" rx="11" />' +
      '<circle class="sc-chip-dot" cx="210" cy="127" r="3.4" />' +
      bar(220, 124, 50, 6, 'sc-fg-dim') +
      '<rect class="sc-chip2" x="294" y="116" width="32" height="22" rx="11" />'
    )
  }

  window.YOUPU_SCENES = [
    { id: 'playback', name: 'featurePlayback', desc: 'featurePlaybackDesc', svg: scenePlayback() },
    { id: 'lyrics', name: 'featureLyrics', desc: 'featureLyricsDesc', svg: sceneLyrics() },
    { id: 'desktop', name: 'featureDesktop', desc: 'featureDesktopDesc', svg: sceneDesktop() },
    { id: 'offline', name: 'featureOffline', desc: 'featureOfflineDesc', svg: sceneOffline() },
    { id: 'theme', name: 'featureTheme', desc: 'featureThemeDesc', svg: sceneTheme() },
    { id: 'update', name: 'featureUpdate', desc: 'featureUpdateDesc', svg: sceneUpdate() }
  ]
})()
