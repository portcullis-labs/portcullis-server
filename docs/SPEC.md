# Portcullis Server: Specification (v0.1)

Tags: **[SPEC]** from SEP-8. **[DESIGN]** a choice made here. If the live SEP-8 text differs, SEP-8 wins and the difference is recorded in DECISIONS.md.

## 1. Purpose
Portcullis Server is a SEP-8 approval server for regulated classic assets on Stellar. It checks each submitted transaction against issuer-configured rules, adds the authorize/deauthorize operations SEP-8 needs, signs with the issuer key only if the transaction is safe, and logs why it decided what it did. It never submits transactions. It does not make anyone legally compliant.

## 2. SEP-8 facts used
- A regulated asset's issuer account must have both Authorization Required and Authorization Revocable set. [SPEC]
- Wallets find the approval server through the issuer's `home_domain` `stellar.toml`: a `[[CURRENCIES]]` entry with `regulated = true`, `approval_server`, and `approval_criteria`. [SPEC]
- Request: `POST` to the approval server with a single `tx` parameter (base64 transaction envelope XDR signed by the user), as form-encoded or JSON. Response: JSON. CORS: `Access-Control-Allow-Origin: *`, and preflight OPTIONS answered. [SPEC]
- Response statuses (exact names): `success`, `revised`, `pending`, `action_required`, `rejected`. [SPEC]
  - `success`: `{status, tx, message?}`, HTTP 200. `tx` is the original transaction with the original signatures plus the issuer signature.
  - `revised`: `{status, tx, message}`, HTTP 200. `tx` is a revised transaction signed only by the issuer; the wallet re-signs. `message` says what was added.
  - `pending`: `{status, timeout, message?}`, HTTP 200. `timeout` is an integer in milliseconds (0 if unknown).
  - `action_required`: `{status, message, action_url, action_method?, action_fields?}`, HTTP 200.
  - `rejected`: `{status, error}`, HTTP 400.
- Revisions may only add operations, never change the intent of the user's operations. Added operations must not have the user's account as source. Reject rather than alter an amount. [SPEC]

## 3. Scope v0.1
In: `POST /tx_approve` with all five statuses produced by built-in rules; payments of one regulated classic asset; rules per_tx_limit, holding_cap, allowlist (with onMiss), denylist, lockup, review_threshold; safe-to-sign guard; fail-closed behaviour; issuer-flag check at startup; stellar.toml route; `check` dry-run command; decision log; testnet demo.
Out (reject with a clear reason): path payments, offers, fee-bump envelopes, any operation other than payments of the regulated asset (and issuer-sourced trustline-flag operations for that asset when the wallet pre-built the SEP-8 shape), KMS signer, trustline daemon, UI, mainnet.

## 4. Domain types (src/domain/types.ts)
```ts
export type Stroops = bigint;
export interface AssetId { code: string; issuer: string }
export interface Payment { from: string; to: string; asset: AssetId; amount: Stroops }
export interface AccountState {
  id: string;
  balance: Stroops;              // balance of the regulated asset (0n if no trustline)
  hasTrustline: boolean;
  authorized: boolean;           // trustline currently authorized
}
```
Rules operate on these plain types, not on raw XDR.

## 5. Errors (src/errors.ts)
`class PortcullisError extends Error { code: ErrorCode; httpStatus: 400 | 500 }`
`ErrorCode`: `MALFORMED_XDR`, `WRONG_NETWORK`, `UNSUPPORTED_FEE_BUMP`, `UNSUPPORTED_OPERATION`, `BAD_REQUESTER_SIGNATURE`, `MISSING_TIMEBOUND`, `TIMEBOUND_TOO_FAR`, `RULE_REJECTED`, `UNSAFE_TO_SIGN`, `UPSTREAM_UNAVAILABLE`, `INVALID_CONFIG`, `INTERNAL`.
Unexpected exceptions become `INTERNAL` with a generic message. The real error goes to the log, never the response.

## 6. Amounts (src/stellar/amount.ts)
- Grammar: `^(0|[1-9][0-9]*)(\.[0-9]{1,7})?$`. No sign, no exponent, no leading or trailing dot, no whitespace.
- `parseAmountToStroops(s: string): bigint`: throws `INVALID_CONFIG`-style error on invalid input; rejects values above int64 max (9223372036854775807 stroops).
- `formatStroops(v: bigint): string`: fixed 7 decimals.
- Property: `parseAmountToStroops(formatStroops(x)) === x` for all valid x.

## 7. Config (YAML, validated with zod)
```yaml
network: testnet                 # testnet | pubnet
asset: { code: GOAT, issuer: G... }
approval:
  maxTimeWindowSeconds: 300      # integer, 1..3600
  maxFeePerOperationStroops: "10000"
  maxOperations: 10
horizon: { url: https://horizon-testnet.stellar.org, timeoutMs: 3000, cacheTtlSeconds: 5 }
signer: { type: local, secretEnv: ISSUER_SECRET }
server: { port: 8080, publicBaseUrl: https://example.org }
log: { path: ./decisions.jsonl, includeXdr: false }
rules:
  - { id: per_tx_limit, max: "1000.0000000" }
  - { id: holding_cap, max: "50000.0000000" }
  - id: allowlist
    path: ./allowlist.csv
    onMiss: { action: action_required, url: "https://example.org/verify", method: GET, message: "Complete verification" }
  - { id: denylist, path: ./denylist.csv }
  - { id: lockup, until: "2027-01-01T00:00:00Z", applyTo: [source], exempt: [] }
  - { id: review_threshold, above: "5000.0000000", timeoutMs: 60000, message: "Manual review required", approvedTxHashesPath: ./approved-txs.txt }
```
- Unknown keys and unknown rule ids are errors. Addresses are validated as Stellar ed25519 public keys. Amounts follow the amount grammar.
- `network: pubnet` with `signer.type: local` is rejected at load. [DESIGN]
- The secret key is never part of the config; only the environment variable name is.

## 8. Rules (src/rules)
```ts
export type RuleResult =
  | { outcome: "pass" }
  | { outcome: "reject"; code: string; message: string }
  | { outcome: "pending"; timeoutMs: number; message?: string }
  | { outcome: "action_required"; message: string; actionUrl: string;
      actionMethod?: "GET" | "POST"; actionFields?: string[] };

export interface RuleContext {
  txHash: string;                // lowercase hex
  payments: Payment[];
  accounts: Map<string, AccountState>;   // every account named in payments
  nowMs: number;
  store: StateStore;
}
export interface Rule { id: string; evaluate(ctx: RuleContext): Promise<RuleResult> | RuleResult }
```
**Aggregation [DESIGN]:** every rule runs and every result is recorded. The decision follows precedence reject, then action_required, then pending, then pass. Ties break by config order. Aggregation returns the winning result plus all individual results.

Built-in rules:
- **per_tx_limit** `{max}`: reject (`PER_TX_LIMIT`) if any single payment amount exceeds `max`. Never alters amounts.
- **holding_cap** `{max}`: for each destination, reject (`HOLDING_CAP`) if its current balance + reserved inflows from the store + the sum of payments to it in this transaction exceeds `max`.
- **allowlist** `{path, onMiss?}`: CSV of G addresses, one per line, `#` comments and blank lines ignored; an invalid address is a load error. Every payment source and destination must be listed. On a miss: `reject` (`NOT_ALLOWLISTED`) by default, or `action_required` with the configured url, method and message when `onMiss` is set. The file is re-read when its modified time changes.
- **denylist** `{path}`: same file format. Any listed source or destination rejects (`DENYLISTED`).
- **lockup** `{until, applyTo, exempt}`: if `nowMs` is before `until`, reject (`LOCKED_UP`) when a payment's source (and/or destination, per `applyTo`) is not in `exempt`. `applyTo` defaults to `["source"]`.
- **review_threshold** `{above, timeoutMs, message, approvedTxHashesPath}`: if any payment amount exceeds `above` and `ctx.txHash` is not listed in the approved-hashes file (one hex hash per line, re-read on each evaluation), return `pending` with `timeoutMs` and `message`. Otherwise pass.

Rule registry: `buildRules(config): Rule[]` returns rules in config order.

## 9. State and reservations (src/state)
```ts
export interface Reservation {
  txHash: string; account: string; asset: AssetId;
  amount: Stroops; direction: "in" | "out"; expiresAtMs: number;
}
export interface StateStore {
  reserve(r: Reservation): Promise<void>;                    // idempotent on (txHash, account, direction)
  sumReserved(account: string, direction: "in" | "out", nowMs: number): Promise<Stroops>; // excludes expired
  release(txHash: string): Promise<void>;
  purgeExpired(nowMs: number): Promise<number>;
}
```
Approval is not settlement: Portcullis cannot see whether the wallet submits. A reservation holds quota until the transaction's upper timebound, so concurrent requests cannot jointly exceed a cap. In-memory adapter in v0.1. Tests: idempotency, expiry, release, simultaneous reservations (no lost entries), and a property test that `sumReserved` equals the sum of unexpired reservations.

## 10. Pipeline (milestone 2, for reference)
decode, classify, verify requester, check timebounds, load account states (Horizon with timeout, cache), evaluate and aggregate rules, compose, guard, sign, reserve, log. The guard runs on the exact transaction that will be signed.

## 11. Safe-to-sign guard (milestone 2, for reference)
Refuse (`UNSAFE_TO_SIGN`) unless all hold: transaction source is not the issuer; every issuer-sourced operation is a trustline-flag operation for the regulated asset targeting an account that appears in the transaction; no operation touches issuer options or signers; not a fee-bump; operation count within `maxOperations`; sequence number belongs to the user's source account. Fixtures first: issuer-sourced payment smuggled in, issuer as source, extra SetOptions, ChangeTrust, flag operation for a different asset.

## 12. Fail closed
Horizon timeouts or errors never produce a signature. Return `rejected` with `Compliance check temporarily unavailable. Try again.` [DESIGN]

## 13. Decision log (JSON lines)
One line per request: timestamp, request id, tx hash, source, outcome, per-rule results, error code if any, `durationMs`. Full XDR only if `log.includeXdr` is true. Never secrets.

## 14. Other milestone 2 and 3 items, for reference
Authorize/deauthorize composer (record on testnet whether SetTrustLineFlags or AllowTrust is correct, with transaction hashes); local signer (testnet only); Hono server with CORS and preflight; `GET /.well-known/stellar.toml` generated from config; `GET /health`; startup issuer-flag check; `check` command (dry run, no signing); demo script; `stellar-toml-lint` in CI; docs/THREAT_MODEL.md.

## 15. Testing
- Golden fixtures: `fixtures/rules/<rule>/*.json` with `{ name, ruleConfig, context, expected }`. One test file loads every fixture for a rule. Each rule needs at least: a pass case, each reject or non-pass outcome, and boundary values (exactly at the limit).
- Property tests with fast-check for amounts and reservations.
- `pnpm test` runs offline. Integration tests are opt-in and use testnet.
