// Standalone test of the hosts-merge + domain-normalize logic (mirrors websites.ts).
const MARK_START = '# === FocusLock start (managed - do not edit) ==='
const MARK_END = '# === FocusLock end ==='

function normalizeDomain(input) {
  let s = String(input).trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z]+:\/\//, '')
  s = s.split('/')[0].split('?')[0].split('#')[0]
  s = s.split(':')[0]
  s = s.replace(/^www\./, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null
  return s
}

function buildHosts(current, domains) {
  const out = []
  let inBlock = false
  for (const line of current.split(/\r?\n/)) {
    const t = line.trim()
    if (t === MARK_START) { inBlock = true; continue }
    if (t === MARK_END) { inBlock = false; continue }
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

let pass = 0, fail = 0
function check(name, cond) { if (cond) { pass++; console.log('  ok:', name) } else { fail++; console.log('  FAIL:', name) } }

// normalizeDomain
check('strips https/www/path', normalizeDomain('https://www.reddit.com/r/all') === 'reddit.com')
check('keeps subdomain', normalizeDomain('m.youtube.com') === 'm.youtube.com')
check('strips port', normalizeDomain('example.com:8080') === 'example.com')
check('rejects junk', normalizeDomain('not a domain') === null)
check('rejects empty', normalizeDomain('   ') === null)

// buildHosts
const userHosts = '127.0.0.1 localhost\r\n# my custom entry\r\n10.0.0.5 nas.local\r\n'
const h1 = buildHosts(userHosts, ['reddit.com'])
check('preserves user entries', h1.includes('127.0.0.1 localhost') && h1.includes('10.0.0.5 nas.local'))
check('adds the domain (0.0.0.0)', h1.includes('0.0.0.0 reddit.com') && h1.includes('0.0.0.0 www.reddit.com'))
check('has markers', h1.includes(MARK_START) && h1.includes(MARK_END))

// idempotency: applying again must not duplicate the managed block
const h2 = buildHosts(h1, ['reddit.com', 'x.com'])
check('no duplicate start markers', (h2.match(/FocusLock start/g) || []).length === 1)
check('replaced block has both domains', h2.includes('0.0.0.0 x.com') && h2.includes('0.0.0.0 reddit.com'))
check('still preserves user entries', h2.includes('10.0.0.5 nas.local'))

// clearing: empty domains removes the managed block but keeps user entries
const h3 = buildHosts(h2, [])
check('cleared block gone', !h3.includes('FocusLock start') && !h3.includes('0.0.0.0 reddit.com'))
check('user entries survive clear', h3.includes('127.0.0.1 localhost') && h3.includes('10.0.0.5 nas.local'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
