import { dirname, resolve } from 'path'

/**
 * Guardrails against self-destructive blocks: folders whose processes Windows (or
 * Spawncamp itself) needs, and process names that must never be killed or blocked.
 * Pure logic — env is injectable so unit tests don't depend on the real machine.
 */

/** Process names (lowercased) that can never be blocked or killed. */
export const PROTECTED_PROCESSES: Set<string> = new Set([
  'explorer.exe',
  'svchost.exe',
  'csrss.exe',
  'winlogon.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'smss.exe',
  'dwm.exe',
  'taskhostw.exe',
  'sihost.exe',
  'ctfmon.exe',
  'conhost.exe',
  'runtimebroker.exe',
  'spawncamp.exe',
  'electron.exe'
])

export interface SafetyEnv {
  /** e.g. C:\Windows */
  windir: string
  /** e.g. C:\Users\You */
  userProfile: string
  /** Roots that may not be blocked wholesale (subfolders are fine). */
  protectedRoots: string[]
  /** Directory containing Spawncamp's own executable. */
  appExeDir: string
}

function defaultEnv(): SafetyEnv {
  return {
    windir: process.env.WINDIR || 'C:\\Windows',
    userProfile: process.env.USERPROFILE || '',
    protectedRoots: [
      process.env.ProgramFiles || '',
      process.env['ProgramFiles(x86)'] || '',
      process.env.ProgramData || ''
    ].filter(Boolean),
    appExeDir: dirname(process.execPath)
  }
}

/** Normalize for comparison: absolute, no trailing slash, lowercased. */
function norm(p: string): string {
  return resolve(p).replace(/[\\/]+$/, '').toLowerCase()
}

/** True when `child` equals `parent` or lives anywhere under it. */
function isSameOrUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + '\\')
}

/**
 * Why a folder must not be blocked — or null if it's safe to block.
 * The returned string is shown to the user as-is.
 */
export function isDangerousFolder(folder: string, env: SafetyEnv = defaultEnv()): string | null {
  // Bare "C:" is drive-relative (resolve() would turn it into the cwd) — treat it,
  // and any "X:\"-style root, as the drive root it means to the user.
  if (/^[a-z]:[\\/]*$/i.test(folder.trim())) {
    return 'That would block an entire drive — every program on it, including Windows.'
  }
  const f = norm(folder)

  if (/^[a-z]:$/.test(f)) {
    return 'That would block an entire drive — every program on it, including Windows.'
  }

  const windir = norm(env.windir)
  // The Windows folder itself, anything above it, or anything inside it.
  if (isSameOrUnder(windir, f) || isSameOrUnder(f, windir)) {
    return 'Windows itself lives there — blocking it would break your PC.'
  }

  if (env.userProfile) {
    const profile = norm(env.userProfile)
    // The profile folder or any ancestor of it (e.g. C:\Users). Subfolders are fine.
    if (isSameOrUnder(profile, f)) {
      return 'That covers your entire user folder — pick a specific subfolder instead.'
    }
  }

  for (const root of env.protectedRoots) {
    if (norm(root) === f) {
      return 'That folder holds most of your installed programs — block a specific app folder inside it instead.'
    }
  }

  if (env.appExeDir && isSameOrUnder(norm(env.appExeDir), f)) {
    return 'Spawncamp itself lives in that folder — blocking it would shut the blocker down.'
  }

  return null
}
