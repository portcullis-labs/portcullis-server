import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HoldingCapRuleConfig } from "../../src/config/schema.js";
import { HoldingCapRule } from "../../src/rules/holding-cap.js";
import type { RuleContext } from "../../src/rules/types.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { parseAmountToStroops } from "../../src/stellar/amount.js";

interface GoldenFixture {
  name: string;
  ruleConfig: HoldingCapRuleConfig;
  context: {
    txHash: string;
    nowMs: number;
    payments: Array<{
      from: string;
      to: string;
      asset: { code: string; issuer: string };
      amount: string;
    }>;
    reservations?: Array<{
      txHash: string;
      account: string;
      direction: "in" | "out";
      amount: string;
      expiresAtMs: number;
    }>;
    accounts?: Record<string, { balance: string; hasTrustline: boolean; authorized: boolean }>;
  };
  expected: {
    outcome: "pass" | "reject" | "pending" | "action_required";
    code?: string;
  };
}

describe("holding_cap golden fixtures", () => {
  const fixturesDir = join(process.cwd(), "fixtures/rules/holding_cap");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  it("should have at least 4 golden fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), "utf-8");
    const fixture = JSON.parse(raw) as GoldenFixture;

    it(`fixture: ${fixture.name} (${file})`, async () => {
      const rule = new HoldingCapRule(fixture.ruleConfig);
      const store = new MemoryStateStore();

      if (fixture.context.reservations) {
        for (const res of fixture.context.reservations) {
          await store.reserve({
            txHash: res.txHash,
            account: res.account,
            asset: {
              code: "GOAT",
              issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
            },
            direction: res.direction,
            amount: parseAmountToStroops(res.amount),
            expiresAtMs: res.expiresAtMs,
          });
        }
      }

      const accountsMap = new Map();
      if (fixture.context.accounts) {
        for (const [accId, state] of Object.entries(fixture.context.accounts)) {
          accountsMap.set(accId, {
            id: accId,
            balance: parseAmountToStroops(state.balance),
            hasTrustline: state.hasTrustline,
            authorized: state.authorized,
          });
        }
      }

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
        accounts: accountsMap,
      };

      const result = await rule.evaluate(context);
      expect(result.outcome).toBe(fixture.expected.outcome);
      if (fixture.expected.outcome === "reject" && fixture.expected.code) {
        expect(result).toHaveProperty("code", fixture.expected.code);
      }
    });
  }
});
