import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewThresholdRuleConfig } from "../../src/config/schema.js";
import { PortcullisError } from "../../src/errors.js";
import { ReviewThresholdRule } from "../../src/rules/review-threshold.js";
import type { RuleContext } from "../../src/rules/types.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { parseAmountToStroops } from "../../src/stellar/amount.js";

interface GoldenFixture {
  name: string;
  ruleConfig: ReviewThresholdRuleConfig;
  context: {
    txHash: string;
    nowMs: number;
    payments: Array<{
      from: string;
      to: string;
      asset: { code: string; issuer: string };
      amount: string;
    }>;
  };
  expected: {
    outcome: "pass" | "reject" | "pending" | "action_required";
    timeoutMs?: number;
    message?: string;
  };
}

describe("review_threshold golden fixtures", () => {
  const fixturesDir = join(process.cwd(), "fixtures/rules/review_threshold");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  it("should have at least 4 golden fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), "utf-8");
    const fixture = JSON.parse(raw) as GoldenFixture;

    it(`fixture: ${fixture.name} (${file})`, () => {
      const rule = new ReviewThresholdRule(fixture.ruleConfig);
      const store = new MemoryStateStore();

      const context: RuleContext = {
        txHash: fixture.context.txHash,
        nowMs: fixture.context.nowMs,
        store,
        payments: fixture.context.payments.map((p) => ({
          from: p.from,
          to: p.to,
          asset: p.asset,
          amount: parseAmountToStroops(p.amount),
        })),
        accounts: new Map(),
      };

      const result = rule.evaluate(context);
      expect(result.outcome).toBe(fixture.expected.outcome);

      if (fixture.expected.outcome === "pending") {
        expect(result).toHaveProperty("timeoutMs", fixture.expected.timeoutMs);
        if (fixture.expected.message) {
          expect(result).toHaveProperty("message", fixture.expected.message);
        }
      }
    });
  }
});

describe("review_threshold unit tests", () => {
  const testDir = join(process.cwd(), "fixtures/rules/review_threshold");

  it("throws PortcullisError when approved hashes file does not exist", () => {
    const rule = new ReviewThresholdRule({
      id: "review_threshold",
      above: "100.0000000",
      timeoutMs: 60000,
      message: "Needs review",
      approvedTxHashesPath: "fixtures/rules/review_threshold/non_existent.txt",
    });

    const context: RuleContext = {
      txHash: "tx1",
      nowMs: Date.now(),
      store: new MemoryStateStore(),
      payments: [
        {
          from: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
          to: "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX",
          asset: {
            code: "GOAT",
            issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
          },
          amount: 5000000000n,
        },
      ],
      accounts: new Map(),
    };

    expect(() => rule.evaluate(context)).toThrow(PortcullisError);
  });

  it("re-reads approved hashes file on each evaluation", () => {
    const dynamicHashesPath = join(testDir, "dynamic_approved.txt");
    const targetTxHash = "feedbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678";

    try {
      writeFileSync(dynamicHashesPath, "# empty initially\n");
      const rule = new ReviewThresholdRule({
        id: "review_threshold",
        above: "100.0000000",
        timeoutMs: 60000,
        message: "Manual review required",
        approvedTxHashesPath: dynamicHashesPath,
      });

      const context: RuleContext = {
        txHash: targetTxHash,
        nowMs: Date.now(),
        store: new MemoryStateStore(),
        payments: [
          {
            from: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
            to: "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX",
            asset: {
              code: "GOAT",
              issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
            },
            amount: 5000000000n,
          },
        ],
        accounts: new Map(),
      };

      // Initially not approved -> pending
      expect(rule.evaluate(context).outcome).toBe("pending");

      // Append txHash to approved hashes file
      writeFileSync(dynamicHashesPath, `${targetTxHash}\n`);

      // Immediately re-evaluated -> pass
      expect(rule.evaluate(context).outcome).toBe("pass");
    } finally {
      try {
        unlinkSync(dynamicHashesPath);
      } catch {
        // ignore
      }
    }
  });
});
