import { onMounted, onUnmounted } from 'vue'

import { usePlayerStore } from '@/stores/player.store'

// 仅文本输入类元素聚焦时空格不触发全局暂停(让空格输入文字)。
// 激活型元素(button/a/summary/role=button 等)不在此列:它们聚焦时按空格仍应暂停,
// 否则点击"下一首"等按钮后按钮保持 focus,空格会触发该按钮的默认 click(再下一首),
// 而非暂停。全局 keydown 的 preventDefault 会阻止按钮的空格激活。
const INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="menuitem"]',
  '.ant-input',
  '.ant-input-affix-wrapper',
  '.ant-input-number',
  '.ant-select',
  '.ant-select-selector'
].join(',')

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

function canUseGlobalPlaybackShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  if (target instanceof HTMLElement && target.isContentEditable) return false
  return target.closest(INTERACTIVE_SELECTOR) == null
}

export function useGlobalPlaybackShortcuts(): void {
  const player = usePlayerStore()

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.repeat) return
    if (!isSpaceKey(event) || hasModifier(event)) return
    if (!canUseGlobalPlaybackShortcut(event.target)) return

    event.preventDefault()
    player.togglePlay()
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
  })
}
