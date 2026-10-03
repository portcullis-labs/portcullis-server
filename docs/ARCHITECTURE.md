# Portcullis Server Architecture

This document describes the architectural layout, module structure, and pipeline execution design for `portcullis-server`.

## Codebase Structure

```
portcullis-server/
├── src/
│   ├── config/         # PortcullisConfig schema (Zod) and YAML parser/loader
│   │   ├── schema.ts   # Configuration Zod schemas and PortcullisConfig type
│   │   └── loader.ts   # YAML file loader with validation and env secret resolution
│   ├── domain/         # Core domain types (AssetId, Amount, AccountState, Stroops)
│   │   └── types.ts    # Common domain types, PaymentOperation, Stroops brand
│   ├── errors.ts       # PortcullisError class and ErrorCode definitions
│   ├── log/            # Structured JSON-lines audit logging
│   │   └── logger.ts   # DecisionLogger and DecisionLogEntry interfaces
│   ├── pipeline/       # Core SEP-8 approval pipeline
│   │   ├── classify.ts # Operation classifier (payments vs flag operations)
│   │   ├── compose.ts  # SEP-8 sandwich composer (authorize + payment + deauthorize)
│   │   ├── decode.ts   # XDR envelope decoder & precondition validator
│   │   ├── guard.ts    # assertSafeToSign invariant checker (sandwich structure)
│   │   ├── lock.ts     # AccountLockManager & withAccountLocks mutex
│   │   ├── runner.ts   # runApproval end-to-end pipeline coordinator
│   │   ├── sign.ts     # Issuer transaction signing & signature appending
│   │   ├── timebounds.ts # Upper bound and maxTimeWindowSeconds validation
│   │   └── verify-signature.ts # Requester cryptographic signature verification
│   ├── rules/          # Rule engine and built-in rule evaluators
│   │   ├── aggregate.ts # Rule evaluation & priority aggregation engine
│   │   ├── allowlist.ts # Allowlist rule (CSV / static list with onMiss actions)
│   │   ├── denylist.ts  # Denylist rule (CSV / static list)
│   │   ├── holding-cap.ts # Holding cap rule (balance + pending in-flight quota)
│   │   ├── lockup.ts    # Lockup schedule rule (linear & cliff vesting unlocks)
│   │   ├── per-tx-limit.ts # Per-transaction maximum amount limit rule
│   │   ├── registry.ts  # Rule registry constructor from PortcullisConfig
│   │   ├── review-threshold.ts # Review threshold rule (pending on large transfers)
│   │   └── types.ts     # Rule, RuleContext, and RuleResult interfaces
│   ├── signer/         # Cryptographic signing abstraction
│   │   ├── local.ts    # LocalSigner implementation with Keypair
│   │   └── types.ts    # IssuerSigner interface
│   ├── state/          # In-flight reservation state store
│   │   ├── memory.ts   # MemoryStateStore with expiration pruning
│   │   └── types.ts    # StateStore, QuotaReservation, and Direction types
│   ├── stellar/        # Stellar SDK helpers and Horizon integration
│   │   ├── account-state.ts # AccountStateProvider with cache, timeout & fail-closed logic
│   │   └── amount.ts   # Precise stroops integer arithmetic and conversion helpers
│   └── version.ts      # Package version exporter tied to package.json
├── fixtures/           # Golden fixtures for rules, guards, and test transactions
│   ├── guard/          # Adversarial guard fixtures expecting UNSAFE_TO_SIGN
│   └── rules/          # Rule fixtures (allowlists, denylists, review hashes)
├── test/               # Comprehensive offline unit, property, and integration tests
│   ├── integration/    # Opt-in live testnet round-trip test suite
│   ├── pipeline/       # Pipeline unit and end-to-end runner test suites
│   ├── rules/          # Unit tests for each rule evaluator
│   ├── signer/         # Local signer tests
│   ├── state/          # State store and concurrency tests
│   ├── stellar/        # Account state and stroops amount tests
│   └── version.test.ts # Version alignment assertion test
└── docs/               # Technical specifications and architectural records
    ├── ARCHITECTURE.md # System architecture and directory map
    ├── DECISIONS.md    # Architectural decision records and version changes
    ├── DEPENDENCIES.md # Exact dependency inventory ledger
    ├── QUALITY_BAR.md  # Engineering quality standards and quality bar
    ├── SPEC.md         # Full Portcullis SEP-8 server specification
    └── THREAT_MODEL.md # Security threat model and risk mitigations
```

## System Architecture & Pipeline Flow

The core approval engine processes incoming SEP-8 POST `/tx_approve` requests through a strict, sequential pipeline:

```
[Incoming POST /tx_approve Request] (tx: base64 XDR)
       │
       ▼
 1. Decode Envelope & Validate Preconditions (Reject V2 preconditions: ledgerBounds, minSeq, minSeqAge, minSeqLedgerGap, extraSigners)
       │
       ▼
 2. Classify Operations (Filter regulated payments & issuer flag ops; reject muxed M... addresses)
       │
       ▼
 3. Verify Requester Signature (Cryptographic ed25519 signature check against tx.source)
       │
       ▼
 4. Check Timebounds (Validate upper maxTime bound within configured window)
       │
       ▼
 5. Acquire Account Locks (Keyed mutex on sorted lexicographical account IDs to prevent deadlocks)
       │
       ├──► 6. Load Account State (Horizon fetch with cache and fail-closed timeout -> 400 on upstream error)
       │
       ├──► 7. Verify Trustlines (Ensure all payment participants have hasTrustline: true -> 400 NO_TRUSTLINE)
       │
       ├──► 8. Evaluate & Aggregate Rules (per_tx_limit, holding_cap, allowlist, denylist, review_threshold)
       │         │
       │         ├── [Reject] ──────────► Return 400 + Log Decision
       │         ├── [Pending] ─────────► Return 200 + Log Decision
       │         └── [Action Required] ─► Return 200 + Log Decision
       │
       ├──► 9. Enforce Fee Cap (Bound fee-per-op before composition for both naked and shaped transactions)
       │
       ├──► 10. Compose SEP-8 Sandwich (Prefix authorize ops, middle payments, suffix deauthorize ops)
       │
       ├──► 11. Safe-to-Sign Guard (Strict 3-phase partition: auth ops -> regulated payments -> deauth ops)
       │
       ├──► 12. Issuer Signing (Revise: issuer-only signature; Success: append issuer signature)
       │
       ├──► 13. Write Decision Log (Must succeed; failure aborts pipeline without reserving quota)
       │
       └──► 14. Write Quota Reservations (StateStore reservations on success/revised)
       │
       ▼
 [HTTP 200/400/500 Response]
```
