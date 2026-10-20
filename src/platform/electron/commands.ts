export type DesktopCommand =
  | 'window:minimize'
  | 'window:toggle-maximize'
  | 'window:close'
  | 'window:is-maximized'
  | 'window:toggle-mini'
  | 'window:toggle-always-on-top'
  | 'api-server:start'
  | 'api-server:stop'
  | 'api-server:get-version'
  | 'api-server:check-update'
  | 'api-server:update'
  | 'api-server:health'
  | 'api-server:is-running'
  | 'api-server:restart'
  | 'font:query-system-fonts'
  | 'font:download'
  | 'download:get-default-directory'
  | 'download:select-directory'
  | 'download:validate-directory'
  | 'download:song'
  | 'download:open-file'
  | 'download:show-in-folder'
  | 'download:delete-file'
  | 'download:file-exists'
  | 'download:get-file-url'
  | 'playback-cache:get-info'
  | 'playback-cache:resolve'
  | 'playback-cache:warm'
  | 'playback-cache:enforce-limit'
  | 'playback-cache:clear'
  | 'playback-cache:remove-entry'
  | 'theme:set-source'

export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && window.muiceDesktop !== undefined
}

export async function invokeCommand<T>(command: DesktopCommand): Promise<T> {
  const desktopApi = window.muiceDesktop

  if (!desktopApi) {
    throw new Error('Electron runtime is not available')
  }

  return desktopApi.invoke<T>(command)
}
