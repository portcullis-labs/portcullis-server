import type {
  AggregatedDecision,
  IndividualRuleResult,
  Rule,
  RuleContext,
  RuleResult,
} from "./types.js";

const OUTCOME_PRECEDENCE: Record<RuleResult["outcome"], number> = {
  reject: 4,
  action_required: 3,
  pending: 2,
  pass: 1,
};

/**
 * Evaluates all provided rules against the context, records every outcome,
 * and aggregates to a final decision based on precedence:
 * reject > action_required > pending > pass.
 * Ties are broken by the order of rules in the config.
 */
export async function evaluateAndAggregate(
  rules: Rule[],
  ctx: RuleContext,
): Promise<AggregatedDecision> {
  const results: IndividualRuleResult[] = [];

  for (const rule of rules) {
    const res = await rule.evaluate(ctx);
    results.push({
      ruleId: rule.id,
      result: res,
    });
  }

  if (results.length === 0) {
    const defaultPass: RuleResult = { outcome: "pass" };
    return {
      outcome: "pass",
      winningResult: defaultPass,
      winningRuleId: "",
      results: [],
    };
  }

  let winningEntry: IndividualRuleResult = results[0] as IndividualRuleResult;
  let highestPrecedence = OUTCOME_PRECEDENCE[winningEntry.result.outcome];

  for (let i = 1; i < results.length; i++) {
    const entry = results[i] as IndividualRuleResult;
    const prec = OUTCOME_PRECEDENCE[entry.result.outcome];
    if (prec > highestPrecedence) {
      highestPrecedence = prec;
      winningEntry = entry;
    }
  }

  return {
    outcome: winningEntry.result.outcome,
    winningResult: winningEntry.result,
    winningRuleId: winningEntry.ruleId,
    results,
  };
}
