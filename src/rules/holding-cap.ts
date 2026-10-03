import type { HoldingCapRuleConfig } from "../config/schema.js";
import { formatStroops, parseAmountToStroops } from "../stellar/amount.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

export class HoldingCapRule implements Rule {
  readonly id = "holding_cap";
  private readonly maxStroops: bigint;

  constructor(readonly config: HoldingCapRuleConfig) {
    this.maxStroops = parseAmountToStroops(config.max);
  }

  async evaluate(ctx: RuleContext): Promise<RuleResult> {
    const txInflowsByDestination = new Map<string, bigint>();

    for (const payment of ctx.payments) {
      const current = txInflowsByDestination.get(payment.to) ?? 0n;
      txInflowsByDestination.set(payment.to, current + payment.amount);
    }

    for (const [destination, txInflow] of txInflowsByDestination.entries()) {
      const accountState = ctx.accounts.get(destination);
      const currentBalance = accountState?.balance ?? 0n;
      const reservedInflows = await ctx.store.sumReserved(destination, "in", ctx.nowMs);

      const projectedBalance = currentBalance + reservedInflows + txInflow;

      if (projectedBalance > this.maxStroops) {
        return {
          outcome: "reject",
          code: "HOLDING_CAP",
          message: `Projected balance for account ${destination} (${formatStroops(projectedBalance)}) exceeds holding cap of ${formatStroops(this.maxStroops)}`,
        };
      }
    }

    return { outcome: "pass" };
  }
}
