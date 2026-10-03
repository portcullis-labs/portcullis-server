import { readdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
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
    code?: string;
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

  it("throws PortcullisError when approved hashes file does not exist at construction", () => {
    expect(
      () =>
        new ReviewThresholdRule({
          id: "review_threshold",
          above: "100.0000000",
          timeoutMs: 60000,
          message: "Needs review",
          approvedTxHashesPath: "fixtures/rules/review_threshold/non_existent.txt",
        }),
    ).toThrow(PortcullisError);
  });

  it("throws PortcullisError when approved hashes file contains invalid hash format at construction", () => {
    const badHashesPath = join(testDir, "bad_hashes.txt");
    writeFileSync(badHashesPath, "not_a_valid_64_char_hex_hash\n");
    try {
      expect(
        () =>
          new ReviewThresholdRule({
            id: "review_threshold",
            above: "100.0000000",
            timeoutMs: 60000,
            message: "Needs review",
            approvedTxHashesPath: badHashesPath,
          }),
      ).toThrow(PortcullisError);
    } finally {
      try {
        unlinkSync(badHashesPath);
      } catch {
        // ignore
      }
    }
  });

  it("fails closed with LIST_UNAVAILABLE when file is deleted after load", () => {
    const tempHashesPath = join(testDir, "temp_deleted_hashes.txt");
    const validHash = "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0";

    writeFileSync(tempHashesPath, `${validHash}\n`);
    const rule = new ReviewThresholdRule({
      id: "review_threshold",
      above: "100.0000000",
      timeoutMs: 60000,
      message: "Manual review required",
      approvedTxHashesPath: tempHashesPath,
    });

    const context: RuleContext = {
      txHash: validHash,
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

    expect(rule.evaluate(context).outcome).toBe("pass");

    // Delete the file: evaluate again fails closed with LIST_UNAVAILABLE
    unlinkSync(tempHashesPath);
    const result = rule.evaluate(context);
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") {
      expect(result.code).toBe("LIST_UNAVAILABLE");
    }
  });

  it("re-reads approved hashes file on each evaluation when modified", () => {
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

      // Append txHash to approved hashes file and update mtime
      writeFileSync(dynamicHashesPath, `${targetTxHash}\n`);
      const futureSec = Math.floor(Date.now() / 1000) + 10;
      utimesSync(dynamicHashesPath, futureSec, futureSec);

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
