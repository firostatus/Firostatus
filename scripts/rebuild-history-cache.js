#!/usr/bin/env node
// Child process: build pre-warmed /api/history JSON files off the HTTP event loop.
const fs = require('fs')
const path = require('path')
const { REGISTRY } = require('../lib/probe')
const history = require('../lib/history')

const HIST_FLEET_HOURS = 168
const HIST_FLEET_LIMIT = 900
const HIST_EP_HOURS = 168
const HIST_EP_LIMIT = 800
const OUT_DIR = path.join(__dirname, '..', 'data', 'history-cache')

function writeEntry(name, body) {
  const built_at = Date.now()
  const withCache = Object.assign({}, body, {
    cache: {
      hit: true,
      built_at: new Date(built_at).toISOString(),
      age_s: 0,
      refreshing: false,
      note: 'Pre-cached after the latest probe poll.',
      mode: body.query && body.query.id ? 'endpoint' : 'fleet',
    },
  })
  const json = JSON.stringify(withCache)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, name + '.json'), json)
  fs.writeFileSync(
    path.join(OUT_DIR, name + '.meta.json'),
    JSON.stringify({ built_at, bytes: json.length }),
  )
  return json.length
}

function main() {
  const t0 = Date.now()
  history.open()
  let total = 0
  for (const ep of REGISTRY) {
    const body = history.historyPayload({
      hours: HIST_EP_HOURS,
      limit: HIST_EP_LIMIT,
      id: ep.id,
      skipEvents: true,
    })
    total += writeEntry('ep-' + ep.id, body)
  }
  const fleet = history.historyPayload({
    hours: HIST_FLEET_HOURS,
    limit: HIST_FLEET_LIMIT,
    skipEvents: true,
  })
  total += writeEntry('fleet', fleet)
  console.log(`[history-cache-worker] wrote fleet+${REGISTRY.length} endpoints (${total}B) in ${Date.now() - t0}ms`)
}

main()
