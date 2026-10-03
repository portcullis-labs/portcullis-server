import type { Stroops } from "../domain/types.js";
import type { Reservation, StateStore } from "./types.js";

export class MemoryStateStore implements StateStore {
  private readonly reservations = new Map<string, Reservation>();

  private getReservationKey(txHash: string, account: string, direction: "in" | "out"): string {
    return `${txHash}:${account}:${direction}`;
  }

  /**
   * Records a quota reservation. Idempotent on (txHash, account, direction).
   */
  async reserve(r: Reservation): Promise<void> {
    const key = this.getReservationKey(r.txHash, r.account, r.direction);
    this.reservations.set(key, { ...r });
  }

  /**
   * Sums all active (unexpired) reservations for a given account and direction.
   */
  async sumReserved(account: string, direction: "in" | "out", nowMs: number): Promise<Stroops> {
    let total = 0n;

    for (const res of this.reservations.values()) {
      if (res.account === account && res.direction === direction && res.expiresAtMs > nowMs) {
        total += res.amount;
      }
    }

    return total;
  }

  /**
   * Releases all reservations associated with a specific transaction hash.
   */
  async release(txHash: string): Promise<void> {
    for (const [key, res] of this.reservations.entries()) {
      if (res.txHash === txHash) {
        this.reservations.delete(key);
      }
    }
  }

  /**
   * Purges all expired reservations and returns the number of removed entries.
   */
  async purgeExpired(nowMs: number): Promise<number> {
    let purgedCount = 0;

    for (const [key, res] of this.reservations.entries()) {
      if (res.expiresAtMs <= nowMs) {
        this.reservations.delete(key);
        purgedCount++;
      }
    }

    return purgedCount;
  }
}
