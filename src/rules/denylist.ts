import type { Stats } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";
import type { DenylistRuleConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

export class DenylistRule implements Rule {
  readonly id = "denylist";
  private lastMtimeMs: number | null = null;
  private cachedAddresses: Set<string> = new Set();

  constructor(readonly config: DenylistRuleConfig) {}

  private getDenylistedAddresses(): Set<string> {
    let stat: Stats;
    try {
      stat = statSync(this.config.path);
    } catch (err) {
      throw new PortcullisError(
        "INVALID_CONFIG",
        `Failed to read denylist file at ${this.config.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (this.lastMtimeMs === stat.mtimeMs) {
      return this.cachedAddresses;
    }

    const content = readFileSync(this.config.path, "utf-8");
    const lines = content.split(/\r?\n/);
    const addresses = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (rawLine === undefined) continue;
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      if (!StrKey.isValidEd25519PublicKey(line)) {
        throw new PortcullisError(
          "INVALID_CONFIG",
          `Invalid Stellar address in denylist file at line ${i + 1}: "${line}"`,
        );
      }
      addresses.add(line);
    }

    this.lastMtimeMs = stat.mtimeMs;
    this.cachedAddresses = addresses;
    return this.cachedAddresses;
  }

  evaluate(ctx: RuleContext): RuleResult {
    const denylisted = this.getDenylistedAddresses();

    for (const payment of ctx.payments) {
      const accountsToCheck = [payment.from, payment.to];
      for (const account of accountsToCheck) {
        if (denylisted.has(account)) {
          return {
            outcome: "reject",
            code: "DENYLISTED",
            message: `Account ${account} is denylisted`,
          };
        }
      }
    }

    return { outcome: "pass" };
  }
}
