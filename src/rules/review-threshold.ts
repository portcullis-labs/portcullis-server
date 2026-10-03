import { readFileSync } from "node:fs";
import type { ReviewThresholdRuleConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import { parseAmountToStroops } from "../stellar/amount.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

export class ReviewThresholdRule implements Rule {
  readonly id = "review_threshold";
  private readonly aboveStroops: bigint;

  constructor(readonly config: ReviewThresholdRuleConfig) {
    this.aboveStroops = parseAmountToStroops(config.above);
  }

  private getApprovedHashes(): Set<string> {
    let content: string;
    try {
      content = readFileSync(this.config.approvedTxHashesPath, "utf-8");
    } catch (err) {
      throw new PortcullisError(
        "INVALID_CONFIG",
        `Failed to read approved tx hashes file at ${this.config.approvedTxHashesPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const lines = content.split(/\r?\n/);
    const hashes = new Set<string>();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      hashes.add(line.toLowerCase());
    }

    return hashes;
  }

  evaluate(ctx: RuleContext): RuleResult {
    const exceedsThreshold = ctx.payments.some((payment) => payment.amount > this.aboveStroops);

    if (!exceedsThreshold) {
      return { outcome: "pass" };
    }

    const approvedHashes = this.getApprovedHashes();
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
