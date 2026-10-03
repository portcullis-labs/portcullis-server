import type { PortcullisConfig, RuleConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import { AllowlistRule } from "./allowlist.js";
import { DenylistRule } from "./denylist.js";
import { HoldingCapRule } from "./holding-cap.js";
import { LockupRule } from "./lockup.js";
import { PerTxLimitRule } from "./per-tx-limit.js";
import { ReviewThresholdRule } from "./review-threshold.js";
import type { Rule } from "./types.js";

export function buildRule(ruleConfig: RuleConfig): Rule {
  switch (ruleConfig.id) {
    case "per_tx_limit":
      return new PerTxLimitRule(ruleConfig);
    case "holding_cap":
      return new HoldingCapRule(ruleConfig);
    case "allowlist":
      return new AllowlistRule(ruleConfig);
    case "denylist":
      return new DenylistRule(ruleConfig);
    case "lockup":
      return new LockupRule(ruleConfig);
    case "review_threshold":
      return new ReviewThresholdRule(ruleConfig);
    default: {
      const exhaustiveCheck: never = ruleConfig;
      throw new PortcullisError(
        "INVALID_CONFIG",
        `Unknown rule configuration: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

export function buildRules(config: PortcullisConfig): Rule[] {
  return config.rules.map((rc) => buildRule(rc));
}
