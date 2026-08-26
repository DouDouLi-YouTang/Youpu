export function getLocalStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}
