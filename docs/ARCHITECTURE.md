# Portcullis Server Architecture

This document describes the planned architectural layout and system design for `portcullis-server`.

## Planned Project Structure

```
portcullis-server/
├── src/
│   ├── cli/            # CLI commands and entry points (e.g. dry-run check)
│   ├── config/         # YAML rule configuration parser and schema validation
│   ├── stellar/        # Stellar SDK helpers, Horizon queries, and XDR manipulation
│   ├── pipeline/       # SEP-8 transaction processing and verification pipeline
│   ├── rules/          # Rule engine and built-in SEP-8 compliance rule evaluators
│   ├── signer/         # Cryptographic key management and transaction signing guards
│   ├── state/          # State management, quota reservations, and rate tracking
│   ├── log/            # Structured, explainable decision audit logging
│   └── server/         # Hono HTTP server, SEP-8 endpoints, and stellar.toml handler
├── fixtures/           # Golden test fixtures and adversarial transaction XDR cases
├── scripts/            # Development, verification, and deployment scripts
├── test/               # Unit, property, and offline integration test suites
└── docs/
    ├── ARCHITECTURE.md # System architecture and directory map
    ├── DECISIONS.md    # Architectural decision records and standard checks
    ├── DEPENDENCIES.md # Dependency inventory and exact version ledger
    ├── QUALITY_BAR.md  # Engineering quality standards and invariants
    └── THREAT_MODEL.md # Security threat model and boundary definitions
```

## System Architecture & Pipeline Flow

The core approval engine processes incoming SEP-8 POST `/tx_approve` requests through a strict, sequential pipeline:

```
[Incoming Request] (tx: base64 XDR)
       │
       ▼
 1. Decode Envelope (TransactionBuilder.fromXdr)
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
       ├──► 6. Load Account State (Horizon fetch with cache and fail-closed timeout)
       │
       ├──► 7. Evaluate & Aggregate Rules (per_tx_limit, holding_cap, allowlist, denylist, etc.)
       │         │
       │         ├── [Reject] ──────────► Return 400 + Log Decision
       │         ├── [Pending] ─────────► Return 200 + Log Decision
       │         └── [Action Required] ─► Return 200 + Log Decision
       │
       ├──► 8. Compose SEP-8 Sandwich (Prefix authorize ops, middle payments, suffix deauthorize ops)
       │
       ├──► 9. Safe-to-Sign Guard (Ensure issuer never signs unauthorized ops, options, or fee bumps)
       │
       ├──► 10. Issuer Signing (Revise: issuer-only signature; Success: append issuer signature)
       │
       ├──► 11. Write Quota Reservations (StateStore reservation on success/revised)
       │
       ▼
 12. Log Decision (JSON-lines structured audit log, fail-closed on write failure)
       │
       ▼
 [HTTP 200/400/500 Response]
```
