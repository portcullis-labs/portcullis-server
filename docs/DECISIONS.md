# Architecture & Project Decisions

This document records the foundational architectural, organizational, and technical decisions for `portcullis-server`.

## 1. Repository Structure & Boundaries

- **Two Repositories:** The project is split into two distinct repositories under `portcullis-labs`:
  - `portcullis-server`: The SEP-8 approval server (this repository).
  - `portcullis-client`: The companion wallet-side client library.
- **Independence:** The client repository is built separately and is strictly independent of `portcullis-server` in v0.1. No cross-repo code dependencies or shared workspace links are used.

## 2. Licensing & Copyright

- **License:** Apache License 2.0 (`Apache-2.0`).
- **Copyright Holder:** `Portcullis Labs contributors`.
- **Copyright Year:** `2026`.

## 3. Technology Stack & Tooling

- **Language & Compiler:** TypeScript with strict configuration:
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
- **Runtime & Typings Alignment:** Node.js Active LTS (`24.19.0`), pinned explicitly in `.nvmrc`. `@types/node` is pinned to `24.19.0` to match the exact runtime major and version, ensuring standard library API typings match the target execution environment.
- **Package Manager & Supply Chain Safety:** `pnpm` with exact dependency pinning (no `^` or `~`) and frozen lockfile enforcement in CI. pnpm's minimum release age policy is strictly respected; no `minimumReleaseAgeExclude` bypasses in `pnpm-workspace.yaml` are allowed without explicit approval.
- **Linter & Formatter:** Biome (`@biomejs/biome`) for fast and unified linting and formatting.
- **Test Runner:** Vitest (`vitest`) for unit and property testing.
- **Runtime Libraries:** Runtime libraries (`@stellar/stellar-sdk`, `zod`, `yaml`) are pinned to exact verified versions.

## 4. Build Configuration & Compilation Boundaries

- **`tsconfig.build.json`:** Build compilation uses a dedicated `tsconfig.build.json` extending `tsconfig.json`. It sets `rootDir: "src"` and `outDir: "dist"`, includes only `src/**/*`, and explicitly excludes tests. This ensures production build artifacts in `dist/` contain only compiled application code without test files or an extra `src/` directory nesting level.
- **Static Typechecking:** `typecheck` continues to validate all files (`src/` and `test/`) with `tsc --noEmit` via root `tsconfig.json`.
- **Package Version Verification:** The version test reads `package.json` to verify that the exported `VERSION` constant in `src/version.ts` matches the canonical package version, preventing drift between release metadata and runtime exports.

## 5. Scope & Compliance Boundary

- **Target Scope:** Version 0.1 is testnet-only, unaudited, and covers payments of one regulated classic asset on Stellar.
- **Legal Disclaimer:** `portcullis-server` helps an issuer enforce its own configured business and transfer rules; it does not make any party legally compliant.

## 6. SEP-8 Specification Verification
 
- **Source:** `ecosystem/sep-0008.md` in `stellar/stellar-protocol`.
- **Checked Date:** 2026-10-02.
- **Status:** `Active`.
- **Specification Version:** `1.7.4`.
- **Created Date:** `2018-08-22`.
- **Last Updated Date:** `2022-02-21`.
- **Differences Observed:** None. The specification metadata and content match previous verification (v1.7.4, Active, last updated 2022-02-21).

## 7. Approval Pipeline & Security Decisions (Milestone 2)

- **WRONG_NETWORK Correction:** A Stellar transaction envelope XDR does not encode its network passphrase. Therefore, network passphrase mismatches cannot be detected during initial XDR decoding; instead, a passphrase mismatch alters the transaction hash and manifests as a failed requester signature check (`BAD_REQUESTER_SIGNATURE`).
- **Muxed Account Rejection:** Muxed addresses (`M...`) are explicitly rejected in v0.1 with `UNSUPPORTED_OPERATION` to avoid counterparty identification ambiguity and memo ID bypasses.
- **Fee Rule & Per-Operation Bound:** The fee per operation is computed as `totalFee / originalOpCount`. If this per-operation fee exceeds `config.approval.maxFeePerOperationStroops`, the request is rejected with `UNSUPPORTED_OPERATION` to prevent fee inflation attacks.
- **Transaction Shaping & Signing Order:**
  - For `revised` transactions (naked payment to which Portcullis adds authorize/deauthorize operations), user signatures over the original transaction hash are invalidated by adding operations. Therefore, the revised transaction is returned with *only* the issuer signature (`revised: true`), allowing the user's wallet to sign upon receipt.
  - For `success` transactions (already complete SEP-8 sandwich), the user's existing signatures are preserved and the issuer's signature is appended.
- **Fail-Closed Strategy:**
  - Horizon errors or timeouts fail closed and return HTTP 400 with `Compliance check temporarily unavailable. Try again.` without producing an unverified signature.
  - Rule exceptions fail closed with `{ outcome: "reject", code: "RULE_ERROR" }`.
  - Unwritable log files fail closed by throwing `LOG_FAILURE` to ensure decisions are never made without an audit trail.
- **Account Lock Serialization:** Check-and-reserve operations are serialized using a keyed async mutex locked across all unique payment counterparties in lexicographical order, preventing race conditions (e.g. concurrent cap bypasses) and avoiding deadlocks on multi-operation transactions.
- **Reservation Writing Invariants:** StateStore reservations are written *only* for `success` and `revised` outcomes with `expiresAtMs` set to the transaction upper timebound (`maxTime`). Requests resulting in `pending`, `action_required`, or `rejected` never hold quota reservations.

## 8. Specification Amendments & Security Hardening (v0.1.2)

- **SEP-8 Strict Error Response Conformity:** Rejection responses strictly follow SEP-8 (`{ status: "rejected", error: "..." }`). Extra non-spec fields (such as `code`) are removed from all client-visible payloads.
- **Internal Error Sanitization & Leakage Prevention:** Internal operational failures (`LOG_FAILURE`, `INVALID_CONFIG`, `UNSAFE_TO_SIGN`, uncaught exceptions) return HTTP 500 with a generic, sanitized error (`"Request could not be processed."`). Secret values, file paths, and internal error codes are reported only via `onInternalError` and the internal decision log.
- **Payment Participant Trustline Validation:** Payments are rejected with HTTP 400 (`NO_TRUSTLINE`) if either the source or destination account does not have an established trustline for the regulated asset.
- **Rejection of Unsupported Preconditions:** In v0.1, only standard `timeBounds` are supported. If a transaction contains unsupported V2 preconditions (`ledgerBounds`, `minAccountSequence`, `minAccountSequenceAge`, `minAccountSequenceLedgerGap`, `extraSigners`), it is rejected with `UNSUPPORTED_OPERATION` to preserve user conditional intent without silent stripping.
- **Strengthened Guard & Exact Sandwich Topology:** `assertSafeToSign` enforces a strict 3-phase partition: (1) leading block of issuer-sourced authorize operations (`authorized: true` with no liability/clawback changes), (2) middle block of user payments of the configured regulated asset between non-issuer accounts, and (3) trailing block of issuer-sourced deauthorize operations (`authorized: false`). Authorize and deauthorize trustors must match identically, contain no duplicates, and correspond to payment counterparties.
- **Required Lock Manager & Logging Order Invariants:** `lockManager` is required in `ApprovalDependencies`. The execution sequence after signing strictly enforces: (1) sign transaction, (2) write decision log (must succeed), (3) reserve quota in `StateStore`. If logging fails, the signed transaction is discarded and no state quota is reserved. Error path logging uses an exception-safe helper that never crashes the runner.
- **Fee-Cap Placement:** The fee-per-operation check is applied prior to transaction composition so that both unshaped and already-shaped transactions are bounded against fee inflation attacks.
- **Integration Test Skip Semantics:** Opt-in testnet integration tests mark unreachability explicitly as skipped (`ctx.skip()`) with a clear reason instead of silently passing. Post-submission assertions reload trustlines from Horizon to verify `is_authorized === false`, confirming temporary sandwich deauthorization.
