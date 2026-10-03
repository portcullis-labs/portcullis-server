import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PerTxLimitRuleConfig } from "../../src/config/schema.js";
import { PerTxLimitRule } from "../../src/rules/per-tx-limit.js";
import type { RuleContext } from "../../src/rules/types.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { parseAmountToStroops } from "../../src/stellar/amount.js";

interface GoldenFixture {
  name: string;
  ruleConfig: PerTxLimitRuleConfig;
  context: {
    txHash: string;
    nowMs: number;
    payments: Array<{
      from: string;
      to: string;
      asset: { code: string; issuer: string };
      amount: string;
    }>;
    accounts?: Record<string, { balance: string; hasTrustline: boolean; authorized: boolean }>;
  };
  expected: {
    outcome: "pass" | "reject" | "pending" | "action_required";
    code?: string;
  };
}

describe("per_tx_limit golden fixtures", () => {
  const fixturesDir = join(process.cwd(), "fixtures/rules/per_tx_limit");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  it("should have at least 4 golden fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), "utf-8");
    const fixture = JSON.parse(raw) as GoldenFixture;

    it(`fixture: ${fixture.name} (${file})`, () => {
      const rule = new PerTxLimitRule(fixture.ruleConfig);
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
      if (fixture.expected.outcome === "reject" && fixture.expected.code) {
        expect(result).toHaveProperty("code", fixture.expected.code);
      }
    });
  }
});
