/**
 * Private-data reset registry.
 *
 * Stores that hold user-private data (library, daily, …) register a reset
 * callback here. `auth.store` calls `resetAllPrivateData()` on logout / session
 * expiry to clear them, WITHOUT importing each store directly — this keeps
 * `auth.store` decoupled from business stores (no import cycles) and means a new
 * private store only has to self-register.
 *
 * Callbacks should call `useXxxStore().clear()` lazily (inside the callback), so
 * they run after Pinia is ready.
 */
type Resetter = () => void

const resetters = new Set<Resetter>()

export function registerPrivateDataReset(fn: Resetter): void {
  resetters.add(fn)
}

export function resetAllPrivateData(): void {
  resetters.forEach((fn) => {
    try {
      fn()
    } catch {
      /* a failing reset must not block the others or the logout flow */
    }
  })
}
