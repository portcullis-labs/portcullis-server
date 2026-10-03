# Portcullis Server: Specification (v0.1.1)

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
`ErrorCode`: `MALFORMED_XDR`, `UNSUPPORTED_FEE_BUMP`, `UNSUPPORTED_OPERATION`, `BAD_REQUESTER_SIGNATURE`, `MISSING_TIMEBOUND`, `TIMEBOUND_EXPIRED`, `TIMEBOUND_TOO_FAR`, `NO_TRUSTLINE`, `RULE_REJECTED`, `UNSAFE_TO_SIGN`, `UPSTREAM_UNAVAILABLE`, `INVALID_CONFIG`, `LOG_FAILURE`, `INTERNAL`.
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
**Aggregation [DESIGN]:** every rule runs and every result is recorded. The decision follows precedence reject, then action_required, then pending, then pass. Ties break by config order. Aggregation wraps every rule evaluation in a try/catch block so throwing rules fail closed with `{ outcome: "reject", code: "RULE_ERROR", message: "Rule evaluation failed" }`, forwarding the real error to an optional `onRuleError(ruleId, error)` handler. Aggregation returns the winning result plus all individual results.

Built-in rules:
- **per_tx_limit** `{max}`: reject (`PER_TX_LIMIT`) if any single payment amount exceeds `max`. Never alters amounts.
- **holding_cap** `{max}`: for each destination, reject (`HOLDING_CAP`) if its current balance + reserved inflows from the store (excluding `ctx.txHash`) + the sum of payments to it in this transaction exceeds `max`. If any destination is missing from `ctx.accounts`, reject (`ACCOUNT_STATE_MISSING`).
- **allowlist** `{path, onMiss?}`: CSV of G addresses, one per line, `#` comments and blank lines ignored; an invalid address is a load error. Every payment source and destination must be listed. On a miss: `reject` (`NOT_ALLOWLISTED`) by default, or `action_required` with the configured url, method and message when `onMiss` is set. The file is validated at construction and re-checked on mtime/size change; refresh failures reject with `LIST_UNAVAILABLE`.
- **denylist** `{path}`: same file format and validation semantics. Any listed source or destination rejects (`DENYLISTED`). Refresh failures reject with `LIST_UNAVAILABLE`.
- **lockup** `{until, applyTo, exempt}`: if `nowMs` is before `until`, reject (`LOCKED_UP`) when a payment's source (and/or destination, per `applyTo`) is not in `exempt`. `applyTo` defaults to `["source"]`.
- **review_threshold** `{above, timeoutMs, message, approvedTxHashesPath}`: if any payment amount exceeds `above` and `ctx.txHash` is not listed in the approved-hashes file (one hex hash per line matching `^[0-9a-f]{64}$`, validated at construction, re-checked on each evaluation), return `pending` with `timeoutMs` and `message`. Refresh failures reject with `LIST_UNAVAILABLE`. Otherwise pass.

Rule registry: `buildRules(config): Rule[]` returns rules in config order.

## 9. State and reservations (src/state)
```ts
export interface Reservation {
  txHash: string; account: string; asset: AssetId;
  amount: Stroops; direction: "in" | "out"; expiresAtMs: number;
}
export interface StateStore {
  reserve(r: Reservation): Promise<void>;                    // idempotent on (txHash, account, direction)
  sumReserved(account: string, direction: "in" | "out", nowMs: number, excludeTxHash?: string): Promise<Stroops>; // excludes expired and optionally excludeTxHash
  release(txHash: string): Promise<void>;
  purgeExpired(nowMs: number): Promise<number>;
}
```
Approval is not settlement: Portcullis cannot see whether the wallet submits. A reservation holds quota until the transaction's upper timebound, so concurrent requests cannot jointly exceed a cap. In-memory adapter in v0.1. Tests: idempotency, expiry, release, simultaneous reservations (no lost entries), and a property test that `sumReserved` equals the sum of unexpired reservations.

## 10. Pipeline (milestone 2, for reference)
decode, check unsupported preconditions, classify, verify requester, check timebounds, check fee cap, load account states (Horizon with timeout, cache), check trustlines, evaluate and aggregate rules, compose, guard, sign, write decision log, reserve. The guard runs on the exact transaction that will be signed.

## 11. Safe-to-sign guard (milestone 2, for reference)
Refuse (`UNSAFE_TO_SIGN`) unless all hold: transaction source is not the issuer; not a fee-bump; operation count within `maxOperations`; sequence number belongs to the user's source account; and the transaction matches the exact SEP-8 sandwich structure: a leading block of issuer-sourced authorize operations (flags `authorized: true`, nothing else changed), followed only by user-sourced payments of the regulated asset not involving the issuer as source or destination, followed by a trailing block of issuer-sourced deauthorize operations (flags `authorized: false`, nothing else changed), where the set of trustors in both blocks is identical, each trustor appears exactly once per block, and every trustor appears as a payment source or destination.

## 12. Fail closed
Horizon timeouts or errors never produce a signature. Return HTTP 400 `rejected` with `Compliance check temporarily unavailable. Try again.` [DESIGN]. Unexpected internal errors, logging failures, and invalid configurations return HTTP 500 `rejected` with `Request could not be processed.` without leaking internal details or error codes.

## 13. Decision log (JSON lines)
One line per request: timestamp, request id, tx hash, source, outcome, per-rule results, error code if any, `durationMs`. Full XDR only if `log.includeXdr` is true. Never secrets.

## 14. Other milestone 2 and 3 items, for reference
Authorize/deauthorize composer (record on testnet whether SetTrustLineFlags or AllowTrust is correct, with transaction hashes); local signer (testnet only); Hono server with CORS and preflight; `GET /.well-known/stellar.toml` generated from config; `GET /health`; startup issuer-flag check; `check` command (dry run, no signing); demo script; `stellar-toml-lint` in CI; docs/THREAT_MODEL.md.

## 15. Testing
- Golden fixtures: `fixtures/rules/<rule>/*.json` with `{ name, ruleConfig, context, expected }`. One test file loads every fixture for a rule. Each rule needs at least: a pass case, each reject or non-pass outcome, and boundary values (exactly at the limit).
- Property tests with fast-check for amounts and reservations.
- `pnpm test` runs offline. Integration tests are opt-in and use testnet.

## 16. Amendments (v0.1.1)
- **Self-reservation double counting fix:** `StateStore.sumReserved` accepts an optional `excludeTxHash` parameter. `holding_cap` passes `ctx.txHash` so retries of the same transaction do not count against their own prior reservations.
- **Fail closed on missing account state:** `holding_cap` rejects with code `ACCOUNT_STATE_MISSING` if any destination account state is absent from `ctx.accounts`, instead of treating it as zero.
- **Fail-fast validation and fail-closed refresh for file-backed rules:** `allowlist`, `denylist`, and `review_threshold` validate their files at construction (`INVALID_CONFIG`). During evaluations, file mtime and size are checked. Any refresh failure fails closed with `LIST_UNAVAILABLE` rather than using stale lists. Approved transaction hashes must match `^[0-9a-f]{64}$` (case-insensitive, stored lowercase).
- **Fail-closed rule aggregation:** Rule aggregation catches any uncaught exceptions thrown by a rule, recording a `{ outcome: "reject", code: "RULE_ERROR", message: "Rule evaluation failed" }` result and passing the underlying error to an optional `onRuleError(ruleId, error)` callback.
- **Error code adjustments:** Removed `WRONG_NETWORK` from `ErrorCode` (network passphrase mismatches manifest during requester signature verification as `BAD_REQUESTER_SIGNATURE`). Added `TIMEBOUND_EXPIRED`, `NO_TRUSTLINE`, and `LOG_FAILURE`.
- **Muxed account rejection:** Muxed addresses (`M...`) are rejected in v0.1 with `UNSUPPORTED_OPERATION`.
- **Concurrency serialization:** The approval pipeline serializes check-and-reserve per account via a keyed mutex locked in sorted order.

## 17. Amendments (v0.1.2)
- **Upstream Failure Response:** Upstream Horizon failures/timeouts return HTTP 400 with `{ status: "rejected", error: "Compliance check temporarily unavailable. Try again." }` without signing.
- **Internal Error Sanitization & Handling:** Unexpected runtime exceptions, `LOG_FAILURE`, `INVALID_CONFIG`, and runtime `UNSAFE_TO_SIGN` return HTTP 500 with generic `{ status: "rejected", error: "Request could not be processed." }`. Internal error details and codes are never sent to the client; they are logged to the decision log and, if logging is unavailable, to an optional `onInternalError(error)` callback.
- **Strict SEP-8 Client Responses:** The non-spec `code` property is removed from all client-visible HTTP responses. Error codes remain exclusively in internal decision logs.
- **Unsupported Transaction Preconditions:** Transactions with ledger bounds, minimum account sequence, minimum sequence age, minimum sequence ledger gap, or extra signers are rejected with `UNSUPPORTED_OPERATION` to preserve transaction intent.
- **NO_TRUSTLINE Check:** If any payment source or destination lacks a trustline for the regulated asset (`hasTrustline: false`), the request is rejected with `NO_TRUSTLINE` naming the account.
- **Strengthened Safe-to-Sign Guard:** The guard enforces the full transaction structure: a leading block of issuer-sourced authorize operations (`authorized: true`), user-sourced payments of the regulated asset (never to/from issuer), and a trailing block of issuer-sourced deauthorize operations (`authorized: false`) targeting the exact same set of unique accounts.
- **Required Lock Manager:** `lockManager` is a required property in `ApprovalDependencies`.
- **Safe Pipeline Execution Order:** The pipeline execution sequence after rule approval is: (1) sign transaction, (2) write decision log (must succeed), (3) write reservations to `StateStore`. If logging fails, reservations are not written and the signed transaction is discarded.
- **Universal Fee Cap:** The configured `maxFeePerOperationStroops` limit applies to every transaction (both shaped and unshaped).

