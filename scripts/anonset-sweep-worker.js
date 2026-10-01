#!/usr/bin/env node
// Child process: heavy anon-set sweeps stay off the HTTP event loop.
// Writes data/anonset-last.json then exits. Parent reloads and publishes.
const fs = require('fs')
const path = require('path')
const { REGISTRY } = require('../lib/probe')
const { probeAnonset, DEFAULT_BUDGET_MS } = require('../lib/anonsetProbe')

const OUT = path.join(__dirname, '..', 'data', 'anonset-last.json')
const BUDGET = Number(process.env.ANONSET_BUDGET_MS) || DEFAULT_BUDGET_MS

async function main() {
  const endpoints = {}
  // Merge prior last-good so a single host failure does not wipe the file.
  try {
    if (fs.existsSync(OUT)) {
      const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'))
      Object.assign(endpoints, (prev && prev.endpoints) || {})
    }
  } catch {}

  console.log(`[anonset-worker] sweep start (${REGISTRY.length} hosts, ${BUDGET / 1000}s budget)`)
  for (const ep of REGISTRY) {
    try {
      const measured = await probeAnonset(ep, BUDGET)
      measured.source = 'live'
      endpoints[ep.id] = measured
      console.log(
        `[anonset-worker] ${ep.name}: ${
          measured.ok
            ? `${measured.coins} coins · ${((measured.bytes || 0) / 1048576).toFixed(1)} MB · ${((measured.ms || 0) / 1000).toFixed(1)}s`
            : measured.error
        }`,
      )
    } catch (e) {
      if (!endpoints[ep.id] || !endpoints[ep.id].ok) {
        endpoints[ep.id] = {
          id: ep.id,
          ok: false,
          error: String(e && e.message),
          at: new Date().toISOString(),
          source: 'live',
        }
      }
      console.error(`[anonset-worker] ${ep.name} failed`, e && e.message)
    }
    // Persist progressively so a killed worker still leaves partial progress.
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(
      OUT,
      JSON.stringify({
        checked_at: null,
        sweeping: true,
        saved_at: new Date().toISOString(),
        endpoints,
      }),
    )
  }

  const checked_at = new Date().toISOString()
  fs.writeFileSync(
    OUT,
    JSON.stringify({
      checked_at,
      sweeping: false,
      saved_at: checked_at,
      endpoints,
    }),
  )
  console.log('[anonset-worker] sweep complete ->', OUT)
}

main().catch((e) => {
  console.error('[anonset-worker] fatal', e)
  process.exit(1)
})
