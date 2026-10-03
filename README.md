# Portcullis Server

> **Status:** Version 0.1 (Testnet Only, Unaudited)

Some digital assets on Stellar are "regulated": the company that issues them has to approve certain transfers before they can happen. Stellar has a standard for this, called SEP-8, where a wallet sends each transfer to an approval server run by the issuer. The reference server published by the Stellar Development Foundation handles a single rule and is marked for testing only.

**Portcullis Server** is an open-source SEP-8 approval server configured via YAML: transfer limits, maximum balances, allowed and blocked accounts, lockup dates, and manual-review thresholds. For each transfer request it checks the rules, adds the authorize/deauthorize sandwich operations Stellar needs, verifies the transaction with a strict safe-to-sign guard, signs only if safe, and logs why it decided what it did.

> [!WARNING]
> Version 0.1 is testnet-only and unaudited. It helps an issuer enforce its own configured business rules; it does not make anyone legally compliant.

---

## Features

- **Full SEP-8 Compliance:** Supports all 5 response statuses (`success`, `revised`, `pending`, `action_required`, `rejected`) over `POST /tx_approve`.
- **CORS & Preflight:** Universal CORS headers (`Access-Control-Allow-Origin: *`) across all responses including errors and preflight `OPTIONS`.
- **Dynamic stellar.toml:** Serves `GET /.well-known/stellar.toml` with `[[CURRENCIES]]` criteria derived from configured rules.
- **Fail-Closed Architecture:** Upstream Horizon timeouts and errors fail closed without producing signatures.
- **Safe-to-Sign Guard:** Verifies exact sandwich structure and exact flag states before signing.
- **Concurrent Quota Reservations:** In-flight check-and-reserve serialized with keyed account mutexes.
- **Dry-Run CLI (`pnpm check`):** Inspect and dry-run rule evaluations against transaction XDRs without signing or reserving quota.
- **Startup Issuer Verification:** Validates Horizon `auth_required` and `auth_revocable` flags before serving requests.

---

## Getting Started

### Prerequisites
- Node.js 24.19.0 (pinned in `.nvmrc`)
- pnpm 12.6.0+

### Installation & Build

```bash
# Install dependencies
pnpm install

# Build TypeScript to dist/
pnpm build

# Run quality checks (lint, typecheck, offline tests)
pnpm lint
pnpm typecheck
pnpm test
```

---

## Configuration

Portcullis is configured using a YAML file (e.g., `portcullis.yaml`):

```yaml
network: testnet                 # testnet | pubnet
asset:
  code: USDC
  issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
approval:
  maxTimeWindowSeconds: 300      # 1..3600
  maxFeePerOperationStroops: "10000"
  maxOperations: 10
horizon:
  url: https://horizon-testnet.stellar.org
  timeoutMs: 3000
  cacheTtlSeconds: 5
signer:
  type: local
  secretEnv: ISSUER_SECRET       # Environment variable holding the issuer secret key
server:
  port: 8080
  publicBaseUrl: https://approval.example.org
log:
  path: ./decisions.jsonl
  includeXdr: false
rules:
  - id: per_tx_limit
    max: "1000.0000000"
  - id: holding_cap
    max: "50000.0000000"
  - id: allowlist
    path: ./allowlist.csv
    onMiss:
      action: action_required
      url: https://kyc.example.com/verify
      method: GET
      message: Identity verification required
  - id: denylist
    path: ./denylist.csv
  - id: lockup
    until: "2027-01-01T00:00:00Z"
    applyTo: [source]
    exempt: []
  - id: review_threshold
    above: "5000.0000000"
    timeoutMs: 60000
    message: Manual compliance review required
    approvedTxHashesPath: ./approved-txs.txt
```

---

## Running the Server

Set the issuer secret environment variable and start the server:

```bash
export ISSUER_SECRET="S..."
pnpm start -- --config ./portcullis.yaml
```

CLI options:
- `--config <path>`: Path to YAML configuration (default: `./portcullis.yaml`).
- `--port <number>`: Override port from config.
- `--skip-issuer-check`: Bypass Horizon issuer account flag check at startup (for offline development/testing).

---

## HTTP Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/tx_approve` | SEP-8 transaction approval endpoint (JSON or form-encoded `tx`). |
| `GET` | `/.well-known/stellar.toml` | SEP-1 / SEP-8 discovery file with regulated currency metadata. |
| `GET` | `/health` | Liveness check returning `{ "ok": true, "version": "..." }`. |
| `OPTIONS` | `*` | CORS preflight handler. |

---

## Dry-Run Check Command

Evaluate rules against a transaction XDR without signing or writing reservations:

```bash
pnpm check -- --config ./portcullis.yaml --tx <xdr-or-file> [--state <json-or-file>] [--json]
```

Exit codes:
- `0`: Transaction passed all rules (`pass`).
- `1`: Transaction was rejected by a rule (`reject`).
- `2`: Transaction requires pending review or user action (`pending` / `action_required`).
- `3`: Operational error (invalid arguments, malformed XDR, or bad configuration).

---

## License

Apache License 2.0. Copyright (c) 2026 Portcullis Labs contributors.
