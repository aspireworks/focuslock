import { existsSync } from 'fs'

export interface GameDetectResult {
  label: string
  exe: string
  status: 'running' | 'installed' | 'not found'
  detected: boolean
  blocked: boolean
}

interface CatalogEntry {
  label: string
  exe: string
  /** Known install locations to check for "installed" detection. */
  paths: string[]
}

const PF = process.env['ProgramFiles'] || 'C:\\Program Files'
const PFX = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

/**
 * Common Windows game launchers. `exe` is what we block (matched by name).
 * UWP/Store apps (Xbox, Roblox) have no stable path, so they're detected only
 * when running.
 */
const CATALOG: CatalogEntry[] = [
  { label: 'Steam', exe: 'steam.exe', paths: [`${PFX}\\Steam\\steam.exe`, `${PF}\\Steam\\steam.exe`] },
  {
    label: 'Epic Games',
    exe: 'EpicGamesLauncher.exe',
    paths: [
      `${PFX}\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe`,
      `${PFX}\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe`
    ]
  },
  { label: 'Xbox', exe: 'XboxPcApp.exe', paths: [] },
  { label: 'Battle.net', exe: 'Battle.net.exe', paths: [`${PFX}\\Battle.net\\Battle.net.exe`] },
  {
    label: 'Riot Client',
    exe: 'RiotClientServices.exe',
    paths: [
      'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
      `${PFX}\\Riot Games\\Riot Client\\RiotClientServices.exe`
    ]
  },
  {
    label: 'League of Legends',
    exe: 'LeagueClient.exe',
    paths: ['C:\\Riot Games\\League of Legends\\LeagueClient.exe']
  },
  {
    label: 'EA app',
    exe: 'EADesktop.exe',
    paths: [`${PF}\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe`]
  },
  {
    label: 'Ubisoft Connect',
    exe: 'UbisoftConnect.exe',
    paths: [`${PFX}\\Ubisoft\\Ubisoft Game Launcher\\UbisoftConnect.exe`]
  },
  { label: 'GOG Galaxy', exe: 'GalaxyClient.exe', paths: [`${PFX}\\GOG Galaxy\\GalaxyClient.exe`] },
  { label: 'Roblox', exe: 'RobloxPlayerBeta.exe', paths: [] },
  {
    label: 'Minecraft',
    exe: 'MinecraftLauncher.exe',
    paths: [`${PFX}\\Minecraft Launcher\\MinecraftLauncher.exe`]
  }
]

const RANK: Record<GameDetectResult['status'], number> = {
  running: 0,
  installed: 1,
  'not found': 2
}

/** Classify each catalog entry against what's running and what's already blocked. */
export function detectGames(running: string[], blocklist: string[]): GameDetectResult[] {
  const runset = new Set(running.map((r) => r.toLowerCase()))
  const blockset = new Set(blocklist.map((b) => b.toLowerCase()))
  return CATALOG.map((g) => {
    const isRunning = runset.has(g.exe.toLowerCase())
    const isInstalled = !isRunning && g.paths.some((p) => existsSync(p))
    const status: GameDetectResult['status'] = isRunning
      ? 'running'
      : isInstalled
        ? 'installed'
        : 'not found'
    return {
      label: g.label,
      exe: g.exe,
      status,
      detected: isRunning || isInstalled,
      blocked: blockset.has(g.exe.toLowerCase())
    }
  }).sort((a, b) => RANK[a.status] - RANK[b.status] || a.label.localeCompare(b.label))
}
