import { app } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildHosts, buildPsScript, psq, verifyHostsApplied } from './hosts-logic'

export { normalizeDomain } from './hosts-logic'

const execAsync = promisify(exec)

const HOSTS = 'C:\\Windows\\System32\\drivers\\etc\\hosts'

const DECLINED_ERROR =
  'Windows didn’t allow the change — the admin prompt may have been declined.'

/**
 * Apply the desired blocked-domain set to the hosts file (+ DoH policies) via one
 * elevated PowerShell call. Triggers a single UAC prompt. Success is not taken on
 * faith: the hosts file is re-read afterwards and checked domain by domain.
 */
export async function applyHosts(domains: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const current = existsSync(HOSTS) ? readFileSync(HOSTS, 'utf-8') : ''
    const staged = join(app.getPath('userData'), 'hosts.staged')
    const scriptPath = join(app.getPath('userData'), 'fl-apply-hosts.ps1')
    writeFileSync(staged, buildHosts(current, domains), 'utf-8')
    writeFileSync(scriptPath, buildPsScript(staged, HOSTS, domains.length > 0), 'utf-8')

    // Outer wrapper: a UAC decline makes Start-Process throw (-ErrorAction Stop),
    // which the catch turns into exit 1; otherwise the elevated script's own exit
    // code is passed through.
    const inner = `Start-Process -FilePath powershell -Verb RunAs -Wait -PassThru -ErrorAction Stop -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${psq(scriptPath)}'`
    const cmd = `powershell -NoProfile -Command "try { $p = ${inner}; exit $p.ExitCode } catch { exit 1 }"`
    await execAsync(cmd, { windowsHide: true })

    // Ground truth: exit codes can lie, the file can't. Re-read and verify.
    const after = existsSync(HOSTS) ? readFileSync(HOSTS, 'utf-8') : ''
    if (!verifyHostsApplied(after, domains)) {
      console.error('[websites] hosts verification failed after apparent success')
      return { ok: false, error: DECLINED_ERROR }
    }
    console.log('[websites] applied and verified', domains.length, 'domain(s) in hosts')
    return { ok: true }
  } catch (e) {
    console.error('[websites] applyHosts failed:', e)
    return { ok: false, error: DECLINED_ERROR }
  }
}
