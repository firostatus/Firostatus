#!/usr/bin/env node
// Child process: build pre-warmed /api/history JSON files off the HTTP event loop.
const fs = require('fs')
const path = require('path')
const { REGISTRY } = require('../lib/probe')
const history = require('../lib/history')

const WINDOWS = [24, 168, 720]
const FLEET_LIMIT = { 24: 2500, 168: 1200, 720: 1200 }
const EP_LIMIT = { 24: 2500, 168: 800, 720: 800 }
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
  let files = 0
  for (const hours of WINDOWS) {
    for (const ep of REGISTRY) {
      const body = history.historyPayload({
        hours,
        limit: EP_LIMIT[hours],
        id: ep.id,
      })
      total += writeEntry('ep-' + ep.id + '-' + hours, body)
      files++
    }
    const fleet = history.historyPayload({
      hours,
      limit: FLEET_LIMIT[hours],
    })
    total += writeEntry('fleet-' + hours, fleet)
    files++
  }
  console.log(`[history-cache-worker] wrote ${files} files (${total}B) in ${Date.now() - t0}ms`)
}

main()
