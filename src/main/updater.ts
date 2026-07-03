import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { removeGuardTask, stopWatchdog } from './watchdog'

/**
 * Auto-update via GitHub releases (publish config in electron-builder.yml).
 * Updates download in the background; installing is user-triggered from the
 * Settings banner / tray item. No challenge required — updating never weakens
 * blocking: protection re-arms when the new version boots.
 */

export type UpdateStateKind =
  | 'idle' // dev build, or no check yet
  | 'checking'
  | 'downloading'
  | 'ready' // downloaded — restart installs
  | 'up-to-date'
  | 'error'

let state: UpdateStateKind = 'idle'
let newVersion = ''
let onReadyCb: ((version: string) => void) | null = null

export function getUpdateStatus(): { state: UpdateStateKind; version: string } {
  return { state, version: newVersion }
}

/** Fired once when a download completes, so the tray menu can grow an install item. */
export function onUpdateReady(cb: (version: string) => void): void {
  onReadyCb = cb
}

export function initUpdater(): void {
  if (!app.isPackaged) return // dev builds never self-update
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => {
    if (state !== 'ready') state = 'checking'
  })
  autoUpdater.on('update-available', (info) => {
    state = 'downloading'
    newVersion = info.version
  })
  autoUpdater.on('update-not-available', () => {
    if (state !== 'ready') state = 'up-to-date'
  })
  autoUpdater.on('update-downloaded', (info) => {
    state = 'ready'
    newVersion = info.version
    console.log('[updater] update downloaded:', info.version)
    onReadyCb?.(info.version)
  })
  autoUpdater.on('error', (e) => {
    if (state !== 'ready') state = 'error'
    // Expected offline / before the releases repo exists — log, never disturb the user.
    console.error('[updater] check failed:', e?.message ?? e)
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {})
  }
  check() // on startup
  setInterval(check, 6 * 3600_000) // and every 6 hours
}

/**
 * Restart into the new version. Protection interplay: stop the watchdog and
 * guard task first so nothing relaunches the OLD exe mid-install; the new
 * version re-arms both on boot (index.ts asserts task state every start).
 */
export async function installUpdate(): Promise<void> {
  stopWatchdog()
  await removeGuardTask()
  autoUpdater.quitAndInstall(false, true) // not silent; relaunch when done
}
