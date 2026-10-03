# Portcullis Server: Threat Model & Security Architecture (v0.1)

## 1. Overview & System Description

Portcullis Server is a SEP-8 approval server designed to enforce compliance rules on regulated classic Stellar assets. Assets under SEP-8 regulation have their issuer accounts configured with `Authorization Required` (`auth_required: true`) and `Authorization Revocable` (`auth_revocable: true`). In normal operation, user trustlines are kept in an unauthorized state. When a user creates a payment transaction, Portcullis inspects the transaction, evaluates rule criteria against local and chain state, wraps the user's payment inside a temporary authorize/deauthorize sandwich, and signs the transaction with the issuer's secret key.

Because Portcullis holds an issuer secret key capable of authorizing trustlines and modifying asset flags, it is a high-value security target. This threat model details the assets protected, adversary capabilities, threat vectors, mitigations, and residual risks for Portcullis Server v0.1.

---

## 2. Assets & Security Boundaries

### 2.1 Protected Assets
- **Issuer Secret Key:** The ed25519 private key belonging to the asset issuer. If compromised, an attacker can authorize arbitrary accounts, issue tokens, or clear clawback flags on the network.
- **Ledger Invariants & Rule Limits:** Compliance caps (e.g. `per_tx_limit`, `holding_cap`, `allowlist`, `lockup`, `review_threshold`). An adversary must not be able to exceed configured limits or transfer locked-up assets.
- **Reservation State & Concurrency Quotas:** In-flight transaction quota reservations in `StateStore` preventing double-spend or cap evasion.
- **Decision Audit Logs:** The immutable record of approval decisions, rule evaluation outcomes, transaction hashes, and error codes.
- **Confidentiality of Internal State:** Secret environment variables, server internals, and stack traces must never be exposed to clients or external network observers.

### 2.2 Security Boundaries & Interfaces
- **External Client API (`POST /tx_approve`, `GET /.well-known/stellar.toml`, `GET /health`):** Publicly accessible over HTTP/HTTPS. All external input is treated as untrusted.
- **Upstream Stellar Horizon API:** External HTTP service queried for account balances, flags, and sequence numbers. Treated as semi-trusted (can fail, timeout, or partition, but cannot forge signatures).
- **Local File System:** Hosts configuration YAML, allowlist CSV, denylist CSV, review hash files, and decision log files.

---

## 3. Adversary Models & Threat Vectors

### 3.1 Untrusted Transaction Submitter (External Adversary)
- Submits crafted, malformed, or malicious XDR payloads.
- Submits pre-built transactions attempting to sneak in unauthorized operations, fee bumps, muxed accounts, or path payments.
- Submits transactions with forged or altered `SetTrustLineFlags` operations attempting to modify flags other than `authorized` (e.g. clearing `clawbackEnabled` or setting `authorizedToMaintainLiabilities`).
- Sends high volumes of concurrent requests to trigger race conditions or cap bypasses.
- Sends replayed, expired, or invalid sequence number transactions.

### 3.2 Upstream Dependency Failure / Partition
- Horizon node goes offline, times out, returns 500/503 errors, or delivers corrupted responses.

### 3.3 Rule Data Modification / Outages
- Allowlist, denylist, or review hash files are modified, deleted, or corrupted on disk during runtime.

---

## 4. Threat Analysis & Mitigations

### 4.1 Safe-to-Sign Guard & Exact Flag Content Verification
* **Threat:** An attacker crafts a transaction that appears to be a valid SEP-8 payment but includes malicious issuer operations (e.g., clearing `clawbackEnabled`, authorizing unauthorized third parties, or omitting the trailing deauthorize operation).
* **Mitigation:**
  - `assertSafeToSign` in `src/pipeline/guard.ts` executes on the exact transaction object immediately prior to signing.
  - Enforces strict sandwich structure: leading block of authorize operations, payment block, trailing block of deauthorize operations.
  - Requires **exact flag content**: `flags.authorized === true` (or `false`) and strictly enforces that `flags.authorizedToMaintainLiabilities === undefined` and `flags.clawbackEnabled === undefined`.
  - Verifies that the set of trustors in the authorize block matches the deauthorize block exactly (1:1), each trustor appears exactly once per block, and every authorized trustor is a counterparty in the payment operations.
  - `compose` in `src/pipeline/compose.ts` discards any user-supplied issuer operations if they deviate from exact flags, rebuilding clean operations and returning `revised` status.

### 4.2 Concurrency Serialization & Holding Cap Protection
* **Threat:** An attacker submits multiple concurrent transactions to a single destination account where each individual payment is below `holding_cap`, but the aggregate exceeds the cap.
* **Mitigation:**
  - `AccountLockManager` in `src/pipeline/lock.ts` serializes check-and-reserve execution using keyed mutexes locked in lexicographically sorted order (preventing deadlocks).
  - `StateStore` records reservations against destination accounts with an expiration matching the transaction upper timebound.
  - `holding_cap` evaluates `current_balance + sum_reserved_inflows + payment_amount <= max`.
  - `sumReserved` accepts `excludeTxHash` so legitimate client retries of the same transaction do not double-count against their own prior reservations.

### 4.3 Fail-Closed Upstream Horizon Handling
* **Threat:** Horizon network failures or timeouts cause Portcullis to assume account balances are zero or trustlines exist, leading to invalid approvals.
* **Mitigation:**
  - All upstream failures, network aborts, or non-200 responses immediately abort the pipeline.
  - Returns HTTP 400 `rejected` with `Compliance check temporarily unavailable. Try again.` without signing or writing reservations.
  - Missing account states in `holding_cap` reject with `ACCOUNT_STATE_MISSING`.

### 4.4 Information Leakage & Secret Sanitization
* **Threat:** Exceptions or internal errors leak the issuer secret key, environment variable contents, or sensitive internal paths to the client.
* **Mitigation:**
  - Generic client-facing error responses (`Request could not be processed.` with HTTP 500) for internal errors.
  - No error codes (`code` field) or stack traces are included in client HTTP responses.
  - Full details and error codes are logged only to the local decision log and `process.stderr`.
  - Signer secret keys are loaded from environment variables into memory and never logged or serialized.

### 4.5 Precondition & Scope Enforcement
* **Threat:** Attackers submit complex Stellar features (e.g. fee-bump envelopes, muxed accounts `M...`, path payments, liquidity pool operations, account merge, extra signers, ledger bounds).
* **Mitigation:**
  - `classify` and `checkPreconditions` strictly allow only payments of the single configured regulated classic asset.
  - Any fee-bump envelope, muxed account, or unexpected precondition triggers immediate rejection (`UNSUPPORTED_OPERATION` or `UNSUPPORTED_FEE_BUMP`).
  - Strict fee cap verification (`maxFeePerOperationStroops`) applies to both unshaped and pre-shaped transactions.

### 4.6 File-Backed Rule Integrity
* **Threat:** Corruption or disk read errors when reloading CSV allowlists or hash files lead to bypass or crash.
* **Mitigation:**
  - Fail-fast validation on startup (`loadConfigFile`, `AllowlistRule`, `DenylistRule`, `ReviewThresholdRule`).
  - Runtime mtime/size change detection with fail-closed behavior: if a file cannot be read or parsed on refresh, the rule evaluation fails closed with `LIST_UNAVAILABLE`.
  - Aggregation engine wraps all rule evaluations in try/catch to ensure individual rule exceptions fail closed with `RULE_ERROR`.

---

## 5. Security Invariants Checklist

| Invariant | Enforcement Point | Failure Mode |
|---|---|---|
| Issuer key never signs unvalidated operations | `src/pipeline/guard.ts` | Throws `PortcullisError("UNSAFE_TO_SIGN")` |
| Clawback and liabilities flags cannot be altered via sandwich | `src/pipeline/guard.ts`, `src/pipeline/compose.ts` | Recomposed cleanly or rejected |
| Replayed/expired timebounds cannot be signed | `src/pipeline/timebounds.ts` | Rejected with `TIMEBOUND_EXPIRED` |
| Fee cannot exceed `maxFeePerOperationStroops` | `src/pipeline/fee.ts` | Rejected with `FEE_TOO_HIGH` |
| Destination cannot exceed `holding_cap` concurrently | `src/pipeline/lock.ts`, `src/state/memory.ts` | Serialized mutex + reservation check |
| Accounts without trustlines cannot be approved | `src/pipeline/runner.ts` | Rejected with `NO_TRUSTLINE` |
| Upstream outage never produces signatures | `src/pipeline/runner.ts` | Returns HTTP 400 `rejected` |
| Startup fails if issuer flags are unsafe | `src/config/issuer-check.ts` | Process aborts on startup |

---

## 6. Residual Risks & Future Work (v0.2+)

1. **Testnet Only (v0.1):** Version 0.1 is designed and scoped for testnet experimentation and evaluation. Mainnet operation requires formal audit and hardware/KMS signing.
2. **Local Key Storage:** `LocalSigner` loads the private key from an environment variable in process memory. Future milestones will introduce HSM / KMS signers (AWS KMS, Google Cloud KMS, Vault).
3. **In-Memory Reservation Store:** The default `MemoryStateStore` maintains reservation quotas in process memory. Multi-instance horizontal scaling requires distributed state storage (e.g. Redis / PostgreSQL with transactional locking).
4. **Post-Signing Transaction Replacement:** Because Portcullis does not submit transactions to the Stellar network, a wallet could hold a signed transaction without submitting it until the expiration time. In-flight reservations expire at `maxTime` to release held quota.
