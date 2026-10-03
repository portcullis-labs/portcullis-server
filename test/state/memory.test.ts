import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../../src/state/memory.js";
import type { Reservation } from "../../src/state/types.js";

const dummyAsset = {
  code: "GOAT",
  issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
};

describe("MemoryStateStore", () => {
  it("should enforce idempotency on (txHash, account, direction)", async () => {
    const store = new MemoryStateStore();
    const res1: Reservation = {
      txHash: "tx1",
      account: "accA",
      asset: dummyAsset,
      amount: 1000n,
      direction: "in",
      expiresAtMs: 2000,
    };
    const res1Updated: Reservation = {
      txHash: "tx1",
      account: "accA",
      asset: dummyAsset,
      amount: 2500n,
      direction: "in",
      expiresAtMs: 3000,
    };

    await store.reserve(res1);
    expect(await store.sumReserved("accA", "in", 1000)).toBe(1000n);

    await store.reserve(res1Updated);
    expect(await store.sumReserved("accA", "in", 1000)).toBe(2500n);
  });

  it("should exclude expired reservations in sumReserved and purgeExpired", async () => {
    const store = new MemoryStateStore();
    await store.reserve({
      txHash: "tx1",
      account: "accA",
      asset: dummyAsset,
      amount: 1000n,
      direction: "in",
      expiresAtMs: 2000,
    });
    await store.reserve({
      txHash: "tx2",
      account: "accA",
      asset: dummyAsset,
      amount: 500n,
      direction: "in",
      expiresAtMs: 4000,
    });

    expect(await store.sumReserved("accA", "in", 1000)).toBe(1500n);
    expect(await store.sumReserved("accA", "in", 2000)).toBe(500n);
    expect(await store.sumReserved("accA", "in", 4500)).toBe(0n);

    const purged = await store.purgeExpired(2500);
    expect(purged).toBe(1);
    expect(await store.sumReserved("accA", "in", 1000)).toBe(500n);
  });

  it("should release all reservations for a given txHash", async () => {
    const store = new MemoryStateStore();
    await store.reserve({
      txHash: "tx1",
      account: "accA",
      asset: dummyAsset,
      amount: 1000n,
      direction: "in",
      expiresAtMs: 5000,
    });
    await store.reserve({
      txHash: "tx1",
      account: "accB",
      asset: dummyAsset,
      amount: 1000n,
      direction: "out",
      expiresAtMs: 5000,
    });
    await store.reserve({
      txHash: "tx2",
      account: "accA",
      asset: dummyAsset,
      amount: 300n,
      direction: "in",
      expiresAtMs: 5000,
    });

    await store.release("tx1");
    expect(await store.sumReserved("accA", "in", 1000)).toBe(300n);
    expect(await store.sumReserved("accB", "out", 1000)).toBe(0n);
  });

  it("should handle simultaneous concurrent reservations without lost entries", async () => {
    const store = new MemoryStateStore();
    const count = 50;
    const promises = Array.from({ length: count }, (_, i) =>
      store.reserve({
        txHash: `tx_${i}`,
        account: "sharedAccount",
        asset: dummyAsset,
        amount: 100n,
        direction: "in",
        expiresAtMs: 10000,
      }),
    );

    await Promise.all(promises);
    expect(await store.sumReserved("sharedAccount", "in", 1000)).toBe(BigInt(count) * 100n);
  });

  it("property: sumReserved equals the sum of unexpired reservations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            txHash: fc.stringMatching(/^[a-f0-9]{4,8}$/),
            account: fc.constantFrom("accA", "accB", "accC"),
            amount: fc.bigInt({ min: 1n, max: 1000000000n }),
            direction: fc.constantFrom("in" as const, "out" as const),
            expiresAtMs: fc.integer({ min: 1000, max: 10000 }),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        fc.integer({ min: 500, max: 12000 }),
        async (reservationsList, queryNowMs) => {
          const store = new MemoryStateStore();

          // Apply reservations
          for (const item of reservationsList) {
            await store.reserve({
              ...item,
              asset: dummyAsset,
            });
          }

          // Calculate expected sum for ("accA", "in") manually tracking idempotency
          const latestMap = new Map<string, (typeof reservationsList)[number]>();
          for (const item of reservationsList) {
            const key = `${item.txHash}:${item.account}:${item.direction}`;
            latestMap.set(key, item);
          }

          let expectedSum = 0n;
          for (const item of latestMap.values()) {
            if (
              item.account === "accA" &&
              item.direction === "in" &&
              item.expiresAtMs > queryNowMs
            ) {
              expectedSum += item.amount;
            }
          }

          const actualSum = await store.sumReserved("accA", "in", queryNowMs);
          expect(actualSum).toBe(expectedSum);
        },
      ),
      { numRuns: 100 },
    );
  });
});
