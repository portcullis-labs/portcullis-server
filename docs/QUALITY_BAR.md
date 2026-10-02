# Quality bar for Portcullis Server
Every item must be demonstrable in the repo, not just claimed.
1. Safety before features. Nothing signs before the guard passes. The guard has adversarial fixtures: issuer-sourced payment smuggled in, issuer as transaction source, extra SetOptions, ChangeTrust, trustline-flag operation for a different asset.
2. Fail closed. Horizon errors or timeouts never produce a signature.
3. Spec-exact SEP-8. All five statuses are produced by built-in rules. Status names and HTTP codes follow the SEP-8 text. CORS and preflight work. A stellar.toml route exists and is validated in CI with stellar-toml-lint.
4. Explainable. Every decision logs each rule's result. A `check` command dry-runs a transaction XDR against a config and prints per-rule results without signing.
5. Correct under concurrency. Approvals reserve quota until the transaction's upper timebound, because approval is not settlement. Property tests cover amount arithmetic and reservation accounting.
6. Honest limits. README, SECURITY and docs/THREAT_MODEL.md state what is unsupported, unaudited and testnet-only. Any comparison with other projects contains only facts verified from their repos.
7. Testable by strangers. Every rule has golden fixtures. `pnpm test` runs fully offline. Integration tests are opt-in.
8. No floating point near money. No secrets in logs. Exact dependency versions recorded.
9. Wave-ready. Each backlog issue has acceptance criteria stated as fixtures. Sensitive files are under CODEOWNERS.
Rule: depth beats breadth. Do not add features outside the specification to look better.
