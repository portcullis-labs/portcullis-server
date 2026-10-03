import { describe, expect, it } from "vitest";
import { AccountLockManager, withAccountLocks } from "../../src/pipeline/lock.js";
import { HoldingCapRule } from "../../src/rules/holding-cap.js";
import type { RuleContext } from "../../src/rules/types.js";
import { MemoryStateStore } from "../../src/state/memory.js";

import { parseAmountToStroops } from "../../src/stellar/amount.js";

describe("pipeline check-and-reserve concurrency", () => {
  const asset = {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  };
  const destinationAccount = "GAYOLLLUI437MDRO6ZOH2EQWAKP6K2H5QY4M65HQJMMY7YQDVG2DEB5A";
  const sourceAccount = "GCAXSG5YHH7G5HDCXAWX4PJA2P2Y2RCL2V45E3N7276X5P7XNYO3B7M2";

  it("serializes check-and-reserve so parallel requests cannot exceed holding cap", async () => {
    const store = new MemoryStateStore();
    const lockManager = new AccountLockManager();
    const holdingCapRule = new HoldingCapRule({
      id: "holding_cap",
      max: "100.0000000", // Max 100
    });

    const numRequests = 5;
    const paymentAmount = parseAmountToStroops("40.0000000"); // 40 each. 2 will fit (80), 3rd will exceed (120 > 100).
    const nowMs = 10000;
    const expiresAtMs = nowMs + 60000;

    async function processCheckAndReserve(txIndex: number) {
      const txHash = `000000000000000000000000000000000000000000000000000000000000000${txIndex}`;
      const accountsToLock = [sourceAccount, destinationAccount];

      return await withAccountLocks(
        accountsToLock,
        async () => {
          // Simulate a small random delay inside the lock to ensure concurrency contention
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));

          const ctx: RuleContext = {
            txHash,
            nowMs,
            store,
            payments: [
              {
                from: sourceAccount,
                to: destinationAccount,
                asset,
                amount: paymentAmount,
              },
            ],
            accounts: new Map([
              [
                destinationAccount,
                {
                  id: destinationAccount,
                  balance: 0n,
                  hasTrustline: true,
                  authorized: true,
                },
              ],
            ]),
          };

          const result = await holdingCapRule.evaluate(ctx);

          if (result.outcome === "pass") {
            // Write reservation for success/revised
            await store.reserve({
              txHash,
              account: sourceAccount,
              asset,
              amount: paymentAmount,
              direction: "out",
              expiresAtMs,
            });
            await store.reserve({
              txHash,
              account: destinationAccount,
              asset,
              amount: paymentAmount,
              direction: "in",
              expiresAtMs,
            });
            return { txIndex, status: "approved" };
          }

          return { txIndex, status: "rejected", reason: result.message };
        },
        lockManager,
      );
    }

    // Run all 5 requests concurrently in Promise.all
    const results = await Promise.all(
      Array.from({ length: numRequests }, (_, i) => processCheckAndReserve(i + 1)),
    );

    const approved = results.filter((r) => r.status === "approved");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly 2 requests must be approved (2 * 40 = 80 <= 100)
    expect(approved.length).toBe(2);
    // Exactly 3 requests must be rejected (3 * 40 would be 120 > 100)
    expect(rejected.length).toBe(3);

    // Verify state store reserved sum
    const finalReserved = await store.sumReserved(destinationAccount, "in", nowMs);
    expect(finalReserved).toBe(parseAmountToStroops("80.0000000"));
  });
});
