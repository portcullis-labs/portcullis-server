import type { Stats } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import type { ReviewThresholdRuleConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import { parseAmountToStroops } from "../stellar/amount.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

const TX_HASH_REGEX = /^[0-9a-fA-F]{64}$/;

export class ReviewThresholdRule implements Rule {
  readonly id = "review_threshold";
  private readonly aboveStroops: bigint;
  private lastMtimeMs: number | null = null;
  private lastSize: number | null = null;
  private cachedHashes: Set<string> = new Set();

  constructor(readonly config: ReviewThresholdRuleConfig) {
    this.aboveStroops = parseAmountToStroops(config.above);
    this.cachedHashes = this.readAndParse(true);
  }

  private readAndParse(isInitial: boolean): Set<string> {
    let stat: Stats;
    try {
      stat = statSync(this.config.approvedTxHashesPath);
    } catch (err) {
      if (isInitial) {
        throw new PortcullisError(
          "INVALID_CONFIG",
          `Failed to read approved tx hashes file at ${this.config.approvedTxHashesPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }

    if (!isInitial && this.lastMtimeMs === stat.mtimeMs && this.lastSize === stat.size) {
      return this.cachedHashes;
    }

    let content: string;
    try {
      content = readFileSync(this.config.approvedTxHashesPath, "utf-8");
    } catch (err) {
      if (isInitial) {
        throw new PortcullisError(
          "INVALID_CONFIG",
          `Failed to read approved tx hashes file at ${this.config.approvedTxHashesPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }

    const lines = content.split(/\r?\n/);
    const hashes = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (rawLine === undefined) continue;
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      if (!TX_HASH_REGEX.test(line)) {
        if (isInitial) {
          throw new PortcullisError(
            "INVALID_CONFIG",
            `Invalid transaction hash in approved hashes file at line ${i + 1}: "${line}" (must be 64-character hex)`,
          );
        }
        throw new Error(
          `Invalid transaction hash in approved hashes file at line ${i + 1}: "${line}" (must be 64-character hex)`,
        );
      }
      hashes.add(line.toLowerCase());
    }

    this.lastMtimeMs = stat.mtimeMs;
    this.lastSize = stat.size;
    this.cachedHashes = hashes;
    return hashes;
  }

  private getApprovedHashes(): Set<string> | null {
    try {
      return this.readAndParse(false);
    } catch {
      // Invalidate cache on refresh error
      this.lastMtimeMs = null;
      this.lastSize = null;
      this.cachedHashes = new Set();
      return null;
    }
  }

  evaluate(ctx: RuleContext): RuleResult {
    const exceedsThreshold = ctx.payments.some((payment) => payment.amount > this.aboveStroops);

    if (!exceedsThreshold) {
      return { outcome: "pass" };
    }

    const approvedHashes = this.getApprovedHashes();
    if (!approvedHashes) {
      return {
        outcome: "reject",
        code: "LIST_UNAVAILABLE",
        message: `Approved transaction hashes file at ${this.config.approvedTxHashesPath} is unavailable or invalid`,
      };
    }

    if (approvedHashes.has(ctx.txHash.toLowerCase())) {
      return { outcome: "pass" };
    }

    return {
      outcome: "pending",
      timeoutMs: this.config.timeoutMs,
      message: this.config.message,
    };
  }
}
