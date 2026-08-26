import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'
import { gsap } from 'gsap'

import type { Pos } from './useDiscoverLayout'

interface UseDiscoverEntranceOptions {
  containerRef: Ref<HTMLElement | null>
  fmRef: Ref<HTMLElement | null>
  headerRef: Ref<HTMLElement | null>
  dailyRef: Ref<HTMLElement | null>
  stageCoverRef: Ref<HTMLElement | null>
  playlists: Ref<unknown[]>
  tilePositions: Ref<Pos[]>
}

/**
 * 发现页入场编排 + 背景呼吸。
 *
 * 等 playlists 非空且 tilePositions 首次算完后,用 gsap.timeline 编排:
 * header 子元素 -> stage 容器 -> FM 卡 -> 每日推荐 -> tiles(按 bin-packing 位置排序的 stagger 波)。
 * 背景封面层缓慢呼吸(ken burns),仅非 reduced-motion。
 *
 * gsap.matchMedia 处理 prefers-reduced-motion(reduceMotion 分支 duration:0),
 * 不嵌套 gsap.context;onBeforeUnmount 调 mm.revert() 清理全部动画与 inline style。
 */
export function useDiscoverEntrance(opts: UseDiscoverEntranceOptions): void {
  let mm: ReturnType<typeof gsap.matchMedia> | null = null
  let played = false

  function play(): void {
    const container = opts.containerRef.value
    if (!container || played) return
    played = true

    mm = gsap.matchMedia()

    // 仅在用户未偏好减少动效时编排入场;reduced-motion 下元素保持 CSS 默认可见
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const header = opts.headerRef.value
      const fm = opts.fmRef.value
      const daily = opts.dailyRef.value
      const cover = opts.stageCoverRef.value

      // tiles 按 bin-packing 位置(y 升序、x 升序)排序,形成从左上到右下的入场波
      const tiles = Array.from(container.querySelectorAll<HTMLElement>('.discover-tile'))
      tiles.sort((a, b) => {
        const ay = parseFloat(a.style.top) || 0
        const ax = parseFloat(a.style.left) || 0
        const by = parseFloat(b.style.top) || 0
        const bx = parseFloat(b.style.left) || 0
        return ay - by || ax - bx
      })

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      const clear = 'transform,visibility,opacity'

      if (header) {
        tl.from(
          header.querySelectorAll(':scope > *'),
          { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.08, clearProps: clear },
          0
        )
      }
      tl.from(
        container,
        {
          autoAlpha: 0,
          scale: 0.985,
          duration: 0.5,
          transformOrigin: 'center top',
          clearProps: clear
        },
        0.05
      )
      if (fm) {
        tl.from(fm, { autoAlpha: 0, scale: 0.92, duration: 0.55, clearProps: clear }, 0.15)
      }
      if (daily) {
        tl.from(daily, { autoAlpha: 0, y: 16, duration: 0.5, clearProps: clear }, 0.3)
      }
      if (tiles.length > 0) {
        tl.from(
          tiles,
          {
            autoAlpha: 0,
            y: 10,
            scale: 0.96,
            duration: 0.45,
            stagger: { each: 0.025, from: 'start' },
            clearProps: clear
          },
          0.4
        )
      }

      // 背景封面缓慢呼吸(ken burns)
      if (cover) {
        gsap.fromTo(
          cover,
          { scale: 1.06 },
          { scale: 1.12, duration: 9, repeat: -1, yoyo: true, ease: 'sine.inOut' }
        )
      }
    })
  }

  const stopWatch = watch(
    [opts.playlists, opts.tilePositions],
    ([list, positions]) => {
      if (list.length > 0 && positions.length > 0) {
        void nextTick(play)
      }
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    stopWatch()
    mm?.revert()
    mm = null
  })
}
