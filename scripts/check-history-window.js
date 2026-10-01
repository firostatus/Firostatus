#!/usr/bin/env node
// Assert history windows return latest-in-range samples, not the oldest warmup tail.
const fs = require('fs')
const os = require('os')
const path = require('path')
const history = require('../lib/history')

const GOOD = 'hashGOOD________________'
const BAD = 'hashBAD_________________'

function seed(dbPath) {
  process.env.HISTORY_DB = dbPath
  history.close()
  history.open(dbPath)
  const ids = ['alpha', 'beta', 'gamma']
  const start = Date.now() - 8 * 86400000
  const step = 30 * 60_000
  for (let t = start; t <= Date.now(); t += step) {
    const ageH = (Date.now() - t) / 3600000
    const split = ageH < 36
    const endpoints = ids.map((id, i) => ({
      id,
      status: 'green',
      height: 1000 + Math.floor((t - start) / step),
      lag: 0,
      latency_ms: 200 + i,
      spark_latest_coin_id: 10,
      spark_consistent: true,
      anonset: {
        ms: 20000 + i * 100,
        mb: 20 + i,
        coins: 20000,
        setHash: split && id === 'gamma' ? BAD : GOOD,
      },
      tls_valid_to: '2027-01-01T00:00:00.000Z',
      tls_days_left: 140,
    }))
    history.recordSnapshot({
      checked_at: new Date(t).toISOString(),
      reference: 1000,
      spark_consensus: 10,
      spark_sethash_consensus: GOOD,
      summary: { green: 3, yellow: 0, red: 0, total: 3 },
      endpoints,
    })
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exit(1)
  }
  console.log('ok ', msg)
}

function main() {
  const tmp = path.join(os.tmpdir(), 'firo-hist-window-' + Date.now() + '.sqlite')
  seed(tmp)
  const h24 = history.historyPayload({ hours: 24, limit: 2500 })
  const h168 = history.historyPayload({ hours: 168, limit: 1200 })
  const h720 = history.historyPayload({ hours: 720, limit: 1200 })

  assert(h24.points.length > 0, '24h has points')
  assert(h168.points.length > 0, '7d has points')
  assert(h720.points.length > 0, '30d has points')

  const first24 = Date.parse(h24.points[0].t)
  const last24 = Date.parse(h24.points[h24.points.length - 1].t)
  assert(Date.now() - first24 <= 26 * 3600000, '24h first point is within ~24h (not warmup day 1)')
  assert(Date.now() - last24 <= 40 * 60_000, '24h last point is recent')
  assert(h24.query.hours === 24, '24h query.hours is 24')
  assert(h168.query.hours === 168, '7d query.hours is 168')
  assert(h720.query.hours === 720, '30d query.hours is 720')

  const first168 = Date.parse(h168.points[0].t)
  assert(Date.now() - first168 > 24 * 3600000, '7d window starts earlier than 24h')
  const ids168 = new Set((h168.points || []).map((p) => p.id))
  assert(ids168.has('alpha') && ids168.has('beta') && ids168.has('gamma'), '7d fleet points include every host')
  assert(h24.events.sethash.length > 0, '24h setHash events not empty')
  assert(h168.events.sethash.length > 0, '7d setHash events not empty')
  assert(String(h24.coverage || '').length > 0, 'coverage note present')

  history.close()
  try {
    fs.unlinkSync(tmp)
  } catch {}
  delete process.env.HISTORY_DB
  console.log('history window checks passed')
}

main()
