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

  it("should exclude specified excludeTxHash from sumReserved", async () => {
    const store = new MemoryStateStore();
    await store.reserve({
      txHash: "tx_self",
      account: "accA",
      asset: dummyAsset,
      amount: 1000n,
      direction: "in",
      expiresAtMs: 5000,
    });
    await store.reserve({
      txHash: "tx_other",
      account: "accA",
      asset: dummyAsset,
      amount: 500n,
      direction: "in",
      expiresAtMs: 5000,
    });

    // Without exclusion: 1500n
    expect(await store.sumReserved("accA", "in", 1000)).toBe(1500n);

    // Excluding tx_self: only tx_other counts (500n)
    expect(await store.sumReserved("accA", "in", 1000, "tx_self")).toBe(500n);

    // Excluding tx_other: only tx_self counts (1000n)
    expect(await store.sumReserved("accA", "in", 1000, "tx_other")).toBe(1000n);
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
    const promises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      promises.push(
        store.reserve({
          txHash: `tx_${i}`,
          account: "shared_account",
          asset: dummyAsset,
          amount: 100n,
          direction: "in",
          expiresAtMs: 10000,
        }),
      );
    }

    await Promise.all(promises);
    expect(await store.sumReserved("shared_account", "in", 1000)).toBe(BigInt(count) * 100n);
  });

  it("property test: sumReserved equals the sum of unexpired reservations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            txHash: fc.stringMatching(/^[a-z0-9]{4,10}$/),
            account: fc.constantFrom("acc1", "acc2", "acc3"),
            amount: fc.bigInt({ min: 1n, max: 1_000_000_000n }),
            direction: fc.constantFrom<"in" | "out">("in", "out"),
            expiresAtMs: fc.integer({ min: 100, max: 1000 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        fc.integer({ min: 0, max: 1200 }),
        fc.constantFrom("acc1", "acc2", "acc3"),
        fc.constantFrom<"in" | "out">("in", "out"),
        async (rawReservations, nowMs, queryAccount, queryDirection) => {
          const store = new MemoryStateStore();
          const latestMap = new Map<string, Reservation>();

          for (const raw of rawReservations) {
            const res: Reservation = {
              ...raw,
              asset: dummyAsset,
            };
            await store.reserve(res);
            latestMap.set(`${res.txHash}:${res.account}:${res.direction}`, res);
          }

          let expectedSum = 0n;
          for (const res of latestMap.values()) {
            if (
              res.account === queryAccount &&
              res.direction === queryDirection &&
              res.expiresAtMs > nowMs
            ) {
              expectedSum += res.amount;
            }
          }

          const actualSum = await store.sumReserved(queryAccount, queryDirection, nowMs);
          expect(actualSum).toBe(expectedSum);
        },
      ),
      { numRuns: 100 },
    );
  });
});
