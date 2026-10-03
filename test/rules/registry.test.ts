import { describe, expect, it } from "vitest";
import type { PortcullisConfig, RuleConfig } from "../../src/config/schema.js";
import { PortcullisError } from "../../src/errors.js";
import { AllowlistRule } from "../../src/rules/allowlist.js";
import { DenylistRule } from "../../src/rules/denylist.js";
import { HoldingCapRule } from "../../src/rules/holding-cap.js";
import { LockupRule } from "../../src/rules/lockup.js";
import { PerTxLimitRule } from "../../src/rules/per-tx-limit.js";
import { buildRule, buildRules } from "../../src/rules/registry.js";
import { ReviewThresholdRule } from "../../src/rules/review-threshold.js";

describe("Rule Registry", () => {
  const allowlistPath = "fixtures/rules/allowlist/test_allowlist.csv";
  const denylistPath = "fixtures/rules/denylist/test_denylist.csv";
  const reviewHashesPath = "fixtures/rules/review_threshold/test_approved_hashes.txt";

  const baseConfig: PortcullisConfig = {
    network: "testnet",
    asset: {
      code: "GOAT",
      issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
    },
    approval: {
      maxTimeWindowSeconds: 300,
      maxFeePerOperationStroops: "10000",
      maxOperations: 10,
    },
    horizon: {
      url: "https://horizon-testnet.stellar.org",
      timeoutMs: 3000,
      cacheTtlSeconds: 5,
    },
    signer: {
      type: "local",
      secretEnv: "ISSUER_SECRET",
    },
    server: {
      port: 8080,
      publicBaseUrl: "https://example.org",
    },
    log: {
      path: "./decisions.jsonl",
      includeXdr: false,
    },
    rules: [
      { id: "per_tx_limit", max: "1000.0000000" },
      { id: "holding_cap", max: "50000.0000000" },
      { id: "allowlist", path: allowlistPath },
      { id: "denylist", path: denylistPath },
      {
        id: "lockup",
        until: "2027-01-01T00:00:00Z",
        applyTo: ["source"],
        exempt: [],
      },
      {
        id: "review_threshold",
        above: "5000.0000000",
        timeoutMs: 60000,
        message: "Manual review required",
        approvedTxHashesPath: reviewHashesPath,
      },
    ],
  };

  it("builds all rules in config order", () => {
    const rules = buildRules(baseConfig);
    expect(rules).toHaveLength(6);

    expect(rules[0]).toBeInstanceOf(PerTxLimitRule);
    expect(rules[0]?.id).toBe("per_tx_limit");

    expect(rules[1]).toBeInstanceOf(HoldingCapRule);
    expect(rules[1]?.id).toBe("holding_cap");

    expect(rules[2]).toBeInstanceOf(AllowlistRule);
    expect(rules[2]?.id).toBe("allowlist");

    expect(rules[3]).toBeInstanceOf(DenylistRule);
    expect(rules[3]?.id).toBe("denylist");

    expect(rules[4]).toBeInstanceOf(LockupRule);
    expect(rules[4]?.id).toBe("lockup");

    expect(rules[5]).toBeInstanceOf(ReviewThresholdRule);
    expect(rules[5]?.id).toBe("review_threshold");
  });

  it("buildRule handles each rule type correctly", () => {
    const perTx = buildRule({ id: "per_tx_limit", max: "10.0000000" });
    expect(perTx).toBeInstanceOf(PerTxLimitRule);

    const holdingCap = buildRule({ id: "holding_cap", max: "100.0000000" });
    expect(holdingCap).toBeInstanceOf(HoldingCapRule);

    const allowlist = buildRule({ id: "allowlist", path: allowlistPath });
    expect(allowlist).toBeInstanceOf(AllowlistRule);

    const denylist = buildRule({ id: "denylist", path: denylistPath });
    expect(denylist).toBeInstanceOf(DenylistRule);

    const lockup = buildRule({
      id: "lockup",
      until: "2027-01-01T00:00:00Z",
      applyTo: ["source"],
      exempt: [],
    });
    expect(lockup).toBeInstanceOf(LockupRule);

    const reviewThreshold = buildRule({
      id: "review_threshold",
      above: "10.0000000",
      timeoutMs: 1000,
      message: "Review",
      approvedTxHashesPath: reviewHashesPath,
    });
    expect(reviewThreshold).toBeInstanceOf(ReviewThresholdRule);
  });

  it("throws PortcullisError on unknown rule id", () => {
    const invalidConfig = { id: "unknown_rule" } as unknown as RuleConfig;
    expect(() => buildRule(invalidConfig)).toThrow(PortcullisError);
  });
});
