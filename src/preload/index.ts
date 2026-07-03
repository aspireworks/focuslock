import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('get-state'),
  listProcesses: () => ipcRenderer.invoke('list-processes') as Promise<string[]>,

  addApp: (name: string, mode?: string, dailyLimitMinutes?: number) =>
    ipcRenderer.invoke('add-app', name, mode, dailyLimitMinutes),
  setAppMode: (name: string, mode: string, dailyLimitMinutes?: number, token?: string) =>
    ipcRenderer.invoke('set-app-mode', name, mode, dailyLimitMinutes, token),
  setPaused: (value: boolean) => ipcRenderer.invoke('set-paused', value),
  setProtection: (enabled: boolean, token?: string) =>
    ipcRenderer.invoke('set-protection', enabled, token),
  setBlockMessage: (text: string) => ipcRenderer.invoke('set-block-message', text),
  setName: (name: string) => ipcRenderer.invoke('set-name', name),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  sendFeedback: () => ipcRenderer.invoke('send-feedback'),
  completeOnboarding: (payload: {
    name: string
    dailyGamingHours: number
    apps: string[]
    mode: string
    sites: string[]
    commitmentText?: string
    commitmentTime?: string
  }) => ipcRenderer.invoke('complete-onboarding', payload),

  setCommitment: (patch: { enabled?: boolean; text?: string; time?: string }) =>
    ipcRenderer.invoke('set-commitment', patch),
  commitToday: () => ipcRenderer.invoke('commit-today'),

  startPanic: () =>
    ipcRenderer.invoke('start-panic') as Promise<{ active: boolean; until: number }>,
  setPanicConfig: (panic: { minutes?: number; mantra?: string; blockBrowsers?: boolean }) =>
    ipcRenderer.invoke('set-panic-config', panic),

  pickFolder: () => ipcRenderer.invoke('pick-folder') as Promise<string | null>,
  addFolder: (path: string, mode?: string) => ipcRenderer.invoke('add-folder', path, mode),
  setFolderMode: (path: string, mode: string, token?: string) =>
    ipcRenderer.invoke('set-folder-mode', path, mode, token),
  removeFolder: (path: string, token?: string) =>
    ipcRenderer.invoke('remove-folder', path, token),

  addSite: (domain: string) => ipcRenderer.invoke('add-site', domain),
  removeSite: (domain: string, token?: string) =>
    ipcRenderer.invoke('remove-site', domain, token),

  pickAppFile: () =>
    ipcRenderer.invoke('pick-app-file') as Promise<{ name: string; path: string } | null>,
  detectGames: () =>
    ipcRenderer.invoke('detect-games') as Promise<
      Array<{ label: string; exe: string; status: string; detected: boolean; blocked: boolean }>
    >,

  startChallenge: () =>
    ipcRenderer.invoke('start-challenge') as Promise<{
      id: string
      kind: 'text' | 'timer'
      text?: string
      endsAt?: number
    }>,
  verifyChallenge: (id: string, typed: string) =>
    ipcRenderer.invoke('verify-challenge', id, typed) as Promise<{ ok: boolean; token?: string }>,
  claimTimer: (id: string) =>
    ipcRenderer.invoke('claim-timer', id) as Promise<{ ok: boolean; token?: string }>,
  exemptApp: (name: string, token?: string) =>
    ipcRenderer.invoke('exempt-app', name, token) as Promise<{
      ok: boolean
      minutes?: number
      error?: string
    }>,

  removeApp: (name: string, token?: string) =>
    ipcRenderer.invoke('remove-app', name, token),
  setSchedule: (schedule: unknown, scheduleEnabled: boolean, token?: string) =>
    ipcRenderer.invoke('set-schedule', schedule, scheduleEnabled, token),
  setChallenge: (
    challenge: {
      type?: string
      length?: number
      wordCount?: number
      customText?: string
      timerMinutes?: number
      exemptMinutes?: number
    },
    token?: string
  ) => ipcRenderer.invoke('set-challenge', challenge, token),
  requestQuit: (token?: string) => ipcRenderer.invoke('request-quit', token),

  /** Fired by the tray "Quit" item when a block is active. Returns an unsubscribe fn. */
  onQuitRequested: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('quit-requested', listener)
    return () => {
      ipcRenderer.removeListener('quit-requested', listener)
    }
  },

  /** Fired when the engine catches a blocked app, to pop the lockout. Returns an unsubscribe fn. */
  onAppBlocked: (cb: (name: string) => void) => {
    const listener = (_e: unknown, payload: { name: string }): void => cb(payload?.name ?? '')
    ipcRenderer.on('app-blocked', listener)
    return () => {
      ipcRenderer.removeListener('app-blocked', listener)
    }
  },

  /** Fired each morning when the daily commitment comes due. Returns an unsubscribe fn. */
  onCommitmentDue: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('commitment-due', listener)
    return () => {
      ipcRenderer.removeListener('commitment-due', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
