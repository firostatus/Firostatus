// Durable probe history via Node's built-in node:sqlite (Node ≥22.5).
// Used by the always-on server for /api/history and 24h/7d uptime %.

const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const DEFAULT_DB = path.join(__dirname, '..', 'data', 'history.sqlite')

let db = null
let dbPath = null

function open(filePath = process.env.HISTORY_DB || DEFAULT_DB) {
  if (db && dbPath === filePath) return db
  if (db) {
    try {
      db.close()
    } catch {}
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  db = new DatabaseSync(filePath)
  dbPath = filePath
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      status TEXT,
      height INTEGER,
      lag INTEGER,
      latency_ms INTEGER,
      spark_id INTEGER,
      spark_consistent INTEGER,
      anonset_ms INTEGER,
      anonset_mb REAL,
      anonset_coins INTEGER,
      setHash TEXT,
      cert_expires_at TEXT,
      tls_days_left INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);
    CREATE INDEX IF NOT EXISTS idx_samples_ep_ts ON samples(endpoint_id, ts);
    CREATE TABLE IF NOT EXISTS fleet_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      reference INTEGER,
      green INTEGER,
      yellow INTEGER,
      red INTEGER,
      total INTEGER,
      spark_consensus INTEGER,
      spark_sethash_consensus TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fleet_ts ON fleet_summary(ts);
  `)
  return db
}

function recordSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.endpoints) || !snapshot.endpoints.length) return { recorded: 0 }
  const database = open()
  const ts = snapshot.checked_at || new Date().toISOString()
  const insert = database.prepare(`
    INSERT INTO samples (
      ts, endpoint_id, status, height, lag, latency_ms, spark_id, spark_consistent,
      anonset_ms, anonset_mb, anonset_coins, setHash, cert_expires_at, tls_days_left
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const fleetIns = database.prepare(`
    INSERT INTO fleet_summary (
      ts, reference, green, yellow, red, total, spark_consensus, spark_sethash_consensus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // node:sqlite DatabaseSync has no .transaction(); use explicit BEGIN/COMMIT.
  let recorded = 0
  database.exec('BEGIN')
  try {
    for (const e of snapshot.endpoints) {
      const a = e.anonset || null
      insert.run(
        ts,
        e.id,
        e.status || null,
        e.height != null ? e.height : null,
        e.lag != null ? e.lag : null,
        e.latency_ms != null ? e.latency_ms : null,
        e.spark_latest_coin_id != null ? e.spark_latest_coin_id : null,
        e.spark_consistent == null ? null : e.spark_consistent ? 1 : 0,
        a && a.ms != null ? a.ms : null,
        a && a.mb != null ? a.mb : null,
        a && a.coins != null ? a.coins : null,
        a && a.setHash ? a.setHash : null,
        e.tls_valid_to || null,
        e.tls_days_left != null ? e.tls_days_left : null,
      )
      recorded++
    }
    const sm = snapshot.summary || { green: 0, yellow: 0, red: 0, total: snapshot.endpoints.length }
    fleetIns.run(
      ts,
      snapshot.reference != null ? snapshot.reference : null,
      sm.green || 0,
      sm.yellow || 0,
      sm.red || 0,
      sm.total || snapshot.endpoints.length,
      snapshot.spark_consensus != null ? snapshot.spark_consensus : null,
      snapshot.spark_sethash_consensus || null,
    )
    database.exec('COMMIT')
  } catch (err) {
    try {
      database.exec('ROLLBACK')
    } catch {}
    throw err
  }
  return { recorded, ts }
}

function sinceIso(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

/** Uptime = share of samples that are green (strict). Documented in METHODOLOGY. */
function uptimeForEndpoint(endpointId, hours) {
  const database = open()
  const since = sinceIso(hours)
  const row = database
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'green' THEN 1 ELSE 0 END) AS green
       FROM samples
       WHERE endpoint_id = ? AND ts >= ?`,
    )
    .get(endpointId, since)
  const total = row && row.total ? Number(row.total) : 0
  const green = row && row.green ? Number(row.green) : 0
  if (!total) return { samples: 0, green: 0, pct: null }
  return { samples: total, green, pct: +(100 * green / total).toFixed(2) }
}

function fleetUptime(hours) {
  const database = open()
  const since = sinceIso(hours)
  const row = database
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'green' THEN 1 ELSE 0 END) AS green
       FROM samples
       WHERE ts >= ?`,
    )
    .get(since)
  const total = row && row.total ? Number(row.total) : 0
  const green = row && row.green ? Number(row.green) : 0
  if (!total) return { samples: 0, green: 0, pct: null }
  return { samples: total, green, pct: +(100 * green / total).toFixed(2) }
}

function series(endpointId, hours, limit = 2000) {
  const database = open()
  const since = sinceIso(hours)
  let rows
  if (endpointId) {
    rows = database
      .prepare(
        `SELECT ts AS t, endpoint_id AS id, status, height, lag, latency_ms,
                spark_id, spark_consistent, anonset_ms, anonset_mb, anonset_coins, setHash,
                cert_expires_at, tls_days_left
         FROM samples
         WHERE endpoint_id = ? AND ts >= ?
         ORDER BY ts ASC
         LIMIT ?`,
      )
      .all(endpointId, since, limit)
  } else {
    rows = database
      .prepare(
        `SELECT ts AS t, endpoint_id AS id, status, height, lag, latency_ms,
                spark_id, spark_consistent, anonset_ms, anonset_mb, anonset_coins, setHash,
                cert_expires_at, tls_days_left
         FROM samples
         WHERE ts >= ?
         ORDER BY ts ASC
         LIMIT ?`,
      )
      .all(since, limit)
  }
  return rows.map((r) => ({
    t: r.t,
    id: r.id,
    status: r.status,
    height: r.height,
    lag: r.lag,
    latency_ms: r.latency_ms,
    spark_id: r.spark_id,
    spark_consistent: r.spark_consistent == null ? null : !!r.spark_consistent,
    anonset_ms: r.anonset_ms,
    anonset_mb: r.anonset_mb,
    anonset_coins: r.anonset_coins,
    setHash: r.setHash,
    cert_expires_at: r.cert_expires_at,
    tls_days_left: r.tls_days_left,
  }))
}

function listEndpointIds() {
  const database = open()
  return database.prepare(`SELECT DISTINCT endpoint_id FROM samples ORDER BY endpoint_id`).all().map((r) => r.endpoint_id)
}

function sampleCount() {
  const database = open()
  const row = database.prepare(`SELECT COUNT(*) AS n FROM samples`).get()
  return row ? Number(row.n) : 0
}

function recordingSince() {
  const database = open()
  const row = database.prepare(`SELECT MIN(ts) AS t FROM samples`).get()
  return row && row.t ? row.t : null
}

/** Fleet green/yellow/red counts over time (one row per poll). */
function fleetSeries(hours, limit = 2000) {
  const database = open()
  const since = sinceIso(hours)
  const rows = database
    .prepare(
      `SELECT ts AS t, reference, green, yellow, red, total, spark_consensus, spark_sethash_consensus
       FROM fleet_summary
       WHERE ts >= ?
       ORDER BY ts ASC
       LIMIT ?`,
    )
    .all(since, limit)
  return rows.map((r) => ({
    t: r.t,
    reference: r.reference,
    green: r.green,
    yellow: r.yellow,
    red: r.red,
    total: r.total,
    spark_consensus: r.spark_consensus,
    spark_sethash_consensus: r.spark_sethash_consensus,
  }))
}

/**
 * Collapse consecutive setHash-mismatch samples into windows.
 * Privacy-safe: only endpoint ids + truncated hashes.
 */
function sethashEvents(hours, limit = 8000) {
  const pts = series(null, hours, limit)
  const byT = new Map()
  for (const p of pts) {
    if (!byT.has(p.t)) byT.set(p.t, [])
    byT.get(p.t).push(p)
  }
  const windows = []
  let open = null
  const times = [...byT.keys()].sort()
  for (const t of times) {
    const group = byT.get(t)
    const hashes = group.map((g) => g.setHash).filter(Boolean)
    if (!hashes.length) {
      if (open) {
        windows.push(open)
        open = null
      }
      continue
    }
    // modal hash at this timestamp
    const counts = {}
    for (const h of hashes) counts[h] = (counts[h] || 0) + 1
    const consensus = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
    const bad = group.filter((g) => g.setHash && g.setHash !== consensus)
    if (!bad.length) {
      if (open) {
        windows.push(open)
        open = null
      }
      continue
    }
    const ids = [...new Set(bad.map((b) => b.id))]
    const short = String(consensus).slice(0, 16)
    if (open && open.consensus_short === short && open.ids.join() === ids.join()) {
      open.end = t
      open.sample_count += bad.length
    } else {
      if (open) windows.push(open)
      open = {
        start: t,
        end: t,
        ids,
        consensus_short: short,
        sample_count: bad.length,
      }
    }
  }
  if (open) windows.push(open)
  return windows.slice(-40)
}

function historyPayload(opts = {}) {
  const hours = Math.min(Math.max(Number(opts.hours) || 168, 1), 720) // default 7d, max 30d
  const endpointId = opts.id || null
  const limit = Math.min(Math.max(Number(opts.limit) || 3000, 100), 20000)
  const skipEvents = !!opts.skipEvents
  const since = recordingSince()

  // Per-backend detail charts only need that host's series. Skip fleet-wide
  // setHash scans / fleet series — those made ?id=… take tens of seconds on shared hosts.
  if (endpointId) {
    const u24 = uptimeForEndpoint(endpointId, 24)
    const u7 = uptimeForEndpoint(endpointId, 168)
    return {
      checked_at: new Date().toISOString(),
      storage: 'sqlite',
      db: 'data/history.sqlite',
      sample_count: sampleCount(),
      recording_since: since,
      uptime_definition:
        'percent of samples with status=green (strict; yellow/red count as down). Not a wallet-availability SLA. Early warmup + monitor-region RTT can lower %. Prefer /api/ci spark_ok for Spark health.',
      uptime_note: since
        ? `Recording since ${since}. 24h/7d % only stabilize after enough green samples accumulate.`
        : 'No samples yet.',
      uptime: {
        endpoints: {
          [endpointId]: {
            pct_24h: u24.pct,
            pct_7d: u7.pct,
            samples_24h: u24.samples,
            samples_7d: u7.samples,
          },
        },
      },
      fleet: [],
      events: { sethash: [] },
      query: { hours, id: endpointId, limit, mode: 'endpoint' },
      points: series(endpointId, hours, limit),
    }
  }

  const ids = listEndpointIds()
  const endpoints = {}
  for (const id of ids) {
    const u24 = uptimeForEndpoint(id, 24)
    const u7 = uptimeForEndpoint(id, 168)
    endpoints[id] = {
      pct_24h: u24.pct,
      pct_7d: u7.pct,
      samples_24h: u24.samples,
      samples_7d: u7.samples,
    }
  }
  const f24 = fleetUptime(24)
  const f7 = fleetUptime(168)
  return {
    checked_at: new Date().toISOString(),
    storage: 'sqlite',
    // Never expose absolute filesystem paths publicly.
    db: 'data/history.sqlite',
    sample_count: sampleCount(),
    recording_since: since,
    uptime_definition:
      'percent of samples with status=green (strict; yellow/red count as down). Not a wallet-availability SLA. Early warmup + monitor-region RTT can lower %. Prefer /api/ci spark_ok for Spark health.',
    uptime_note: since
      ? `Recording since ${since}. 24h/7d % only stabilize after enough green samples accumulate.`
      : 'No samples yet.',
    windows: {
      h24: { hours: 24, fleet_samples: f24.samples, fleet_green: f24.green },
      d7: { hours: 168, fleet_samples: f7.samples, fleet_green: f7.green },
    },
    uptime: {
      fleet_pct_24h: f24.pct,
      fleet_pct_7d: f7.pct,
      endpoints,
    },
    fleet: fleetSeries(hours, Math.min(limit, 4000)),
    // Cap / optionally skip setHash scan — sync work blocks the Node event loop on shared hosts.
    events: { sethash: skipEvents ? [] : sethashEvents(hours, Math.min(limit, 1200)) },
    query: { hours, id: endpointId, limit, skipEvents },
    points: series(endpointId, hours, limit),
  }
}

/**
 * Latest non-null anon-set sample per endpoint (for warm restart / last-good UI).
 * Returns { endpoints: { [id]: anonEntry }, checked_at }.
 */
function latestAnonsetMap() {
  const database = open()
  const ids = listEndpointIds()
  const stmt = database.prepare(`
    SELECT ts, anonset_ms, anonset_mb, anonset_coins, setHash, spark_id
    FROM samples
    WHERE endpoint_id = ? AND anonset_ms IS NOT NULL
    ORDER BY ts DESC
    LIMIT 1
  `)
  const endpoints = {}
  let checkedAt = null
  for (const id of ids) {
    const r = stmt.get(id)
    if (!r) continue
    endpoints[id] = {
      id,
      ok: true,
      ms: r.anonset_ms,
      coins: r.anonset_coins,
      bytes: r.anonset_mb != null ? Math.round(Number(r.anonset_mb) * 1048576) : null,
      mb: r.anonset_mb != null ? Number(r.anonset_mb) : null,
      setHash: r.setHash || null,
      group: r.spark_id != null ? Number(r.spark_id) : null,
      error: null,
      at: r.ts,
      source: 'sqlite',
    }
    if (!checkedAt || r.ts > checkedAt) checkedAt = r.ts
  }
  return { endpoints, checked_at: checkedAt }
}

function close() {
  if (db) {
    try {
      db.close()
    } catch {}
    db = null
    dbPath = null
  }
}

module.exports = {
  open,
  recordSnapshot,
  uptimeForEndpoint,
  fleetUptime,
  series,
  fleetSeries,
  sethashEvents,
  historyPayload,
  latestAnonsetMap,
  sampleCount,
  close,
  DEFAULT_DB,
}
