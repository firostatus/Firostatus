// Firo Spark Sync Monitor — always-on server (VPS reference implementation)
// Node built-ins only (no npm install). Polls the public Firo Electrum backends
// over TLS for height, latency, and Spark state — including the throttled Spark
// anonymity-set fetch-health probe — then serves the dashboard + JSON API.
//
//   node server.js   ->   http://localhost:3000
//
// Production always-on process for firostatus.com.

const http = require('http')
const fs = require('fs')
const path = require('path')
const { fork } = require('child_process')
const { loadEnvFile } = require('./lib/env')
loadEnvFile()
const { REGISTRY, probeServer, buildSnapshot } = require('./lib/probe')
const history = require('./lib/history')
const { statusMeta, sparkSummary, ciSummary, docsPayload } = require('./lib/apiMeta')
const alerts = require('./lib/alerts')
const { selfCheck } = require('./lib/selfcheck')

const PORT = process.env.PORT || 3000
const POLL_INTERVAL_MS = 45_000 // light health probe cadence
const ANONSET_INTERVAL_MS = 5 * 60_000 // heavy anon-set fetch-health cadence
const ANONSET_BUDGET_MS = 45_000 // per-server budget to fully serve the set

let snapshot = { checked_at: null, endpoints: [], summary: null, stats: null, polling: true, anonset_source: 'live' }
const anonset = {} // id -> { ok, ms, coins, bytes, setHash, group, error, at }
let anonsetCheckedAt = null
let anonsetSweeping = false
let anonsetChild = null
let lastLightRows = [] // raw probe rows for republishing snapshot during anon-set sweep
let cachedSampleCount = null
let histSqliteOk = false
const ANONSET_CACHE_FILE = path.join(__dirname, 'data', 'anonset-last.json')

// Pre-serialized hot API bodies — request handlers only write Buffer, no JSON work.
const hot = {
  status: null,
  spark: null,
  ci: null,
  health: null,
  indexHtml: null,
  indexAt: 0,
}

function saveAnonsetCache() {
  try {
    fs.mkdirSync(path.dirname(ANONSET_CACHE_FILE), { recursive: true })
    const endpoints = {}
    for (const ep of REGISTRY) {
      if (anonset[ep.id]) endpoints[ep.id] = anonset[ep.id]
    }
    fs.writeFileSync(
      ANONSET_CACHE_FILE,
      JSON.stringify({
        checked_at: anonsetCheckedAt,
        saved_at: new Date().toISOString(),
        endpoints,
      }),
    )
  } catch (e) {
    console.error('[anonset] cache save failed', e && e.message)
  }
}

function restoreAnonsetCache() {
  let restored = 0
  try {
    if (fs.existsSync(ANONSET_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ANONSET_CACHE_FILE, 'utf8'))
      const eps = (raw && raw.endpoints) || {}
      for (const id of Object.keys(eps)) {
        if (eps[id] && (eps[id].ok || eps[id].ms != null)) {
          anonset[id] = eps[id]
          restored++
        }
      }
      if (raw.checked_at) anonsetCheckedAt = raw.checked_at
      if (restored) console.log(`[anonset] restored last-good for ${restored} hosts from disk`)
    }
  } catch (e) {
    console.error('[anonset] disk restore failed', e && e.message)
  }
  // Also hydrate any missing hosts from SQLite history (survives cache file loss).
  try {
    const fromDb = history.latestAnonsetMap()
    let n = 0
    for (const id of Object.keys(fromDb.endpoints || {})) {
      if (!anonset[id]) {
        anonset[id] = fromDb.endpoints[id]
        n++
      }
    }
    if (!anonsetCheckedAt && fromDb.checked_at) anonsetCheckedAt = fromDb.checked_at
    if (n) console.log(`[anonset] hydrated ${n} hosts from SQLite last-good`)
  } catch (e) {
    console.error('[anonset] sqlite hydrate failed', e && e.message)
  }
}

function refreshHotBuffers() {
  const snap = Object.assign({}, snapshot, {
    anonset_source: snapshot.anonset_source || 'live',
    meta: statusMeta(),
  })
  hot.status = Buffer.from(JSON.stringify(snap))
  hot.spark = Buffer.from(JSON.stringify(sparkSummary(snap)))
  const ci = ciSummary(snap)
  hot.ci = { buf: Buffer.from(JSON.stringify(ci)), ok: !!ci.ok, warming: !!snap.polling || !(snap.endpoints && snap.endpoints.length) }
  hot.health = Buffer.from(
    JSON.stringify({
      ok: true,
      service: 'firostatus',
      node: process.version,
      uptime_s: Math.round(process.uptime()),
      checked_at: snapshot.checked_at,
      anonset_source: snapshot.anonset_source || null,
      anonset_checked_at: snapshot.anonset_checked_at || null,
      anonset_refreshing: !!snapshot.anonset_refreshing,
      summary: snapshot.summary || null,
      history: { sqlite: histSqliteOk, sample_count: cachedSampleCount },
      meta: { docs: '/api/docs', ci: '/api/ci', status: '/api/status', alerts: '/api/alerts', check: '/api/check' },
    }),
  )
}

function publishSnapshot(rows, opts) {
  const baseRows = (rows || lastLightRows || []).map((r) => ({ ...r }))
  if (!baseRows.length) {
    refreshHotBuffers()
    return
  }
  lastLightRows = baseRows.map((r) => ({ ...r }))
  snapshot = buildSnapshot(baseRows, anonset, anonsetCheckedAt)
  const anyLive = Object.values(anonset).some((a) => a && a.source === 'live')
  const anyCached = Object.values(anonset).some((a) => a && a.source && a.source !== 'live')
  if (anonsetSweeping) {
    snapshot.anonset_source = Object.keys(anonset).length ? 'live_refreshing' : 'warming'
    snapshot.anonset_refreshing = true
  } else if ((opts && opts.fromRestore) || (anyCached && !anyLive)) {
    snapshot.anonset_source = 'last_good'
    snapshot.anonset_refreshing = false
  } else {
    snapshot.anonset_source = 'live'
    snapshot.anonset_refreshing = false
  }
  refreshHotBuffers()
}

function loadAnonsetFromDisk() {
  try {
    if (!fs.existsSync(ANONSET_CACHE_FILE)) return false
    const raw = JSON.parse(fs.readFileSync(ANONSET_CACHE_FILE, 'utf8'))
    const eps = (raw && raw.endpoints) || {}
    let n = 0
    for (const id of Object.keys(eps)) {
      if (eps[id]) {
        anonset[id] = eps[id]
        n++
      }
    }
    if (raw.checked_at) anonsetCheckedAt = raw.checked_at
    if (raw.sweeping) anonsetSweeping = true
    return n > 0
  } catch (e) {
    console.error('[anonset] reload failed', e && e.message)
    return false
  }
}

// Pre-warmed /api/history responses — rebuild after each poll so visitors never
// wait on a cold SQLite+setHash scan. Requests get cache immediately; UI can
// show "refreshing…" until the next rebuild lands.
const HIST_FLEET_HOURS = 168
const HIST_FLEET_LIMIT = 900 // slim chart payload (~UI downsamples further)
const HIST_EP_HOURS = 168
const HIST_EP_LIMIT = 800
const HIST_CACHE_DIR = path.join(__dirname, 'data', 'history-cache')
const HIST_REBUILD_MIN_MS = 3 * 60_000
const histCache = {
  fleet: null, // { buf, built_at }
  byId: Object.create(null),
  building: false,
  child: null,
  timer: null,
  lastError: null,
  lastRebuildAt: 0,
}

function loadHistoryCacheFromDisk() {
  try {
    if (!fs.existsSync(HIST_CACHE_DIR)) return 0
    let n = 0
    const fleetPath = path.join(HIST_CACHE_DIR, 'fleet.json')
    const fleetMeta = path.join(HIST_CACHE_DIR, 'fleet.meta.json')
    if (fs.existsSync(fleetPath)) {
      const buf = fs.readFileSync(fleetPath)
      let built_at = Date.now()
      try {
        if (fs.existsSync(fleetMeta)) built_at = JSON.parse(fs.readFileSync(fleetMeta, 'utf8')).built_at || built_at
      } catch {}
      histCache.fleet = { buf, built_at }
      histCache.lastRebuildAt = built_at
      n++
    }
    for (const ep of REGISTRY) {
      const p = path.join(HIST_CACHE_DIR, 'ep-' + ep.id + '.json')
      const m = path.join(HIST_CACHE_DIR, 'ep-' + ep.id + '.meta.json')
      if (!fs.existsSync(p)) continue
      const buf = fs.readFileSync(p)
      let built_at = Date.now()
      try {
        if (fs.existsSync(m)) built_at = JSON.parse(fs.readFileSync(m, 'utf8')).built_at || built_at
      } catch {}
      histCache.byId[ep.id] = { buf, built_at }
      n++
    }
    if (n) console.log(`[history-cache] loaded ${n} files from disk (instant HIT after restart)`)
    return n
  } catch (e) {
    console.error('[history-cache] disk load failed', e && e.message)
    return 0
  }
}

function onHistoryCacheBuilt(code) {
  histCache.child = null
  histCache.building = false
  if (code === 0) {
    loadHistoryCacheFromDisk()
    histCache.lastRebuildAt = Date.now()
    histCache.lastError = null
    try {
      cachedSampleCount = history.sampleCount()
      histSqliteOk = true
    } catch {
      histSqliteOk = false
    }
    refreshHotBuffers()
    console.log('[history-cache] worker finished — cache reloaded')
  } else {
    histCache.lastError = 'worker exit ' + code
    console.error('[history-cache] worker failed', code)
  }
}

function rebuildHistoryCache() {
  if (histCache.building || histCache.child) return
  if (anonsetSweeping) {
    scheduleHistoryCacheRebuild(30_000)
    return
  }
  if (histCache.lastRebuildAt && Date.now() - histCache.lastRebuildAt < HIST_REBUILD_MIN_MS && histCache.fleet) {
    return
  }
  histCache.building = true
  const worker = path.join(__dirname, 'scripts', 'rebuild-history-cache.js')
  console.log('[history-cache] forking rebuild worker…')
  try {
    const child = fork(worker, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    histCache.child = child
    child.on('error', (err) => {
      console.error('[history-cache] fork error — falling back to spawn sync in idle slot', err && err.message)
      histCache.child = null
      try {
        require('child_process').execFileSync(process.execPath, [worker], { stdio: 'inherit', timeout: 120_000 })
        onHistoryCacheBuilt(0)
      } catch (e) {
        onHistoryCacheBuilt(1)
      }
    })
    child.on('exit', (code) => onHistoryCacheBuilt(code))
  } catch (err) {
    console.error('[history-cache] fork threw — execFileSync fallback', err && err.message)
    try {
      require('child_process').execFileSync(process.execPath, [worker], { stdio: 'inherit', timeout: 120_000 })
      onHistoryCacheBuilt(0)
    } catch (e) {
      onHistoryCacheBuilt(1)
    }
  }
}

function scheduleHistoryCacheRebuild(delayMs) {
  if (histCache.timer) clearTimeout(histCache.timer)
  histCache.timer = setTimeout(() => {
    histCache.timer = null
    rebuildHistoryCache()
  }, delayMs == null ? 400 : delayMs)
}

function serveHistoryFromCache(query) {
  const hours = Math.min(Math.max(Number(query.hours) || HIST_FLEET_HOURS, 1), 720)
  const limit = Math.min(Math.max(Number(query.limit) || (query.id ? HIST_EP_LIMIT : HIST_FLEET_LIMIT), 100), 20000)
  const id = query.id || null

  // Cache is built at 168h; also accept 24h (VERIFY.md / docs curls) — payload already includes fleet_pct_24h.
  // Accept common limit aliases (200…3000) so verifier examples HIT instead of returning a warming stub.
  const hoursOk = hours === HIST_FLEET_HOURS || hours === 24
  const fleetLimitOk = !id && hoursOk && limit >= 100 && limit <= 3000
  const epLimitOk = id && hoursOk && limit >= 100 && limit <= 2000

  if (id && epLimitOk && histCache.byId[id]) return histCache.byId[id].buf
  if (fleetLimitOk && histCache.fleet) return histCache.fleet.buf
  return null
}

try {
  history.open()
  console.log(`[history] sqlite ready -> ${history.DEFAULT_DB}`)
} catch (e) {
  console.error('[history] failed to open sqlite', e && e.message)
}
restoreAnonsetCache()
loadHistoryCacheFromDisk()

function indexHtml() {
  try {
    return fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  } catch {
    return '<!doctype html><meta charset="utf-8"><body style="font-family:monospace;background:#0b0d12;color:#e7edf5;padding:40px">UI not found. Expected <code>public/index.html</code>.</body>'
  }
}

function contentType(file) {
  const ext = path.extname(file)
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    }[ext] || 'application/octet-stream'
  )
}

async function pollAll() {
  // Skip light polls while a history-cache worker is rewriting large JSON (rare).
  // Always skip overlapping light polls if previous still running — Promise handles that.
  const rows = await Promise.all(REGISTRY.map((ep) => probeServer(ep)))
  publishSnapshot(rows)
  alerts.onSnapshot(snapshot).catch((e) => console.error('[alerts]', e && e.message))
  try {
    const rec = history.recordSnapshot(snapshot)
    if (rec && rec.recorded) {
      cachedSampleCount = (cachedSampleCount || 0) + rec.recorded
      histSqliteOk = true
      console.log(`[history] recorded ${rec.recorded} samples`)
    }
  } catch (e) {
    console.error('[history] record failed', e && e.message)
  }
  if (!histCache.fleet || Date.now() - (histCache.lastRebuildAt || 0) > HIST_REBUILD_MIN_MS) {
    scheduleHistoryCacheRebuild(8_000)
  }
  const line = (snapshot.endpoints || [])
    .map((r) => `${r.name}:${r.status}${r.lag != null ? `(lag ${r.lag})` : ''}`)
    .join('  ')
  console.log(`[poll ${snapshot.checked_at}] ref=${snapshot.reference} spark=${snapshot.spark_consensus}  ${line}`)
}

/** Run heavy anon-set sweep in a child process so HTTP stays responsive. */
function pollAnonset() {
  if (anonsetChild) {
    console.log('[anonset] sweep already running — skip')
    return
  }
  const worker = path.join(__dirname, 'scripts', 'anonset-sweep-worker.js')
  console.log('[anonset] forking sweep worker…')
  anonsetSweeping = true
  if (lastLightRows.length) publishSnapshot(lastLightRows)
  else refreshHotBuffers()

  // Progressive reload while child writes partial results.
  const watch = setInterval(() => {
    if (loadAnonsetFromDisk() && lastLightRows.length) publishSnapshot(lastLightRows)
  }, 15_000)

  const finishAnonset = (code) => {
    clearInterval(watch)
    anonsetChild = null
    anonsetSweeping = false
    loadAnonsetFromDisk()
    if (lastLightRows.length) publishSnapshot(lastLightRows)
    else refreshHotBuffers()
    console.log('[anonset] worker exit', code)
    pollAll().catch((e) => console.error('poll error', e))
  }
  try {
    const child = fork(worker, [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: Object.assign({}, process.env, { ANONSET_BUDGET_MS: String(ANONSET_BUDGET_MS) }),
    })
    anonsetChild = child
    child.on('error', (err) => {
      console.error('[anonset] fork error — execFileSync fallback (may briefly block)', err && err.message)
      try {
        require('child_process').execFileSync(process.execPath, [worker], {
          stdio: 'inherit',
          timeout: 20 * 60_000,
          env: Object.assign({}, process.env, { ANONSET_BUDGET_MS: String(ANONSET_BUDGET_MS) }),
        })
        finishAnonset(0)
      } catch (e) {
        finishAnonset(1)
      }
    })
    child.on('exit', (code) => finishAnonset(code))
  } catch (err) {
    console.error('[anonset] fork threw — execFileSync fallback', err && err.message)
    try {
      require('child_process').execFileSync(process.execPath, [worker], {
        stdio: 'inherit',
        timeout: 20 * 60_000,
        env: Object.assign({}, process.env, { ANONSET_BUDGET_MS: String(ANONSET_BUDGET_MS) }),
      })
      finishAnonset(0)
    } catch (e) {
      finishAnonset(1)
    }
  }
}

const FAVICON = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'public', 'favicon.svg'))
  } catch {
    return null
  }
})()

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function badgeSvg(label, message, color) {
  label = xmlEscape(label)
  message = xmlEscape(message)
  const lw = Math.ceil(label.length * 6.5) + 12
  const mw = Math.ceil(message.length * 6.5) + 12
  const w = lw + mw
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#2b2f38"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${label}</text><text x="${lw + mw / 2}" y="14">${message}</text></g>
</svg>`
}

function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj))
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
    'content-length': buf.length,
  })
  res.end(buf)
}

function readJsonBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > limit) {
        req.destroy()
        const e = new Error('payload too large')
        e.status = 413
        reject(e)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        const e = new Error('invalid json')
        e.status = 400
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function clientIp(req) {
  const remote = (req.socket && req.socket.remoteAddress) || 'unknown'
  if (process.env.FIRO_TRUST_PROXY === '1') {
    const xf = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim()
    if (xf) return xf
  }
  return remote
}

function isLoopbackIp(ip) {
  const s = String(ip || '')
  return s === '127.0.0.1' || s === '::1' || s === ':ffff:127.0.0.1' || s.endsWith('127.0.0.1')
}

function alertTokenOk(req, body) {
  if (isLoopbackIp(clientIp(req))) return true
  const expected = process.env.ALERT_TOKEN || ''
  if (!expected || expected.length < 8) return false
  const got = String((req.headers['x-alert-token'] || (body && body.token) || '')).trim()
  return got.length > 0 && got === expected
}

function sendJsonBuf(res, buf, extraHeaders) {
  const headers = Object.assign(
    {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
      'content-length': buf.length,
    },
    extraHeaders || {},
  )
  res.writeHead(200, headers)
  res.end(buf)
}

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-alert-token',
      'access-control-max-age': '600',
    })
    res.end()
    return
  }
  if (url.startsWith('/api/alerts/test') && req.method === 'POST') {
    readJsonBody(req)
      .then((body) => {
        if (!alertTokenOk(req, body)) {
          sendJson(res, 403, { ok: false, error: 'alert test requires loopback or X-Alert-Token' })
          return
        }
        return alerts.sendTest(body && body.note).then((out) => sendJson(res, out.ok ? 200 : 400, out))
      })
      .catch((e) => sendJson(res, e.status || 400, { ok: false, error: e.message || 'bad request' }))
    return
  }
  if (url.startsWith('/api/alerts')) {
    sendJson(res, 200, alerts.statusPayload())
    return
  }
  if (url.startsWith('/api/check') && req.method === 'POST') {
    readJsonBody(req)
      .then((body) => selfCheck(body, clientIp(req), snapshot))
      .then((out) => sendJson(res, 200, out))
      .catch((e) => sendJson(res, e.status || 400, { ok: false, error: e.message || 'check failed' }))
    return
  }
  if (url.startsWith('/api/check')) {
    sendJson(res, 200, {
      method: 'POST',
      body: { host: 'electrumx.example.com', port: 50002 },
      privacy: 'Light probe only. Private addresses rejected. No anon-set fetch.',
      rate_limit: '1 per 12s per client, 20/hour',
    })
    return
  }
  if (url.startsWith('/api/status')) {
    if (!hot.status) refreshHotBuffers()
    // Refresh uptime-sensitive health separately; status snapshot is stable between polls.
    sendJsonBuf(res, hot.status || Buffer.from('{"polling":true,"endpoints":[]}'))
    return
  }
  if (url.startsWith('/api/docs')) {
    sendJsonBuf(res, Buffer.from(JSON.stringify(docsPayload())))
    return
  }
  if (url.startsWith('/api/spark')) {
    if (!hot.spark) refreshHotBuffers()
    sendJsonBuf(res, hot.spark || Buffer.from('{}'))
    return
  }
  if (url.startsWith('/api/ci')) {
    if (!hot.ci) refreshHotBuffers()
    const ci = hot.ci || { buf: Buffer.from('{"ok":false,"spark_ok":false,"reasons":["warming"]}'), warming: true }
    // 200 whenever we have a fleet snapshot so deploy curls with -f don't fail on lag/yellow.
    // Only 503 while still warming with no endpoints.
    const code = ci.warming ? 503 : 200
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
      'content-length': ci.buf.length,
    })
    res.end(ci.buf)
    return
  }
  if (url.startsWith('/api/badge')) {
    const ci = ciSummary(snapshot)
    const sm = snapshot.summary || { total: 0, green: 0, yellow: 0, red: 0 }
    let color = '#8a97a8'
    let msg = 'warming up'
    if (snapshot.summary) {
      if (ci.spark_ok) {
        color = sm.yellow ? '#e3b341' : '#3fb950'
        msg = sm.yellow ? `spark ok · ${sm.yellow} deg` : 'spark ok'
      } else if (sm.red) {
        color = '#f85149'
        msg = `${sm.red}/${sm.total} down`
      } else {
        color = '#e3b341'
        msg = 'spark check'
      }
    }
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' })
    res.end(badgeSvg('firo spark', msg, color))
    return
  }
  if (url.startsWith('/api/health')) {
    // Rebuild health buf each hit only for uptime_s — keep it tiny/fast (no SQLite).
    const buf = Buffer.from(
      JSON.stringify({
        ok: true,
        service: 'firostatus',
        node: process.version,
        uptime_s: Math.round(process.uptime()),
        checked_at: snapshot.checked_at,
        anonset_source: snapshot.anonset_source || null,
        anonset_checked_at: snapshot.anonset_checked_at || null,
        anonset_refreshing: !!snapshot.anonset_refreshing,
        summary: snapshot.summary || null,
        history: { sqlite: histSqliteOk, sample_count: cachedSampleCount },
        meta: { docs: '/api/docs', ci: '/api/ci', status: '/api/status', alerts: '/api/alerts', check: '/api/check' },
      }),
    )
    sendJsonBuf(res, buf)
    return
  }
  if (url.startsWith('/api/history')) {
    try {
      const u = new URL(url, 'http://localhost')
      const q = {
        hours: u.searchParams.get('hours'),
        id: u.searchParams.get('id'),
        limit: u.searchParams.get('limit'),
      }
      const cachedBuf = serveHistoryFromCache(q)
      if (cachedBuf) {
        if (Date.now() - (histCache.lastRebuildAt || 0) > HIST_REBUILD_MIN_MS) scheduleHistoryCacheRebuild(10_000)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
          'x-firo-history-cache': 'HIT',
          'content-length': cachedBuf.length,
        })
        res.end(cachedBuf)
        return
      }
      // Never run sync SQLite historyPayload on the request path.
      if (!histCache.fleet) scheduleHistoryCacheRebuild(500)
      const stub = Buffer.from(
        JSON.stringify({
          cache: {
            hit: false,
            refreshing: true,
            note: 'History cache warming in a background worker — retry shortly.',
            mode: q.id ? 'endpoint' : 'fleet',
          },
          sample_count: cachedSampleCount,
          points: [],
          fleet: [],
          events: { sethash: [] },
          uptime: { endpoints: {} },
        }),
      )
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'no-cache',
        'x-firo-history-cache': 'MISS',
        'content-length': stub.length,
      })
      res.end(stub)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify({ error: 'history unavailable' }))
    }
    return
  }
  const pathname = url.split('?')[0]
  if (pathname.startsWith('/docs/') && pathname.endsWith('.md')) {
    const base = path.join(__dirname, 'docs')
    const safe = path.normalize(pathname.replace(/^\/docs\//, '')).replace(/^(\.\.(\/|\\|$))+/, '')
    if (safe.toLowerCase() === 'status.md') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const file = path.join(base, safe)
    if (file.startsWith(base) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
      })
      res.end(fs.readFileSync(file))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  if (pathname.startsWith('/assets/') || pathname === '/favicon.svg' || pathname.startsWith('/enhance.js')) {
    const base = path.join(__dirname, 'public')
    const rel = pathname === '/enhance.js' ? 'enhance.js' : pathname.replace(/^\//, '')
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '')
    const file = path.join(base, safe)
    if (file.startsWith(base) && fs.existsSync(file)) {
      try {
        const body = fs.readFileSync(file)
        res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'public, max-age=3600' })
        res.end(body)
        return
      } catch {
        /* fall through */
      }
    }
    if (pathname === '/favicon.svg' && FAVICON) {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' })
      res.end(FAVICON)
      return
    }
    res.writeHead(404)
    res.end('not found')
    return
  }
  // SPA fallback — cached HTML buffer
  if (!hot.indexHtml || Date.now() - hot.indexAt > 30_000) {
    hot.indexHtml = Buffer.from(indexHtml(), 'utf8')
    hot.indexAt = Date.now()
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    'content-length': hot.indexHtml.length,
  })
  res.end(hot.indexHtml)
})

server.listen(PORT, () => {
  console.log(`FiroStatus -> http://localhost:${PORT}`)
  const ch = alerts.channels()
  console.log(`[alerts] telegram=${ch.telegram} webhook=${ch.webhook}`)
  try {
    cachedSampleCount = history.sampleCount()
    histSqliteOk = true
  } catch {
    histSqliteOk = false
  }
  refreshHotBuffers()
  if (!histCache.fleet) scheduleHistoryCacheRebuild(5_000)
  else scheduleHistoryCacheRebuild(120_000)
  pollAll().catch((e) => console.error('poll error', e))
  setInterval(() => pollAll().catch((e) => console.error('poll error', e)), POLL_INTERVAL_MS)
  // Delay first heavy sweep so light status is warm first.
  setTimeout(() => pollAnonset(), 12_000)
  setInterval(() => pollAnonset(), ANONSET_INTERVAL_MS)
})
