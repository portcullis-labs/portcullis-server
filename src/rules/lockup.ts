import type { LockupRuleConfig } from "../config/schema.js";
import type { Rule, RuleContext, RuleResult } from "./types.js";

export class LockupRule implements Rule {
  readonly id = "lockup";
  private readonly untilMs: number;
  private readonly applyTo: Array<"source" | "destination">;
  private readonly exemptSet: Set<string>;

  constructor(readonly config: LockupRuleConfig) {
    this.untilMs = Date.parse(config.until);
    this.applyTo = config.applyTo ?? ["source"];
    this.exemptSet = new Set(config.exempt ?? []);
  }

  evaluate(ctx: RuleContext): RuleResult {
    if (ctx.nowMs >= this.untilMs) {
      return { outcome: "pass" };
    }

    const checkSource = this.applyTo.includes("source");
    const checkDestination = this.applyTo.includes("destination");

    for (const payment of ctx.payments) {
      if (checkSource && !this.exemptSet.has(payment.from)) {
        return {
          outcome: "reject",
          code: "LOCKED_UP",
          message: `Account ${payment.from} is locked up until ${this.config.until}`,
        };
      }

      if (checkDestination && !this.exemptSet.has(payment.to)) {
        return {
          outcome: "reject",
          code: "LOCKED_UP",
          message: `Account ${payment.to} is locked up until ${this.config.until}`,
        };
      }
    }

    return { outcome: "pass" };
  }
}
