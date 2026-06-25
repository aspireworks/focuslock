import { app } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

const HOSTS = 'C:\\Windows\\System32\\drivers\\etc\\hosts'
const MARK_START = '# === Spawncamp start (managed - do not edit) ==='
const MARK_END = '# === Spawncamp end ==='

/** Strip protocol/path/www and validate. Returns the bare domain, or null if invalid. */
export function normalizeDomain(input: string): string | null {
  let s = String(input).trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z]+:\/\//, '') // protocol
  s = s.split('/')[0].split('?')[0].split('#')[0] // path/query/fragment
  s = s.split(':')[0] // port
  s = s.replace(/^www\./, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null
  return s
}

/** Rebuild the hosts file content: preserve everything except our managed block. */
function buildHosts(current: string, domains: string[]): string {
  const out: string[] = []
  let inBlock = false
  for (const line of current.split(/\r?\n/)) {
    const t = line.trim()
    if (t === MARK_START) {
      inBlock = true
      continue
    }
    if (t === MARK_END) {
      inBlock = false
      continue
    }
    if (!inBlock) out.push(line)
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop()

  if (domains.length === 0) return out.join('\r\n') + '\r\n'

  const block = [MARK_START]
  for (const d of domains) {
    block.push(`0.0.0.0 ${d}`)
    block.push(`0.0.0.0 www.${d}`)
  }
  block.push(MARK_END)
  return out.join('\r\n') + '\r\n\r\n' + block.join('\r\n') + '\r\n'
}

function buildPsScript(staged: string, hasDomains: boolean): string {
  const lines = [`Copy-Item -LiteralPath '${staged}' -Destination '${HOSTS}' -Force`]
  if (hasDomains) {
    // Force browsers off DoH so they fall back to OS resolution (and honor the hosts file).
    lines.push(
      `New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome' -Name 'DnsOverHttpsMode' -Value 'off'`,
      `New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge' -Name 'DnsOverHttpsMode' -Value 'off'`,
      `New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS' -Name 'Enabled' -Type DWord -Value 0`
    )
  } else {
    lines.push(
      `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome' -Name 'DnsOverHttpsMode' -ErrorAction SilentlyContinue`,
      `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge' -Name 'DnsOverHttpsMode' -ErrorAction SilentlyContinue`,
      `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS' -Name 'Enabled' -ErrorAction SilentlyContinue`
    )
  }
  lines.push(`ipconfig /flushdns | Out-Null`)
  return lines.join('\r\n') + '\r\n'
}

/**
 * Apply the desired blocked-domain set to the hosts file (+ DoH policies) via one
 * elevated PowerShell call. Triggers a single UAC prompt.
 */
export async function applyHosts(domains: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const current = existsSync(HOSTS) ? readFileSync(HOSTS, 'utf-8') : ''
    const staged = join(app.getPath('userData'), 'hosts.staged')
    const scriptPath = join(app.getPath('userData'), 'fl-apply-hosts.ps1')
    writeFileSync(staged, buildHosts(current, domains), 'utf-8')
    writeFileSync(scriptPath, buildPsScript(staged, domains.length > 0), 'utf-8')

    const inner = `Start-Process -FilePath powershell -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}'`
    const cmd = `powershell -NoProfile -Command "$p = ${inner}; exit $p.ExitCode"`
    await execAsync(cmd, { windowsHide: true })
    console.log('[websites] applied', domains.length, 'domain(s) to hosts')
    return { ok: true }
  } catch (e) {
    console.error('[websites] applyHosts failed:', e)
    return { ok: false, error: 'Could not update the hosts file — the admin prompt may have been declined.' }
  }
}
