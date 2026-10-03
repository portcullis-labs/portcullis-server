import type { Transaction } from "@stellar/stellar-sdk";
import { PortcullisError } from "../errors.js";

/**
 * Validates transaction timebounds against current timestamp and configured maximum window.
 * Requires an explicit non-zero upper timebound (maxTime).
 *
 * Rejects with:
 * - MISSING_TIMEBOUND if timeBounds or maxTime is absent / zero.
 * - TIMEBOUND_EXPIRED if maxTime is in the past or equal to nowSec.
 * - TIMEBOUND_TOO_FAR if maxTime exceeds nowSec + maxWindowSeconds.
 */
export function checkTimebounds(tx: Transaction, nowSec: number, maxWindowSeconds: number): void {
  const timeBounds = tx.timeBounds;
  if (!timeBounds?.maxTime || timeBounds.maxTime === "0") {
    throw new PortcullisError(
      "MISSING_TIMEBOUND",
      "Transaction is missing an upper timebound (maxTime is required and must be non-zero)",
    );
  }

  const maxTimeSec = Number.parseInt(timeBounds.maxTime, 10);
  if (Number.isNaN(maxTimeSec) || maxTimeSec <= 0) {
    throw new PortcullisError(
      "MISSING_TIMEBOUND",
      "Transaction upper timebound (maxTime) is invalid",
    );
  }

  if (maxTimeSec <= nowSec) {
    throw new PortcullisError(
      "TIMEBOUND_EXPIRED",
      `Transaction timebound has expired: maxTime (${maxTimeSec}) is not in the future relative to current time (${nowSec})`,
    );
  }

  if (maxTimeSec > nowSec + maxWindowSeconds) {
    throw new PortcullisError(
      "TIMEBOUND_TOO_FAR",
      `Transaction upper timebound too far in the future: maxTime (${maxTimeSec}) exceeds now (${nowSec}) + maxWindowSeconds (${maxWindowSeconds})`,
    );
  }
}
