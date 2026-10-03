# Dependency Versions

This document records the exact versions of all dependencies used in `portcullis-server`. Every dependency is installed with an exact version pin (no `^` or `~`), verified against npm registry using `npm view <package> version`.

## Development Tooling

| Package | Version | Date Checked | Purpose |
|---|---|---|---|
| `@biomejs/biome` | `2.5.15` | 2026-10-02 | Code formatting and linting |
| `@types/node` | `24.19.0` | 2026-10-03 | TypeScript type definitions for Node.js runtime (major matches Node 24 runtime in `.nvmrc`) |
| `fast-check` | `4.10.2` | 2026-10-03 | Property-based testing framework |
| `typescript` | `7.0.2` | 2026-10-02 | TypeScript compiler and static type checking |
| `vitest` | `5.0.3` | 2026-10-02 | Unit testing framework |

## Runtime Dependencies

| Package | Version | Date Checked | Purpose |
|---|---|---|---|
| `@stellar/stellar-sdk` | `17.2.1` | 2026-10-03 | Stellar SDK for key handling, Horizon, and XDR operations |
| `yaml` | `2.9.1` | 2026-10-03 | YAML parser for configuration files |
| `zod` | `4.6.5` | 2026-10-03 | Schema definition and validation for configuration and input data |
| `hono` | `4.13.12` | 2026-10-03 | Lightweight web framework for HTTP API routes and middleware |
| `@hono/node-server` | `2.1.3` | 2026-10-03 | Node.js HTTP adapter for Hono applications |

