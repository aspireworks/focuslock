import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import trayIcon from '../../resources/tray.png?asset'
import { getConfig, initStore } from './store'
import { isBlockingNow, isPanicActive, setOnAppBlocked, startEngine, stopEngine } from './engine'
import { isTampered } from './integrity'
import { recordLapse } from './stats'
import { startCommitmentScheduler } from './commitment'
import { registerIpc } from './ipc'
import {
  applyAutostart,
  installGuardTask,
  removeGuardTask,
  startGuardianLoop,
  startWatchdog
} from './watchdog'
import { initLogger } from './logger'

// A simple form UI doesn't need the GPU. Disabling it avoids GPU-process crashes
// (a known Electron flakiness) from taking down the blocker.
app.disableHardwareAcceleration()
// Needed for Windows toast notifications to display with the app's identity.
// Must match electron-builder's appId, or toasts silently vanish on installed builds.
app.setAppUserModelId('com.spawncamp.app')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isGuardian = process.argv.includes('--watchdog')
// Launched by the SpawncampGuard scheduled task (or a guardian relaunch): start
// to the tray without showing (or focusing) the window.
const fromTask = process.argv.includes('--from-task')

if (isGuardian) {
  // Lightweight guardian: no window, no engine — just relaunch the main app if it dies.
  app.on('window-all-closed', () => {})
  app.whenReady().then(() => {
    initLogger('guardian')
    startGuardianLoop()
  })
} else {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    // The guard task fires every minute even while we're running; that instance
    // exits on the lock above, and its --from-task argv means we must NOT pop
    // the window each minute. Genuine second launches still surface the window.
    app.on('second-instance', (_e, argv) => {
      if (!argv.includes('--from-task')) showWindow()
    })

    app.whenReady().then(() => {
      initLogger('main')
      initStore()
      registerIpc()
      createWindow()
      createTray()
      startEngine()
      // An out-of-band edit to config.json/panic.json costs the day's streak —
      // recorded here because stats are only initialized inside startEngine().
      if (isTampered()) recordLapse()
      // When a blocked app is caught, bring the window forward and show the lockout takeover.
      setOnAppBlocked((name) => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        showWindow()
        mainWindow.webContents.send('app-blocked', { name })
      })
      // Each morning, bring the app forward to ask for the daily commitment.
      startCommitmentScheduler(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        showWindow()
        mainWindow.webContents.send('commitment-due')
      })
      // Stay-on protection: run-on-boot + watchdog + guard task when enabled.
      // The task state is re-asserted every boot so it always matches config.
      const cfg = getConfig()
      applyAutostart(cfg.protectionEnabled)
      if (cfg.protectionEnabled) {
        startWatchdog()
        installGuardTask()
      } else {
        removeGuardTask()
      }
    })

    // Keep running in the tray even when the window is closed.
    app.on('window-all-closed', () => {
      // intentionally do nothing on Windows — Spawncamp lives in the tray
    })
  }
}

function createWindow(): void {
  // Packaged builds get no menu accelerators (Ctrl+Shift+I DevTools, Ctrl+R reload):
  // from a DevTools console any protected IPC call is one line away. The tray menu
  // is separate and unaffected. Native Ctrl+C/V in inputs works without a menu on Windows.
  if (app.isPackaged) Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'Spawncamp',
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    icon: trayIcon,
    show: false, // shown on ready-to-show below, unless this is a silent --from-task start
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      devTools: !app.isPackaged
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!fromTask) mainWindow?.show()
  })

  // X button hides to tray instead of quitting.
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromPath(trayIcon)
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    tray.setToolTip('Spawncamp')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Spawncamp', click: showWindow },
        { type: 'separator' },
        { label: 'Quit Spawncamp', click: requestQuit }
      ])
    )
    tray.on('click', showWindow)
  } catch (e) {
    console.error('[main] tray creation failed:', e)
  }
}

/** Quitting while a block is active must go through the in-app typing challenge. */
function requestQuit(): void {
  // No quitting during panic, or while stay-on protection is enabled.
  if (isPanicActive() || getConfig().protectionEnabled) {
    showWindow()
    return
  }
  if (isBlockingNow()) {
    showWindow()
    mainWindow?.webContents.send('quit-requested')
  } else {
    stopEngine()
    app.exit(0)
  }
}
