import type { Stats } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";
import type { AllowlistRuleConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

export class AllowlistRule implements Rule {
  readonly id = "allowlist";
  private lastMtimeMs: number | null = null;
  private lastSize: number | null = null;
  private cachedAddresses: Set<string> = new Set();

  constructor(readonly config: AllowlistRuleConfig) {
    this.cachedAddresses = this.readAndParse(true);
  }

  private readAndParse(isInitial: boolean): Set<string> {
    let stat: Stats;
    try {
      stat = statSync(this.config.path);
    } catch (err) {
      if (isInitial) {
        throw new PortcullisError(
          "INVALID_CONFIG",
          `Failed to read allowlist file at ${this.config.path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }

    if (!isInitial && this.lastMtimeMs === stat.mtimeMs && this.lastSize === stat.size) {
      return this.cachedAddresses;
    }

    let content: string;
    try {
      content = readFileSync(this.config.path, "utf-8");
    } catch (err) {
      if (isInitial) {
        throw new PortcullisError(
          "INVALID_CONFIG",
          `Failed to read allowlist file at ${this.config.path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }

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
        if (isInitial) {
          throw new PortcullisError(
            "INVALID_CONFIG",
            `Invalid Stellar address in allowlist file at line ${i + 1}: "${line}"`,
          );
        }
        throw new Error(`Invalid Stellar address in allowlist file at line ${i + 1}: "${line}"`);
      }
      addresses.add(line);
    }

    this.lastMtimeMs = stat.mtimeMs;
    this.lastSize = stat.size;
    this.cachedAddresses = addresses;
    return addresses;
  }

  private getAllowlistedAddresses(): Set<string> | null {
    try {
      return this.readAndParse(false);
    } catch {
      // Invalidate cache on refresh error so stale data is never used
      this.lastMtimeMs = null;
      this.lastSize = null;
      this.cachedAddresses = new Set();
      return null;
    }
  }

  evaluate(ctx: RuleContext): RuleResult {
    const allowlisted = this.getAllowlistedAddresses();
    if (!allowlisted) {
      return {
        outcome: "reject",
        code: "LIST_UNAVAILABLE",
        message: `Allowlist file at ${this.config.path} is unavailable or invalid`,
      };
    }

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
