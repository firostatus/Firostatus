# Contributing

Thanks for helping keep Firo’s public Spark Electrum fleet visible.

## Run locally

Requires **Node.js ≥ 22.5** (uses built-in `node:sqlite`). No `npm install` required at the repo root.

```bash
git clone https://gitlab.com/panagiotispollis/firostatus.git
cd firostatus
npm start   # -> http://localhost:3000
```

- Light probes every ~45s
- Full anon-set sweep every ~5 minutes (child process; ~45s budget per host)
- Durable history in `data/history.sqlite` (gitignored)

Production acceptance is always-on `server.js` + `public/` on [firostatus.com](https://firostatus.com/).

## What belongs in a PR

Good contributions:

- Registry additions/corrections for **known public** Electrum hosts wallets already use
- Docs / methodology clarifications
- Bugfixes in probes, scoring, API, or UI
- Tests or scripts that stay privacy-safe

Out of scope / will be declined:

- Scanning the internet for new Electrum hosts
- Any probe that sends addresses, keys, transactions, or wallet traffic
- Replacing wallets / SDKs with an in-app server picker
- Mempool or P2P gossip metrics we do not measure

## Registry changes

Edit the `REGISTRY` array in [`lib/probe.js`](lib/probe.js):

```js
{ id: 'stable-id', name: 'Display name', host: 'example.com', port: 50002, operator: 'Operator' }
```

Use a stable `id` (lowercase, hyphenated). Prefer hosts that appear in real wallet defaults (Campfire, Stack, Firo Core, etc.).

## Privacy rules (hard)

Probes may only use public Electrum methods:

- `server.version`
- `blockchain.headers.subscribe`
- `spark.getsparklatestcoinid`
- `spark.getsparkanonymityset`

No addresses, keys, memos, or user wallet data — ever.

## Methodology

See [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) for reference tip, status colors, anon-set sweeps, and uptime definition.

## License

MIT — see [LICENSE](LICENSE).
