import type { PerTxLimitRuleConfig } from "../config/schema.js";
import { formatStroops, parseAmountToStroops } from "../stellar/amount.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

export class PerTxLimitRule implements Rule {
  readonly id = "per_tx_limit";
  private readonly maxStroops: bigint;

  constructor(readonly config: PerTxLimitRuleConfig) {
    this.maxStroops = parseAmountToStroops(config.max);
  }

  evaluate(ctx: RuleContext): RuleResult {
    for (const payment of ctx.payments) {
      if (payment.amount > this.maxStroops) {
        return {
          outcome: "reject",
          code: "PER_TX_LIMIT",
          message: `Payment amount ${formatStroops(payment.amount)} exceeds limit of ${formatStroops(this.maxStroops)}`,
        };
      }
    }

    return { outcome: "pass" };
  }
}
