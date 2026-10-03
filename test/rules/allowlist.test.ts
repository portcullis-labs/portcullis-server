import { readdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AllowlistRuleConfig } from "../../src/config/schema.js";
import { PortcullisError } from "../../src/errors.js";
import { AllowlistRule } from "../../src/rules/allowlist.js";
import type { RuleContext } from "../../src/rules/types.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { parseAmountToStroops } from "../../src/stellar/amount.js";

interface GoldenFixture {
  name: string;
  ruleConfig: AllowlistRuleConfig;
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
    code?: string;
    actionUrl?: string;
    actionMethod?: "GET" | "POST";
    message?: string;
  };
}

describe("allowlist golden fixtures", () => {
  const fixturesDir = join(process.cwd(), "fixtures/rules/allowlist");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  it("should have at least 4 golden fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), "utf-8");
    const fixture = JSON.parse(raw) as GoldenFixture;

    it(`fixture: ${fixture.name} (${file})`, () => {
      const rule = new AllowlistRule(fixture.ruleConfig);
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
      if (fixture.expected.outcome === "action_required") {
        expect(result).toHaveProperty("actionUrl", fixture.expected.actionUrl);
        expect(result).toHaveProperty("actionMethod", fixture.expected.actionMethod);
        expect(result).toHaveProperty("message", fixture.expected.message);
      }
    });
  }
});

describe("allowlist unit tests", () => {
  const testDir = join(process.cwd(), "fixtures/rules/allowlist");

  it("throws PortcullisError on non-existent file at construction", () => {
    expect(
      () =>
        new AllowlistRule({
          id: "allowlist",
          path: "fixtures/rules/allowlist/non_existent.csv",
        }),
    ).toThrow(PortcullisError);
  });

  it("throws PortcullisError when CSV contains invalid Stellar address at construction", () => {
    const badCsvPath = join(testDir, "bad_address.csv");
    writeFileSync(badCsvPath, "NOT_A_VALID_STELLAR_ADDRESS\n");
    try {
      expect(
        () =>
          new AllowlistRule({
            id: "allowlist",
            path: badCsvPath,
          }),
      ).toThrow(PortcullisError);
    } finally {
      try {
        unlinkSync(badCsvPath);
      } catch {
        // ignore
      }
    }
  });

  it("fails closed with LIST_UNAVAILABLE when file is deleted after load", () => {
    const tempCsvPath = join(testDir, "temp_deleted.csv");
    const addr1 = "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW";
    const addr2 = "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX";

    writeFileSync(tempCsvPath, `${addr1}\n${addr2}\n`);
    const rule = new AllowlistRule({
      id: "allowlist",
      path: tempCsvPath,
    });

    const context: RuleContext = {
      txHash: "tx1",
      nowMs: Date.now(),
      store: new MemoryStateStore(),
      payments: [
        {
          from: addr1,
          to: addr2,
          asset: { code: "GOAT", issuer: addr1 },
          amount: 100n,
        },
      ],
      accounts: new Map(),
    };

    expect(rule.evaluate(context).outcome).toBe("pass");

    // Delete the file and evaluate again: fails closed with LIST_UNAVAILABLE
    unlinkSync(tempCsvPath);
    const result = rule.evaluate(context);
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") {
      expect(result.code).toBe("LIST_UNAVAILABLE");
    }
  });

  it("re-reads CSV file when mtime or size changes", () => {
    const dynamicCsvPath = join(testDir, "dynamic.csv");
    const addr1 = "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW";
    const addr2 = "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX";

    try {
      writeFileSync(dynamicCsvPath, `${addr1}\n`);
      const rule = new AllowlistRule({
        id: "allowlist",
        path: dynamicCsvPath,
      });

      const context: RuleContext = {
        txHash: "tx1",
        nowMs: Date.now(),
        store: new MemoryStateStore(),
        payments: [
          {
            from: addr1,
            to: addr2,
            asset: { code: "GOAT", issuer: addr1 },
            amount: 100n,
          },
        ],
        accounts: new Map(),
      };

      // addr2 is not allowlisted yet
      expect(rule.evaluate(context).outcome).toBe("reject");

      // Add addr2 and update mtime
      writeFileSync(dynamicCsvPath, `${addr1}\n${addr2}\n`);
      const futureSec = Math.floor(Date.now() / 1000) + 10;
      utimesSync(dynamicCsvPath, futureSec, futureSec);

      // Now addr2 is allowlisted
      expect(rule.evaluate(context).outcome).toBe("pass");
    } finally {
      try {
        unlinkSync(dynamicCsvPath);
      } catch {
        // ignore
      }
    }
  });
});
