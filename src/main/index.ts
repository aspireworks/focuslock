import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import trayIcon from '../../resources/tray.png?asset'
import { getConfig, initStore } from './store'
import { isBlockingNow, isPanicActive, setOnAppBlocked, startEngine, stopEngine } from './engine'
import { registerIpc } from './ipc'
import { applyAutostart, startGuardianLoop, startWatchdog } from './watchdog'
import { initLogger } from './logger'

// A simple form UI doesn't need the GPU. Disabling it avoids GPU-process crashes
// (a known Electron flakiness) from taking down the blocker.
app.disableHardwareAcceleration()
// Needed for Windows toast notifications to display with the app's identity.
app.setAppUserModelId('FocusLock')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isGuardian = process.argv.includes('--watchdog')

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
    app.on('second-instance', showWindow)

    app.whenReady().then(() => {
      initLogger('main')
      initStore()
      registerIpc()
      createWindow()
      createTray()
      startEngine()
      // When a blocked app is caught, bring the window forward and show the lockout takeover.
      setOnAppBlocked((name) => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        showWindow()
        mainWindow.webContents.send('app-blocked', { name })
      })
      // Stay-on protection: run-on-boot + watchdog when enabled.
      const cfg = getConfig()
      applyAutostart(cfg.protectionEnabled)
      if (cfg.protectionEnabled) startWatchdog()
    })

    // Keep running in the tray even when the window is closed.
    app.on('window-all-closed', () => {
      // intentionally do nothing on Windows — FocusLock lives in the tray
    })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'FocusLock',
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    icon: trayIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
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
    tray.setToolTip('FocusLock')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open FocusLock', click: showWindow },
        { type: 'separator' },
        { label: 'Quit FocusLock', click: requestQuit }
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
