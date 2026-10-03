import type { AccountState, Payment } from "../domain/types.js";
import type { StateStore } from "../state/types.js";

export type RuleResult =
  | { outcome: "pass" }
  | { outcome: "reject"; code: string; message: string }
  | { outcome: "pending"; timeoutMs: number; message?: string }
  | {
      outcome: "action_required";
      message: string;
      actionUrl: string;
      actionMethod?: "GET" | "POST";
      actionFields?: string[];
    };

export interface RuleContext {
  txHash: string; // lowercase hex
  payments: Payment[];
  accounts: Map<string, AccountState>; // every account named in payments
  nowMs: number;
  store: StateStore;
}

export interface Rule {
  id: string;
  evaluate(ctx: RuleContext): Promise<RuleResult> | RuleResult;
}

export interface IndividualRuleResult {
  ruleId: string;
  result: RuleResult;
}

export interface AggregatedDecision {
  outcome: RuleResult["outcome"];
  winningResult: RuleResult;
  winningRuleId: string;
  results: IndividualRuleResult[];
}
