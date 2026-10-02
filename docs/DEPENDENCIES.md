# Dependency Versions

This document records the exact versions of all dependencies used in `portcullis-server`. Every dependency is installed with an exact version pin (no `^` or `~`), verified against npm registry using `npm view <package> version`.

## Development Tooling

| Package | Version | Date Checked | Purpose |
|---|---|---|---|
| `@biomejs/biome` | `2.5.15` | 2026-10-02 | Code formatting and linting |
| `@types/node` | `26.6.4` | 2026-10-02 | TypeScript type definitions for Node.js runtime |
| `typescript` | `7.0.2` | 2026-10-02 | TypeScript compiler and static type checking |
| `vitest` | `5.0.3` | 2026-10-02 | Unit testing framework |

## Runtime Dependencies

*Runtime libraries (`@stellar/stellar-sdk`, `hono`, `@hono/node-server`, `zod`, `yaml`) are deferred to subsequent feature specifications.*
