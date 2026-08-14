// Privacy-safe operator self-check. Light Electrum probe only.
// Rejects private / metadata targets (SSRF). Never fetches the anon set.

const dns = require('dns').promises
const net = require('net')
const fs = require('fs')
const path = require('path')
const { probeServer } = require('./probe')

const INBOX_FILE = path.join(__dirname, '..', 'data', 'operator-inbox.json')
const buckets = new Map()

function isBlockedIp(ip) {
  if (!ip) return true
  const v = net.isIP(ip)
  if (v === 4) {
    const p = ip.split('.').map(Number)
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 169 && p[1] === 254) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true
    return false
  }
  if (v === 6) {
    const n = ip.toLowerCase()
    if (n === '::1' || n === '::') return true
    if (n.startsWith('fe80:') || n.startsWith('fec0:')) return true
    if (n.startsWith('fc') || n.startsWith('fd')) return true
    if (n.startsWith('::ffff:')) return isBlockedIp(n.slice(7))
    return false
  }
  return true
}

function fail(msg, status) {
  const e = new Error(msg)
  e.status = status || 400
  return e
}

async function assertPublicHost(host) {
  const h = String(host || '')
    .trim()
    .toLowerCase()
  if (!h || h.length > 253) throw fail('invalid host')
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.lan') ||
    h === 'metadata.google.internal' ||
    h === 'metadata'
  ) {
    throw fail('blocked host')
  }
  if (net.isIP(h)) {
    if (isBlockedIp(h)) throw fail('private address not allowed')
    return { host: h, connectIp: h }
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(h)) {
    throw fail('invalid host')
  }
  let addrs
  try {
    addrs = await dns.lookup(h, { all: true, verbatim: true })
  } catch {
    throw fail('dns lookup failed', 400)
  }
  if (!addrs.length) throw fail('dns lookup failed', 400)
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw fail('host resolves to a private address')
  }
  const preferred = addrs.find((a) => a.family === 4) || addrs[0]
  return { host: h, connectIp: preferred.address }
}

function rateLimit(ip) {
  const now = Date.now()
  let b = buckets.get(ip)
  if (!b || now - b.windowStart > 3_600_000) {
    b = { windowStart: now, count: 0, last: 0 }
    buckets.set(ip, b)
  }
  if (now - b.last < 12_000) {
    const wait = Math.ceil((12_000 - (now - b.last)) / 1000)
    throw fail(`rate limited — wait ${wait}s`, 429)
  }
  if (b.count >= 20) throw fail('hourly check limit reached (20)', 429)
  b.last = now
  b.count++
}

function parseTarget(body) {
  let host = String((body && (body.host || body.server)) || '')
    .trim()
    .toLowerCase()
  let port = Number((body && body.port) || 50002)
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (host.includes(':') && !net.isIP(host)) {
    const i = host.lastIndexOf(':')
    const p = Number(host.slice(i + 1))
    if (Number.isInteger(p) && p > 0) {
      port = p
      host = host.slice(0, i)
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('invalid port')
  return { host, port }
}

function recordInbox(result) {
  try {
    fs.mkdirSync(path.dirname(INBOX_FILE), { recursive: true })
    let arr = []
    if (fs.existsSync(INBOX_FILE)) {
      const raw = JSON.parse(fs.readFileSync(INBOX_FILE, 'utf8'))
      if (Array.isArray(raw)) arr = raw
    }
    arr.push({
      at: new Date().toISOString(),
      host: result.host,
      port: result.port,
      ok: result.ok,
      height: result.height,
      spark: result.spark_latest_coin_id,
    })
    fs.writeFileSync(INBOX_FILE, JSON.stringify(arr.slice(-80)))
  } catch {
    /* inbox is best-effort */
  }
}

async function selfCheck(body, clientIp, fleetSnapshot) {
  rateLimit(clientIp || 'unknown')
  const { host, port } = parseTarget(body)
  const resolved = await assertPublicHost(host)
  const row = await probeServer(
    {
      id: 'selfcheck',
      name: resolved.host,
      host: resolved.host,
      connectIp: resolved.connectIp,
      port,
      operator: 'self-check',
      used_by: [],
    },
    10_000,
  )
  const fleet = fleetSnapshot || {}
  const eps = fleet.endpoints || []
  const ref = fleet.reference
  const spark = fleet.spark_consensus
  const lag = row.height != null && ref != null ? ref - row.height : null
  const sparkMatch =
    spark != null && row.spark_latest_coin_id != null ? row.spark_latest_coin_id === spark : null
  const listed = eps.find((e) => e.host === resolved.host && Number(e.port) === port)
  const notes = []
  if (!row.ok) {
    notes.push('Host did not return a chain tip. Confirm ElectrumX TLS on this port (usually 50002).')
  } else {
    if (lag != null && lag > 2) notes.push(`Tip is ${lag} blocks behind fleet reference ${ref}.`)
    else if (lag != null) notes.push(`Tip is within ${lag} blocks of fleet reference ${ref}.`)
    if (sparkMatch === false) notes.push('Spark coin id does not match the live fleet consensus.')
    if (sparkMatch === true) notes.push('Spark coin id matches the live fleet.')
    if (row.spark_latest_coin_id == null) notes.push('Spark coin id missing — this host may not serve Spark.')
    if (row.tls_days_left != null && row.tls_days_left < 0) notes.push('TLS certificate is expired.')
    else if (row.tls_days_left != null && row.tls_days_left < 14) {
      notes.push(`TLS expires in ${row.tls_days_left} days.`)
    }
    if (listed) notes.push(`Already in the curated registry as ${listed.id}.`)
    else notes.push('Not in the curated registry. Use the snippet below in a GitHub PR if this is a public wallet default.')
  }
  const slug = resolved.host.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'operator-host'
  const snippet = `{ id: '${slug}', name: '${resolved.host}', host: '${resolved.host}', port: ${port}, operator: 'YOUR_NAME', used_by: [] },`
  const result = {
    ok: !!row.ok,
    host: resolved.host,
    port,
    version: row.version,
    height: row.height,
    latency_ms: row.latency_ms,
    tls_valid_to: row.tls_valid_to,
    tls_days_left: row.tls_days_left,
    spark_latest_coin_id: row.spark_latest_coin_id,
    error: row.error,
    vs_fleet: {
      reference: ref || null,
      lag,
      spark_consensus: spark || null,
      spark_match: sparkMatch,
      in_registry: !!listed,
      registry_id: listed ? listed.id : null,
    },
    notes,
    privacy:
      'Light probe only (server.version, blockchain.headers.subscribe, spark.getsparklatestcoinid). No anon-set download, no addresses, no keys.',
    registry_snippet: snippet,
    contribute: 'https://github.com/firostatus/Firostatus/tree/main',
  }
  recordInbox(result)
  return result
}

module.exports = { selfCheck, assertPublicHost, isBlockedIp }
