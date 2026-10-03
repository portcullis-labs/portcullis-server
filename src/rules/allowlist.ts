import type { Stats } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";
import type { AllowlistRuleConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

export class AllowlistRule implements Rule {
  readonly id = "allowlist";
  private lastMtimeMs: number | null = null;
  private cachedAddresses: Set<string> = new Set();

  constructor(readonly config: AllowlistRuleConfig) {}

  private getAllowlistedAddresses(): Set<string> {
    let stat: Stats;
    try {
      stat = statSync(this.config.path);
    } catch (err) {
      throw new PortcullisError(
        "INVALID_CONFIG",
        `Failed to read allowlist file at ${this.config.path}: ${err instanceof Error ? err.message : String(err)}`,
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
          `Invalid Stellar address in allowlist file at line ${i + 1}: "${line}"`,
        );
      }
      addresses.add(line);
    }

    this.lastMtimeMs = stat.mtimeMs;
    this.cachedAddresses = addresses;
    return this.cachedAddresses;
  }

  evaluate(ctx: RuleContext): RuleResult {
    const allowlisted = this.getAllowlistedAddresses();

    for (const payment of ctx.payments) {
      const accountsToCheck = [payment.from, payment.to];
      for (const account of accountsToCheck) {
        if (!allowlisted.has(account)) {
          if (this.config.onMiss) {
            return {
              outcome: "action_required",
              message: this.config.onMiss.message,
              actionUrl: this.config.onMiss.url,
              actionMethod: this.config.onMiss.method ?? "GET",
            };
          }
          return {
            outcome: "reject",
            code: "NOT_ALLOWLISTED",
            message: `Account ${account} is not allowlisted`,
          };
        }
      }
    }

    return { outcome: "pass" };
  }
}
