#!/usr/bin/env node
/**
 * Spark fleet health check — exit 0 when firostatus /api/ci reports spark_ok.
 * Local CI helper. Complements a wallet Electrum client; does not replace it.
 *
 *   node scripts/spark-health-check.js
 *   FIROSTATUS_ORIGIN=https://firostatus.com node scripts/spark-health-check.js
 *   node scripts/spark-health-check.js --strict   # require ok (spark_ok AND max_lag ≤ 2)
 */

const origin = (process.env.FIROSTATUS_ORIGIN || 'https://firostatus.com').replace(/\/+$/, '')
const strict = process.argv.includes('--strict')

async function main() {
  const res = await fetch(`${origin}/api/ci`, { headers: { accept: 'application/json' } })
  let body
  try {
    body = await res.json()
  } catch {
    console.error('spark-health-check: response was not JSON')
    process.exit(2)
  }
  const sparkOk = body && body.spark_ok === true
  const ok = body && body.ok === true
  const pass = strict ? ok : sparkOk
  const line = [
    pass ? 'PASS' : 'FAIL',
    `spark_ok=${sparkOk}`,
    `ok=${ok}`,
    `max_lag=${body.max_lag != null ? body.max_lag : '—'}`,
    `red=${body.red != null ? body.red : '—'}`,
    origin,
  ].join('  ')
  console.log(line)
  if (Array.isArray(body.reasons) && body.reasons.length) {
    for (const r of body.reasons) console.log('  reason:', r)
  }
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('spark-health-check:', e && e.message)
  process.exit(2)
})
