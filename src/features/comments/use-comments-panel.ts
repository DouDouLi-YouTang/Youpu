import { ref } from 'vue'

import type { CommentResource } from '@/domain/comment'

/**
 * Shared open/close state for the comments drawer. Module-level singletons
 * follow `use-lyric-panel.ts`: the drawer is mounted once at the app shell,
 * any page can flip it open via `openPanel(resource, title?)`. A single
 * boolean + resource ref doesn't warrant a Pinia store.
 *
 * `title` is optional context the caller already has on hand (e.g. song name,
 * playlist name) so the drawer header doesn't need to fan out into per-type
 * detail stores just to render a heading.
 */
export type CommentsPanelMode = 'drawer' | 'page'

const open = ref(false)
const target = ref<CommentResource | null>(null)
const title = ref('')
const mode = ref<CommentsPanelMode>('drawer')

export function useCommentsPanel() {
  return {
    open,
    target,
    title,
    mode,
    openPanel(
      resource: CommentResource,
      label = '',
      displayMode: CommentsPanelMode = 'drawer'
    ): void {
      target.value = resource
      title.value = label
      mode.value = displayMode
      open.value = true
    },
    close(): void {
      open.value = false
    }
  }
}
