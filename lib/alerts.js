// Fleet alerting. Channels are env-configured (Telegram / webhook).
// Events are always recorded on-host. Never logs webhook URLs or bot tokens.

const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')

const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 30 * 60_000)
const LAG_SPIKE = Number(process.env.ALERT_LAG_SPIKE || 10)
const STATE_FILE = path.join(__dirname, '..', 'data', 'alerts-state.json')
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://firostatus.com'

let lastSent = {}
let recent = []
let lastSnapshot = null
let primed = false

function channels() {
  const webhook = process.env.ALERT_WEBHOOK_URL || ''
  return {
    log: true,
    telegram: !!(process.env.ALERT_TELEGRAM_BOT_TOKEN && process.env.ALERT_TELEGRAM_CHAT_ID),
    webhook: /^https?:\/\//.test(webhook),
  }
}

function anyChannel() {
  const c = channels()
  return c.telegram || c.webhook
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (j.lastSent && typeof j.lastSent === 'object') lastSent = j.lastSent
    if (Array.isArray(j.recent)) recent = j.recent.slice(-30)
  } catch {
    /* ignore corrupt state */
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ lastSent, recent: recent.slice(-30), saved_at: new Date().toISOString() }),
    )
  } catch (e) {
    console.error('[alerts] state save failed', e && e.message)
  }
}

function postJson(urlStr, body) {
  return new Promise((resolve) => {
    let u
    try {
      u = new URL(urlStr)
    } catch {
      resolve({ ok: false, error: 'bad url' })
      return
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      resolve({ ok: false, error: 'bad url' })
      return
    }
    const data = Buffer.from(JSON.stringify(body))
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
          'user-agent': 'firostatus-alerts/1',
        },
        timeout: 12_000,
      },
      (res) => {
        res.resume()
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode })
      },
    )
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'timeout' })
    })
    req.end(data)
  })
}

function formatText(ev) {
  const host = ev.host ? `${ev.name} (${ev.host}:${ev.port})` : ev.name || ev.id || 'fleet'
  const link = ev.id ? `${PUBLIC_ORIGIN}/backend/${ev.id}` : PUBLIC_ORIGIN
  return [`FiroStatus · ${String(ev.type).replace(/_/g, ' ')}`, host, ev.detail, ev.checked_at ? `at ${ev.checked_at}` : '', link]
    .filter(Boolean)
    .join('\n')
}

function sanitizeResults(results) {
  const out = {}
  for (const k of Object.keys(results || {})) {
    out[k] = {
      ok: !!(results[k] && results[k].ok),
      status: (results[k] && results[k].status) || null,
      error: (results[k] && results[k].error) || null,
    }
  }
  return out
}

async function dispatch(ev) {
  const ch = channels()
  const results = {}
  const text = formatText(ev)
  if (ch.telegram) {
    const token = process.env.ALERT_TELEGRAM_BOT_TOKEN
    results.telegram = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: process.env.ALERT_TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    })
  }
  if (ch.webhook) {
    results.webhook = await postJson(process.env.ALERT_WEBHOOK_URL, {
      source: 'firostatus',
      event: ev,
    })
  }
  return results
}

function remember(ev, results) {
  recent.push({
    at: new Date().toISOString(),
    type: ev.type,
    severity: ev.severity || null,
    id: ev.id || null,
    name: ev.name || null,
    detail: ev.detail,
    delivered: results,
  })
  if (recent.length > 40) recent = recent.slice(-30)
  saveState()
}

function cooled(key) {
  const t = lastSent[key]
  return t && Date.now() - t < COOLDOWN_MS
}

function mark(key) {
  lastSent[key] = Date.now()
}

function epMap(snap) {
  const m = new Map()
  for (const e of (snap && snap.endpoints) || []) m.set(e.id, e)
  return m
}

function collectEvents(prev, next) {
  const events = []
  if (!next || !next.endpoints) return events
  const prevMap = epMap(prev)
  const hadPrev = prevMap.size > 0
  if (!hadPrev) return events
  for (const e of next.endpoints) {
    const p = prevMap.get(e.id)
    if (!p) continue
    const base = {
      id: e.id,
      name: e.name,
      host: e.host,
      port: e.port,
      checked_at: next.checked_at,
    }
    const reasons = Array.isArray(e.status_reasons) ? e.status_reasons.join('; ') : ''
    if (e.status === 'red' && p.status !== 'red') {
      events.push({
        ...base,
        type: 'host_red',
        severity: 'critical',
        detail: `${e.name} went red` + (e.error ? ` · ${e.error}` : '') + (reasons ? ` · ${reasons}` : ''),
      })
    }
    if (p.status === 'red' && e.status === 'green') {
      events.push({ ...base, type: 'host_recovered', severity: 'info', detail: `${e.name} recovered to green` })
    }
    if (e.spark_consistent === false && p.spark_consistent !== false) {
      events.push({
        ...base,
        type: 'spark_mismatch',
        severity: 'critical',
        detail: `${e.name} Spark coin id disagrees with fleet (id=${e.spark_latest_coin_id})`,
      })
    }
    const pSet = p.anonset && p.anonset.consistent
    const nSet = e.anonset && e.anonset.consistent
    if (nSet === false && pSet !== false) {
      events.push({
        ...base,
        type: 'sethash_mismatch',
        severity: 'critical',
        detail: `${e.name} setHash disagrees with fleet`,
      })
    }
    if (e.lag != null && p.lag != null && e.lag - p.lag >= LAG_SPIKE && e.lag > 2) {
      events.push({
        ...base,
        type: 'lag_spike',
        severity: 'warn',
        detail: `${e.name} tip lag ${p.lag} → ${e.lag} (spike ≥${LAG_SPIKE})`,
      })
    }
    if (e.tls_days_left != null && e.tls_days_left < 0 && !(p.tls_days_left != null && p.tls_days_left < 0)) {
      events.push({ ...base, type: 'tls_expired', severity: 'critical', detail: `${e.name} TLS certificate expired` })
    }
  }
  return events
}

async function onSnapshot(next) {
  const prev = lastSnapshot
  lastSnapshot = next
  if (!primed) {
    primed = true
    return { skipped: 'prime', events: [] }
  }
  const events = collectEvents(prev, next)
  const sent = []
  for (const ev of events) {
    const key = `${ev.type}:${ev.id}`
    if (cooled(key)) continue
    mark(key)
    const results = anyChannel() ? await dispatch(ev) : {}
    results.log = { ok: true, status: 200 }
    remember(ev, results)
    sent.push({ type: ev.type, id: ev.id })
    console.log(`[alerts] ${ev.type} ${ev.id}`)
  }
  if (sent.length) saveState()
  return { sent }
}

async function sendTest(note) {
  const ev = {
    type: 'test',
    severity: 'info',
    name: 'FiroStatus',
    detail: note || 'Manual test ping from /api/alerts/test',
    checked_at: new Date().toISOString(),
  }
  if (!anyChannel()) {
    remember(ev, { log: { ok: true, status: 200 } })
    return {
      ok: true,
      local: true,
      dispatched: false,
      results: { log: { ok: true } },
      hint: 'Recorded on this host.',
    }
  }
  const results = await dispatch(ev)
  results.log = { ok: true, status: 200 }
  remember(ev, results)
  return { ok: true, local: true, dispatched: true, results: sanitizeResults(results) }
}

function statusPayload() {
  const ch = channels()
  return {
    configured: ch,
    any: anyChannel(),
    cooldown_min: Math.round(COOLDOWN_MS / 60000),
    lag_spike_blocks: LAG_SPIKE,
    token_configured: !!(process.env.ALERT_TOKEN && process.env.ALERT_TOKEN.length >= 8),
    recent: recent.slice(-20).map((e) => ({
      at: e.at,
      type: e.type,
      severity: e.severity || null,
      id: e.id,
      name: e.name,
      detail: e.detail,
      delivered: sanitizeResults(e.delivered),
    })),
    triggers: ['host_red', 'host_recovered', 'spark_mismatch', 'sethash_mismatch', 'lag_spike', 'tls_expired'],
    docs: '/alerts',
  }
}

loadState()

module.exports = { onSnapshot, sendTest, statusPayload, anyChannel, channels }
