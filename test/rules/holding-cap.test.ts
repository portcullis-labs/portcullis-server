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

describe("holding_cap self-reservation exclusion", () => {
  const dest = "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX";
  const src = "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW";
  const asset = { code: "GOAT", issuer: src };

  it("retry of same tx at exactly the cap passes; different tx at the cap is rejected", async () => {
    const rule = new HoldingCapRule({ id: "holding_cap", max: "1000.0000000" });
    const store = new MemoryStateStore();

    // Account has balance of 500
    const accounts = new Map([
      [dest, { id: dest, balance: 500_0000000n, hasTrustline: true, authorized: true }],
    ]);

    // Suppose tx1 reserved an inflow of 500 earlier (bringing total to 1000, exactly at cap)
    await store.reserve({
      txHash: "tx1",
      account: dest,
      asset,
      amount: 500_0000000n,
      direction: "in",
      expiresAtMs: 10000,
    });

    // Retrying tx1 with 500 payment: should exclude tx1's reservation and evaluate 500 balance + 500 payment = 1000 (passes)
    const retryContext: RuleContext = {
      txHash: "tx1",
      nowMs: 1000,
      store,
      payments: [{ from: src, to: dest, asset, amount: 500_0000000n }],
      accounts,
    };
    const retryResult = await rule.evaluate(retryContext);
    expect(retryResult.outcome).toBe("pass");

    // A different transaction tx2 with 500 payment: tx1's reservation IS counted, so 500 balance + 500 reserved + 500 payment = 1500 > 1000 (rejected)
    const newTxContext: RuleContext = {
      txHash: "tx2",
      nowMs: 1000,
      store,
      payments: [{ from: src, to: dest, asset, amount: 500_0000000n }],
      accounts,
    };
    const newTxResult = await rule.evaluate(newTxContext);
    expect(newTxResult.outcome).toBe("reject");
    if (newTxResult.outcome === "reject") {
      expect(newTxResult.code).toBe("HOLDING_CAP");
    }
  });
});
