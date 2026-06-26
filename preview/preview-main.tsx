import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../src/renderer/src/App'
import '../src/renderer/src/styles.css'
import type { AppState } from '../src/renderer/src/types'

/**
 * Browser-only preview harness. Mocks the Electron `window.api` bridge with
 * representative data so the redesigned renderer can be viewed without launching
 * the real blocker. This file is never bundled into the Electron app.
 */

const CHALLENGE_TEXT =
  'harbor velvet anchor drift copper meadow signal pivot lantern tunnel orchard ember'

const S: AppState = {
  config: {
    blocklist: [
      { name: 'steam.exe', mode: 'always' },
      { name: 'EpicGamesLauncher.exe', mode: 'always' },
      { name: 'Battle.net.exe', mode: 'schedule' },
      { name: 'XboxApp.exe', mode: 'budget', dailyLimitMinutes: 60 },
      { name: 'RiotClient.exe', mode: 'always' }
    ],
    folderBlocks: [{ path: 'C:\\Games\\SteamLibrary', mode: 'always' }],
    blockedSites: ['store.steampowered.com', 'twitch.tv', 'reddit.com/r/gaming'],
    protectionEnabled: true,
    blockMessage: "Blocked. You've got this.",
    userName: 'Marcus',
    dailyGamingHours: 3,
    onboardingComplete: true,
    scheduleEnabled: true,
    schedule: {
      '1': [{ start: '09:00', end: '17:00' }],
      '2': [{ start: '09:00', end: '17:00' }],
      '3': [{ start: '09:00', end: '17:00' }],
      '4': [{ start: '09:00', end: '17:00' }],
      '5': [{ start: '09:00', end: '17:00' }]
    },
    challenge: { type: 'words', length: 400, wordCount: 140, customText: '', timerMinutes: 5 },
    panic: {
      minutes: 5,
      mantra: "This urge is temporary. What I'm building is not.",
      blockBrowsers: true
    },
    commitment: {
      enabled: true,
      text: 'I commit to being the hero of my own life and saying no to the distractions that don’t serve me.',
      time: '09:00',
      lastCommittedDate: ''
    }
  },
  status: { active: true, nextChange: null },
  killLog: [
    { name: 'steam.exe', pid: 1, time: '2026-06-23T19:14:00' },
    { name: 'EpicGamesLauncher.exe', pid: 2, time: '2026-06-23T17:02:00' },
    { name: 'Battle.net.exe', pid: 3, time: '2026-06-23T13:48:00' }
  ],
  paused: false,
  usage: { date: '2026-06-23', seconds: { 'xboxapp.exe': 22 * 60 } },
  panic: { active: false, until: 0 },
  commitmentDue: false,
  stats: {
    startDate: '2026-06-11',
    daysSinceStart: 12,
    currentStreak: 12,
    bestStreak: 21,
    totalBlocks: 218,
    weekTotal: 34,
    last7: [
      { date: '2026-06-15', count: 5 },
      { date: '2026-06-16', count: 8 },
      { date: '2026-06-17', count: 4 },
      { date: '2026-06-18', count: 10 },
      { date: '2026-06-19', count: 12 },
      { date: '2026-06-20', count: 6 },
      { date: '2026-06-21', count: 3 }
    ],
    topApps: [
      { name: 'steam.exe', count: 88 },
      { name: 'EpicGamesLauncher.exe', count: 54 },
      { name: 'Battle.net.exe', count: 39 },
      { name: 'store.steampowered.com', count: 22 }
    ],
    weekRuntime: [{ name: 'steam.exe', seconds: 66240 }]
  },
  version: '1.0.0'
}

const ok = async (): Promise<{ ok: true }> => ({ ok: true })

const mock = {
  getState: async () => S,
  listProcesses: async () => ['chrome.exe', 'discord.exe', 'spotify.exe', 'notepad.exe'],
  addApp: async (name: string, mode = 'always') => {
    if (!S.config.blocklist.some((a) => a.name === name))
      S.config.blocklist.push({ name, mode: mode as never })
    return { ok: true }
  },
  setAppMode: async (name: string, mode: string, limit?: number) => {
    const a = S.config.blocklist.find((x) => x.name === name)
    if (a) {
      a.mode = mode as never
      if (mode === 'budget') a.dailyLimitMinutes = limit ?? 60
    }
    return ok()
  },
  setPaused: async (v: boolean) => {
    S.paused = v
    return ok()
  },
  setProtection: async () => ok(),
  setBlockMessage: async (t: string) => {
    S.config.blockMessage = t
    return ok()
  },
  setName: async (name: string) => {
    S.config.userName = name.trim().slice(0, 40)
    return S.config
  },
  openLogs: async () => ok(),
  sendFeedback: async () => ok(),
  completeOnboarding: async () => {
    S.config.onboardingComplete = true
    return ok()
  },
  startPanic: async () => {
    S.panic = { active: true, until: Date.now() + S.config.panic.minutes * 60000 }
    return S.panic
  },
  setPanicConfig: async (p: { minutes?: number; mantra?: string; blockBrowsers?: boolean }) => {
    S.config.panic = { ...S.config.panic, ...p }
    return ok()
  },
  setCommitment: async (p: { enabled?: boolean; text?: string; time?: string }) => {
    S.config.commitment = { ...S.config.commitment, ...p }
    return S.config
  },
  commitToday: async () => {
    S.config.commitment.lastCommittedDate = '2026-06-25'
    S.commitmentDue = false
    return S.config
  },
  pickFolder: async () => 'C:\\Games\\NewLibrary',
  addFolder: async (path: string, mode = 'always') => {
    S.config.folderBlocks.push({ path, mode: mode as never })
    return ok()
  },
  setFolderMode: async () => ok(),
  removeFolder: async (path: string) => {
    S.config.folderBlocks = S.config.folderBlocks.filter((f) => f.path !== path)
    return ok()
  },
  addSite: async (domain: string) => {
    if (!S.config.blockedSites.includes(domain)) S.config.blockedSites.push(domain)
    return { ok: true }
  },
  // Remove is a "protected" action — return locked so the unlock challenge appears.
  removeSite: async () => ({ ok: false, reason: 'locked' }),
  removeApp: async () => ({ ok: false, reason: 'locked' }),
  pickAppFile: async () => ({ name: 'someapp.exe', path: 'C:\\someapp.exe' }),
  detectGames: async () => [
    { label: 'Steam', exe: 'steam.exe', status: 'installed', detected: true, blocked: true },
    {
      label: 'Epic Games',
      exe: 'EpicGamesLauncher.exe',
      status: 'running',
      detected: true,
      blocked: true
    },
    {
      label: 'Battle.net',
      exe: 'Battle.net.exe',
      status: 'installed',
      detected: true,
      blocked: false
    },
    { label: 'Xbox', exe: 'XboxApp.exe', status: 'not found', detected: false, blocked: false },
    {
      label: 'Riot Client',
      exe: 'RiotClient.exe',
      status: 'installed',
      detected: false,
      blocked: false
    }
  ],
  startChallenge: async () => ({ id: 'c1', kind: 'text' as const, text: CHALLENGE_TEXT }),
  verifyChallenge: async (_id: string, typed: string) => ({
    ok: typed === CHALLENGE_TEXT,
    token: 'tok'
  }),
  claimTimer: async () => ({ ok: true, token: 'tok' }),
  setSchedule: async () => ok(),
  setChallenge: async (c: Record<string, unknown>) => {
    S.config.challenge = { ...S.config.challenge, ...(c as never) }
    return ok()
  },
  requestQuit: async () => ok(),
  onQuitRequested: () => () => {},
  // Preview-only: stash the callback so a test can simulate an engine block via
  // window.__fireBlock('steam.exe'). The real bridge wires this to a main->renderer event.
  onAppBlocked: (cb: (name: string) => void) => {
    ;(window as unknown as { __fireBlock?: (n: string) => void }).__fireBlock = (n) => cb(n)
    return () => {
      ;(window as unknown as { __fireBlock?: (n: string) => void }).__fireBlock = undefined
    }
  },
  // Preview-only: window.__fireCommitment() marks the commitment due so the 2s poll
  // surfaces the morning overlay. Mirrors __fireBlock.
  onCommitmentDue: (cb: () => void) => {
    ;(window as unknown as { __fireCommitment?: () => void }).__fireCommitment = () => {
      S.commitmentDue = true
      cb()
    }
    return () => {
      ;(window as unknown as { __fireCommitment?: () => void }).__fireCommitment = undefined
    }
  }
}

;(window as unknown as { api: typeof mock }).api = mock

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
