// Shared probing + snapshot logic used by both the always-on server (server.js)
// Node built-ins only.

const tls = require('tls')

// Curated public Firo Electrum backends (default wallet server list).
// used_by = wallets known to ship / list this host (not exclusive; users may override).
const REGISTRY = [
  {
    id: 'firo-core-0',
    name: 'Firo Core electrumx',
    host: 'electrumx.firo.org',
    port: 50002,
    operator: 'Firo Core',
    used_by: ['Campfire', 'Stack Wallet', 'Electrum-Firo'],
  },
  {
    id: 'firo-core-1',
    name: 'Firo Core electrumx01',
    host: 'electrumx01.firo.org',
    port: 50002,
    operator: 'Firo Core',
    used_by: ['Campfire', 'Stack Wallet', 'Electrum-Firo'],
  },
  {
    id: 'firo-core-2',
    name: 'Firo Core electrumx02',
    host: 'electrumx02.firo.org',
    port: 50002,
    operator: 'Firo Core',
    used_by: ['Campfire', 'Stack Wallet', 'Electrum-Firo'],
  },
  {
    id: 'firo-core-3',
    name: 'Firo Core electrumx03',
    host: 'electrumx03.firo.org',
    port: 50002,
    operator: 'Firo Core',
    used_by: ['Campfire', 'Stack Wallet', 'Electrum-Firo'],
  },
  {
    id: 'stackwallet',
    name: 'Stack Wallet',
    host: 'firo.stackwallet.com',
    port: 50002,
    operator: 'Cypher Stack',
    used_by: ['Stack Wallet', 'Campfire', 'Electrum-Firo'],
  },
  {
    id: 'mathnodes',
    name: 'MathNodes',
    host: 'firo.mathnodes.com',
    port: 50002,
    operator: 'MathNodes',
    used_by: ['Electrum-Firo', 'Campfire', 'Stack Wallet'],
  },
]

// Cheap, fast, privacy-safe probe: reachability, height, latency, Spark coin id.
// Latency is stamped when tip height arrives so a slow spark.getsparklatestcoinid
// does not inflate probe RTT into an 8s yellow.
function probeServer(ep, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const r = {
      id: ep.id,
      name: ep.name,
      operator: ep.operator,
      host: ep.host,
      port: ep.port,
      used_by: Array.isArray(ep.used_by) ? ep.used_by.slice() : [],
      ok: false,
      height: null,
      latency_ms: null,
      version: null,
      spark_latest_coin_id: null,
      tls_valid_to: null,
      tls_days_left: null,
      error: null,
    }
    let settled = false
    let sparkTimer = null
    const finish = () => {
      if (settled) return
      settled = true
      if (sparkTimer) clearTimeout(sparkTimer)
      if (r.latency_ms == null) r.latency_ms = Date.now() - started
      r.ok = r.height != null
      try {
        socket.destroy()
      } catch {}
      // Copy so late socket data cannot mutate a resolved / cached row.
      resolve({ ...r })
    }

    const connectHost = ep.connectIp || ep.host
    const socket = tls.connect(
      { host: connectHost, port: ep.port, servername: ep.host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        try {
          const cert = socket.getPeerCertificate()
          if (cert && cert.valid_to) {
            const exp = new Date(cert.valid_to)
            if (!Number.isNaN(exp.getTime())) {
              r.tls_valid_to = exp.toISOString()
              r.tls_days_left = Math.floor((exp.getTime() - Date.now()) / 86_400_000)
            }
          }
        } catch {}
        socket.write(JSON.stringify({ id: 1, method: 'server.version', params: ['firo-spark-monitor', '1.4'] }) + '\n')
        socket.write(JSON.stringify({ id: 2, method: 'blockchain.headers.subscribe', params: [] }) + '\n')
        socket.write(JSON.stringify({ id: 3, method: 'spark.getsparklatestcoinid', params: [] }) + '\n')
      },
    )
    const need = new Set([1, 2, 3])
    let buf = ''
    socket.on('data', (d) => {
      if (settled) return
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (!line || settled) continue
        try {
          const m = JSON.parse(line)
          if (m.id === 1) {
            r.version = Array.isArray(m.result) ? m.result[0] : m.result
            need.delete(1)
          }
          if (m.id === 2 && m.result) {
            r.height = m.result.height ?? m.result.block_height ?? null
            if (r.latency_ms == null) r.latency_ms = Date.now() - started
            need.delete(2)
            // Don't wait forever for Spark id once tip is known.
            if (need.has(3) && !sparkTimer) {
              sparkTimer = setTimeout(() => {
                need.delete(3)
                if (need.size === 0) finish()
              }, 2500)
            }
          }
          if (m.id === 3 && m.result !== undefined) {
            r.spark_latest_coin_id = m.result
            need.delete(3)
            if (sparkTimer) {
              clearTimeout(sparkTimer)
              sparkTimer = null
            }
          }
        } catch {}
      }
      if (need.size === 0) finish()
    })
    socket.on('error', (e) => {
      if (!r.error) r.error = e.message
      finish()
    })
    socket.on('timeout', () => {
      if (!r.error && r.height == null) r.error = 'timeout'
      try {
        socket.destroy()
      } catch {}
      finish()
    })
    socket.on('close', () => finish())
  })
}

function mode(values) {
  if (!values.length) return null
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  let best = null
  let bestCount = -1
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

function median(nums) {
  const a = nums.filter((n) => n != null).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2)
}

/** Probe RTT yellow only when this host is a fleet outlier (not when the whole monitor region is slow). */
function rttYellowThreshold(medianLatencyMs) {
  if (medianLatencyMs == null || Number.isNaN(medianLatencyMs)) return 8000
  return Math.max(5000, Math.round(medianLatencyMs * 2.5))
}

function statusReasons(r, sparkConsensus, sethashConsensus, anonEntry, medianLatencyMs) {
  const reasons = []
  if (!r.ok || r.height == null) {
    reasons.push(r.error ? `unreachable (${String(r.error).slice(0, 80)})` : 'unreachable')
    return reasons
  }
  if (r.lag != null && r.lag > 100) reasons.push(`tip lag ${r.lag} (>100)`)
  if (r.tls_days_left != null && r.tls_days_left < 0) reasons.push('TLS certificate expired')
  if (r.lag != null && r.lag > 2 && r.lag <= 100) reasons.push(`tip lag ${r.lag} (>2)`)
  const rttThresh = rttYellowThreshold(medianLatencyMs)
  if (r.latency_ms != null && r.latency_ms > rttThresh) {
    reasons.push(`probe RTT outlier ${r.latency_ms}ms (fleet band ≤${rttThresh}ms)`)
  }
  if (r.spark_latest_coin_id != null && sparkConsensus != null && r.spark_latest_coin_id !== sparkConsensus) {
    reasons.push('Spark coin id ≠ fleet consensus')
  }
  if (sparkConsensus != null && r.spark_latest_coin_id == null) reasons.push('Spark coin id missing')
  if (anonEntry && anonEntry.setHash && sethashConsensus && anonEntry.setHash !== sethashConsensus) {
    reasons.push('setHash ≠ fleet consensus')
  }
  if (
    anonEntry &&
    anonEntry.group != null &&
    r.spark_latest_coin_id != null &&
    anonEntry.group !== r.spark_latest_coin_id
  ) {
    reasons.push('anon-set group ≠ Spark coin id')
  }
  if (r.tls_days_left != null && r.tls_days_left >= 0 && r.tls_days_left < 14) {
    reasons.push(`TLS expires in ${r.tls_days_left}d`)
  }
  return reasons
}

function classify(r, sparkConsensus, sethashConsensus, anonEntry, medianLatencyMs) {
  if (!r.ok || r.height == null) return 'red'
  if (r.lag != null && r.lag > 100) return 'red'
  // Expired TLS cert is a hard fail for light-wallet clients.
  if (r.tls_days_left != null && r.tls_days_left < 0) return 'red'
  const reasons = statusReasons(r, sparkConsensus, sethashConsensus, anonEntry, medianLatencyMs)
  // red reasons already returned above; any remaining reason → yellow
  if (reasons.length) return 'yellow'
  return 'green'
}

// Normalize an anon-set entry to { ok, ms, coins, mb, setHash, group } (accepts bytes or mb).
function normAnon(a) {
  if (!a) return null
  const mb = a.mb != null ? a.mb : a.bytes != null ? +(a.bytes / (1024 * 1024)).toFixed(2) : null
  return {
    ok: !!a.ok,
    ms: a.ms ?? null,
    coins: a.coins ?? null,
    mb,
    setHash: a.setHash ?? null,
    group: a.group ?? null,
    error: a.error ?? null,
    at: a.at ?? null,
    source: a.source ?? null, // live | sqlite | disk — UI can label last-good
  }
}

// Highest height reported by >=2 backends (majority-safe); fallback to max.
function referenceTip(heights) {
  if (!heights.length) return null
  const counts = new Map()
  for (const h of heights) counts.set(h, (counts.get(h) || 0) + 1)
  const agreed = [...counts.entries()].filter(([, c]) => c >= 2).map(([h]) => h)
  return agreed.length ? Math.max(...agreed) : Math.max(...heights)
}

// Build the full snapshot from probe rows + an anon-set map keyed by endpoint id.
function buildSnapshot(rows, anonsetById = {}, anonsetCheckedAt = null) {
  const heights = rows.filter((r) => r.height != null).map((r) => r.height)
  // Majority-safe reference tip: the highest height at least two backends agree on,
  // so a single forked/misreporting node that is ahead can't mark the whole fleet
  // as lagging. Falls back to the plain max when there is no agreement.
  const reference = referenceTip(heights)
  const sparkConsensus = mode(rows.filter((r) => r.spark_latest_coin_id != null).map((r) => r.spark_latest_coin_id))

  const anonNorm = {}
  for (const id of Object.keys(anonsetById)) anonNorm[id] = normAnon(anonsetById[id])
  const sethashConsensus = mode(Object.values(anonNorm).filter((a) => a && a.setHash).map((a) => a.setHash))

  for (const r of rows) {
    r.lag = r.height != null && reference != null ? Math.max(reference - r.height, 0) : null
    r.spark_consistent = r.spark_latest_coin_id != null && sparkConsensus != null ? r.spark_latest_coin_id === sparkConsensus : null
    const a = anonNorm[r.id]
    let anonConsistent = null
    if (a && a.setHash && sethashConsensus) {
      const groupOk =
        a.group == null || r.spark_latest_coin_id == null || a.group === r.spark_latest_coin_id
      anonConsistent = groupOk && a.setHash === sethashConsensus
    }
    r.anonset = a ? { ...a, consistent: anonConsistent } : null
  }

  // Fleet-relative RTT band: shared-host monitor lag must not yellow the whole fleet.
  const latencies = rows.filter((r) => r.ok && r.latency_ms != null).map((r) => r.latency_ms)
  const medianLatency = median(latencies)
  const rttThresh = rttYellowThreshold(medianLatency)

  for (const r of rows) {
    const a = r.anonset
    r.status_reasons = statusReasons(r, sparkConsensus, sethashConsensus, a, medianLatency)
    r.status = classify(r, sparkConsensus, sethashConsensus, a, medianLatency)
  }

  const summary = { total: rows.length, green: 0, yellow: 0, red: 0 }
  for (const r of rows) summary[r.status]++

  const anonReady = Object.values(anonNorm).filter((a) => a && a.ok)
  const stats = {
    avg_latency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    median_latency: medianLatency,
    probe_rtt_yellow_threshold_ms: rttThresh,
    fastest: latencies.length ? Math.min(...latencies) : null,
    slowest: latencies.length ? Math.max(...latencies) : null,
    max_lag: rows.some((r) => r.lag != null) ? Math.max(...rows.filter((r) => r.lag != null).map((r) => r.lag)) : null,
    reachable: rows.filter((r) => r.ok).length,
    spark_group: sparkConsensus,
    anonset_mb: anonReady.length ? +(anonReady.reduce((a, b) => a + (b.mb || 0), 0) / anonReady.length).toFixed(2) : null,
    anonset_coins: anonReady.length ? median(anonReady.map((a) => a.coins)) : null,
    anonset_ms: anonReady.length ? median(anonReady.map((a) => a.ms)) : null,
    // Fleet-relative slow band: >1.75× median (floor 20s). Absolute 15s was false-positive when fleet median is ~30s.
    anonset_slow_threshold_ms: (() => {
      const vals = anonReady.map((a) => a.ms).filter((ms) => ms != null)
      if (vals.length < 2) return 45000
      const med = median(vals)
      return Math.max(20000, Math.round(med * 1.75))
    })(),
    anonset_slow: (() => {
      const vals = anonReady.map((a) => a.ms).filter((ms) => ms != null)
      const thresh =
        vals.length < 2 ? 45000 : Math.max(20000, Math.round(median(vals) * 1.75))
      return Object.values(anonNorm).filter(
        (a) => a && (!a.ok || (a.ms != null && a.ms > thresh)),
      ).length
    })(),
  }

  return {
    checked_at: new Date().toISOString(),
    reference,
    spark_consensus: sparkConsensus,
    spark_sethash_consensus: sethashConsensus,
    anonset_checked_at: anonsetCheckedAt,
    endpoints: rows,
    summary,
    stats,
    polling: false,
  }
}

// Warm-instance cache so /api/ci|/status|/spark|/badge share one probe sweep
// instead of each cold browser hit re-TLS'ing all six backends (~3–8s).
const CACHE_TTL_MS = 25_000
let fleetCache = null // { at, rowsPromise } | null

function probeFleet(timeoutMs = 8000) {
  const now = Date.now()
  if (fleetCache && now - fleetCache.at < CACHE_TTL_MS) {
    return fleetCache.rowsPromise.then((rows) => ({
      rows: rows.map((r) => ({ ...r })),
      cached: true,
      age_ms: now - fleetCache.at,
    }))
  }
  const rowsPromise = Promise.all(REGISTRY.map((ep) => probeServer(ep, timeoutMs)))
  fleetCache = { at: now, rowsPromise }
  rowsPromise.catch(() => {
    if (fleetCache && fleetCache.rowsPromise === rowsPromise) fleetCache = null
  })
  return rowsPromise.then((rows) => ({
    rows: rows.map((r) => ({ ...r })),
    cached: false,
    age_ms: 0,
  }))
}

module.exports = {
  REGISTRY,
  probeServer,
  probeFleet,
  buildSnapshot,
  mode,
  median,
  classify,
  rttYellowThreshold,
  statusReasons,
}
