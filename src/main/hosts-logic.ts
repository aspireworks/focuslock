/**
 * Pure hosts-file / elevated-script logic — no Electron or fs imports, so the
 * unit tests can exercise exactly what production runs.
 */

export const MARK_START = '# === Spawncamp start (managed - do not edit) ==='
export const MARK_END = '# === Spawncamp end ==='

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
export function buildHosts(current: string, domains: string[]): string {
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

/** Quote a value for a single-quoted PowerShell string (O'Brien -> O''Brien). */
export function psq(s: string): string {
  return s.replace(/'/g, "''")
}

/**
 * The elevated script. `$ErrorActionPreference = 'Stop'` + try/catch means any
 * failed step (e.g. Copy-Item onto a locked hosts file) exits 1 instead of
 * silently reporting success.
 */
export function buildPsScript(staged: string, hostsPath: string, hasDomains: boolean): string {
  const body = [`Copy-Item -LiteralPath '${psq(staged)}' -Destination '${psq(hostsPath)}' -Force`]
  if (hasDomains) {
    // Force browsers off DoH so they fall back to OS resolution (and honor the hosts file).
    body.push(
      `New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome' -Name 'DnsOverHttpsMode' -Value 'off'`,
      `New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge' -Name 'DnsOverHttpsMode' -Value 'off'`,
      `New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS' -Force | Out-Null`,
      `Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS' -Name 'Enabled' -Type DWord -Value 0`
    )
  } else {
    body.push(
      `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome' -Name 'DnsOverHttpsMode' -ErrorAction SilentlyContinue`,
      `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge' -Name 'DnsOverHttpsMode' -ErrorAction SilentlyContinue`,
      `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS' -Name 'Enabled' -ErrorAction SilentlyContinue`
    )
  }
  body.push(`ipconfig /flushdns | Out-Null`)

  return [
    `$ErrorActionPreference = 'Stop'`,
    `try {`,
    ...body.map((l) => '  ' + l),
    `} catch { exit 1 }`,
    `exit 0`
  ].join('\r\n') + '\r\n'
}

/**
 * Ground-truth check that a hosts write really landed: the managed block exists
 * iff there are domains, and every requested domain has a 0.0.0.0 line inside it.
 */
export function verifyHostsApplied(content: string, domains: string[]): boolean {
  const lines = content.split(/\r?\n/).map((l) => l.trim())
  const start = lines.indexOf(MARK_START)
  const end = lines.indexOf(MARK_END)
  if (domains.length === 0) return start === -1 && end === -1
  if (start === -1 || end === -1 || end < start) return false
  const block = lines.slice(start + 1, end)
  return domains.every((d) =>
    block.some((l) => {
      const parts = l.split(/\s+/)
      return parts[0] === '0.0.0.0' && parts[1] === d
    })
  )
}
