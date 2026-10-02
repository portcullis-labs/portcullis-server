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

> **Note:** The directory structure above is planned for upcoming feature iterations. Source module directories will be created as their corresponding implementations are introduced.
