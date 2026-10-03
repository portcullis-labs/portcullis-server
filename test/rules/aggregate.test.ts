import { describe, expect, it } from "vitest";
import { evaluateAndAggregate } from "../../src/rules/aggregate.js";
import type { Rule, RuleContext, RuleResult } from "../../src/rules/types.js";
import type { StateStore } from "../../src/state/types.js";

const dummyStore: StateStore = {
  reserve: async () => {},
  sumReserved: async () => 0n,
  release: async () => {},
  purgeExpired: async () => 0,
};

const dummyContext: RuleContext = {
  txHash: "deadbeef",
  payments: [],
  accounts: new Map(),
  nowMs: 1000,
  store: dummyStore,
};

function createMockRule(id: string, result: RuleResult): Rule {
  return {
    id,
    evaluate: () => result,
  };
}

describe("rule aggregation", () => {
  it("should return pass when no rules are configured", async () => {
    const decision = await evaluateAndAggregate([], dummyContext);
    expect(decision.outcome).toBe("pass");
    expect(decision.winningResult).toEqual({ outcome: "pass" });
    expect(decision.results).toEqual([]);
  });

  it("should record all individual rule results", async () => {
    const r1 = createMockRule("r1", { outcome: "pass" });
    const r2 = createMockRule("r2", { outcome: "pending", timeoutMs: 5000 });
    const r3 = createMockRule("r3", { outcome: "reject", code: "RULE_FAILED", message: "Denied" });

    const decision = await evaluateAndAggregate([r1, r2, r3], dummyContext);
    expect(decision.results).toHaveLength(3);
    expect(decision.results[0]?.ruleId).toBe("r1");
    expect(decision.results[1]?.ruleId).toBe("r2");
    expect(decision.results[2]?.ruleId).toBe("r3");
  });

  it("should prioritize reject over all other outcomes", async () => {
    const rPass = createMockRule("passRule", { outcome: "pass" });
    const rPending = createMockRule("pendingRule", { outcome: "pending", timeoutMs: 3000 });
    const rAction = createMockRule("actionRule", {
      outcome: "action_required",
      message: "Verify KYC",
      actionUrl: "https://example.org",
    });
    const rReject = createMockRule("rejectRule", {
      outcome: "reject",
      code: "HOLDING_CAP",
      message: "Exceeded limit",
    });

    const decision = await evaluateAndAggregate([rPass, rPending, rAction, rReject], dummyContext);
    expect(decision.outcome).toBe("reject");
    expect(decision.winningRuleId).toBe("rejectRule");
    expect(decision.winningResult).toEqual({
      outcome: "reject",
      code: "HOLDING_CAP",
      message: "Exceeded limit",
    });
  });

  it("should prioritize action_required over pending and pass", async () => {
    const rPass = createMockRule("passRule", { outcome: "pass" });
    const rPending = createMockRule("pendingRule", { outcome: "pending", timeoutMs: 3000 });
    const rAction = createMockRule("actionRule", {
      outcome: "action_required",
      message: "Verify KYC",
      actionUrl: "https://example.org",
    });

    const decision = await evaluateAndAggregate([rPass, rPending, rAction], dummyContext);
    expect(decision.outcome).toBe("action_required");
    expect(decision.winningRuleId).toBe("actionRule");
  });

  it("should prioritize pending over pass", async () => {
    const rPass = createMockRule("passRule", { outcome: "pass" });
    const rPending = createMockRule("pendingRule", { outcome: "pending", timeoutMs: 3000 });

    const decision = await evaluateAndAggregate([rPass, rPending], dummyContext);
    expect(decision.outcome).toBe("pending");
    expect(decision.winningRuleId).toBe("pendingRule");
  });

  it("should break ties by config order (first matching highest precedence wins)", async () => {
    const rReject1 = createMockRule("reject1", {
      outcome: "reject",
      code: "PER_TX_LIMIT",
      message: "First reject",
    });
    const rReject2 = createMockRule("reject2", {
      outcome: "reject",
      code: "DENYLISTED",
      message: "Second reject",
    });

    const decision = await evaluateAndAggregate([rReject1, rReject2], dummyContext);
    expect(decision.outcome).toBe("reject");
    expect(decision.winningRuleId).toBe("reject1");
    expect(decision.winningResult).toEqual({
      outcome: "reject",
      code: "PER_TX_LIMIT",
      message: "First reject",
    });
  });
});
