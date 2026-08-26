import { isElectronRuntime } from '@platform/electron/commands'

export function getRuntimeName(): 'electron' | 'browser' {
  return isElectronRuntime() ? 'electron' : 'browser'
}
