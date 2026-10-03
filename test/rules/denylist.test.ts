import { readdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DenylistRuleConfig } from "../../src/config/schema.js";
import { PortcullisError } from "../../src/errors.js";
import { DenylistRule } from "../../src/rules/denylist.js";
import type { RuleContext } from "../../src/rules/types.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { parseAmountToStroops } from "../../src/stellar/amount.js";

interface GoldenFixture {
  name: string;
  ruleConfig: DenylistRuleConfig;
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
  };
}

describe("denylist golden fixtures", () => {
  const fixturesDir = join(process.cwd(), "fixtures/rules/denylist");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  it("should have at least 4 golden fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), "utf-8");
    const fixture = JSON.parse(raw) as GoldenFixture;

    it(`fixture: ${fixture.name} (${file})`, () => {
      const rule = new DenylistRule(fixture.ruleConfig);
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

describe("denylist unit tests", () => {
  const testDir = join(process.cwd(), "fixtures/rules/denylist");

  it("throws PortcullisError on non-existent file at construction", () => {
    expect(
      () =>
        new DenylistRule({
          id: "denylist",
          path: "fixtures/rules/denylist/non_existent.csv",
        }),
    ).toThrow(PortcullisError);
  });

  it("throws PortcullisError when CSV contains invalid Stellar address at construction", () => {
    const badCsvPath = join(testDir, "bad_denylist.csv");
    writeFileSync(badCsvPath, "NOT_A_VALID_STELLAR_ADDRESS\n");
    try {
      expect(
        () =>
          new DenylistRule({
            id: "denylist",
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
    const tempCsvPath = join(testDir, "temp_deleted_denylist.csv");
    const addr1 = "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW";
    const addr2 = "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX";

    writeFileSync(tempCsvPath, `${addr1}\n`);
    const rule = new DenylistRule({
      id: "denylist",
      path: tempCsvPath,
    });

    const context: RuleContext = {
      txHash: "tx1",
      nowMs: Date.now(),
      store: new MemoryStateStore(),
      payments: [
        {
          from: addr2,
          to: "GABPCMNFU3WWSY2G457BK6FS2QMABCA2MUOLQ7J23VVVWALI6EXUXUXR",
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

  it("re-reads CSV file when mtime changes", () => {
    const dynamicCsvPath = join(testDir, "dynamic_denylist.csv");
    const addr1 = "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW";
    const addr2 = "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX";

    try {
      writeFileSync(dynamicCsvPath, "# empty initially\n");
      const rule = new DenylistRule({
        id: "denylist",
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

      // Initially neither is denylisted
      expect(rule.evaluate(context).outcome).toBe("pass");

      // Add addr2 to denylist and update mtime
      writeFileSync(dynamicCsvPath, `${addr2}\n`);
      const futureSec = Math.floor(Date.now() / 1000) + 10;
      utimesSync(dynamicCsvPath, futureSec, futureSec);

      // Now addr2 triggers reject
      expect(rule.evaluate(context).outcome).toBe("reject");
    } finally {
      try {
        unlinkSync(dynamicCsvPath);
      } catch {
        // ignore
      }
    }
  });
});
