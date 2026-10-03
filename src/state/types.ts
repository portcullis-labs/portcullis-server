import type { AssetId, Stroops } from "../domain/types.js";

export interface Reservation {
  txHash: string;
  account: string;
  asset: AssetId;
  amount: Stroops;
  direction: "in" | "out";
  expiresAtMs: number;
}

export interface StateStore {
  reserve(r: Reservation): Promise<void>;
  sumReserved(account: string, direction: "in" | "out", nowMs: number): Promise<Stroops>;
  release(txHash: string): Promise<void>;
  purgeExpired(nowMs: number): Promise<number>;
}
