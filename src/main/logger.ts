import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 2 * 1024 * 1024 // rotate at 2 MB
let logFile = ''
let logsDir = ''
let started = false

export function getLogsDir(): string {
  return logsDir
}
export function getLogPath(): string {
  return logFile
}

function safe(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack || v.message
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function rotate(): void {
  try {
    if (existsSync(logFile) && statSync(logFile).size > MAX_BYTES) {
      renameSync(logFile, logFile + '.old')
    }
  } catch {
    /* ignore */
  }
}

function writeLine(level: string, args: unknown[]): void {
  try {
    rotate()
    appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${args.map(safe).join(' ')}\n`)
  } catch {
    /* never let logging crash the app */
  }
}

/**
 * Mirror console output to a file and capture crashes — so a beta tester can send
 * us their log when something misbehaves. Call once per process, early.
 */
export function initLogger(role: 'main' | 'guardian'): void {
  if (started) return
  started = true
  logsDir = join(app.getPath('userData'), 'logs')
  try {
    mkdirSync(logsDir, { recursive: true })
  } catch {
    /* ignore */
  }
  logFile = join(logsDir, role === 'guardian' ? 'guardian.log' : 'focuslock.log')

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }
  console.log = (...a: unknown[]): void => {
    orig.log(...a)
    writeLine('INFO', a)
  }
  console.info = (...a: unknown[]): void => {
    orig.info(...a)
    writeLine('INFO', a)
  }
  console.warn = (...a: unknown[]): void => {
    orig.warn(...a)
    writeLine('WARN', a)
  }
  console.error = (...a: unknown[]): void => {
    orig.error(...a)
    writeLine('ERROR', a)
  }

  process.on('uncaughtException', (e) => writeLine('FATAL', ['uncaughtException', e]))
  process.on('unhandledRejection', (e) => writeLine('FATAL', ['unhandledRejection', e]))

  writeLine('INFO', [
    `=== FocusLock ${app.getVersion()} (${role}) started — packaged=${app.isPackaged} ===`
  ])
}
