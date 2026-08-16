#!/usr/bin/env node
// Seed data/history.sqlite only when empty, so localhost charts have a window to show.
const path = require('path')
const history = require('../lib/history')

const GOOD = 'TECwNSPAH+jvynd/3LcXiStE2uf1rTDgxRGqj/8Sz8w='
const BAD = 'divergentSetHash____________'
const IDS = [
  { id: 'firo-core-0', name: 'core0' },
  { id: 'firo-core-1', name: 'core1' },
  { id: 'firo-core-2', name: 'core2' },
  { id: 'firo-core-3', name: 'core3' },
  { id: 'stackwallet', name: 'stack' },
  { id: 'mathnodes', name: 'math' },
]

function main() {
  history.open()
  const n = history.sampleCount()
  if (n > 0) {
    console.log(`[seed] sqlite already has ${n} samples — leaving it alone`)
    history.close()
    return
  }
  const start = Date.now() - 8 * 86400000
  const step = 20 * 60_000
  let recorded = 0
  for (let t = start; t <= Date.now(); t += step) {
    const ageH = (Date.now() - t) / 3600000
    const split = ageH < 40
    const endpoints = IDS.map((ep, i) => ({
      id: ep.id,
      status: split && ep.id === 'firo-core-1' ? 'yellow' : 'green',
      height: 1350000 + Math.floor((t - start) / step),
      lag: split && ep.id === 'firo-core-1' ? 4 : 0,
      latency_ms: 180 + i * 20,
      spark_latest_coin_id: 10,
      spark_consistent: true,
      anonset: {
        ms: 22000 + i * 400,
        mb: 20 + i * 0.4,
        coins: 24000 + Math.floor((t - start) / step),
        setHash: split && (ep.id === 'firo-core-1' || ep.id === 'mathnodes') ? BAD : GOOD,
      },
      tls_valid_to: '2027-03-01T00:00:00.000Z',
      tls_days_left: 200,
    }))
    history.recordSnapshot({
      checked_at: new Date(t).toISOString(),
      reference: 1350000,
      spark_consensus: 10,
      spark_sethash_consensus: GOOD,
      summary: { green: split ? 5 : 6, yellow: split ? 1 : 0, red: 0, total: 6 },
      endpoints,
    })
    recorded += 6
  }
  console.log(`[seed] wrote ${recorded} samples -> ${path.join('data', 'history.sqlite')}`)
  history.close()
}

main()
