import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'

export const pinia = createPinia()

/**
 * Pinia persistence plugin.
 *
 * Namespacing is done per-store via an explicit `persist.key` that already
 * carries the `muice:` prefix (e.g. `auth.store` uses `muice:auth`). We do NOT
 * configure a global `key` transform here: a global prefix combined with an
 * explicit prefixed per-store key double-prefixes the result
 * (`muice:muice:auth`), which silently breaks any code that targets the key
 * directly — e.g. logout's `localStorage.removeItem('muice:auth')` would miss
 * the real entry and leave the credential behind.
 *
 * NOTE (Sprint 1 security TODO): cookies are persisted to `localStorage` in
 * plaintext as a temporary measure. Migration to Electron main-process
 * `safeStorage` / OS keychain is tracked as a follow-up — see auth.store.
 */
pinia.use(createPersistedState())
