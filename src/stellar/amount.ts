import { PortcullisError } from "../errors.js";

const AMOUNT_REGEX = /^(0|[1-9][0-9]*)(\.[0-9]{1,7})?$/;
export const MAX_STROOPS = 9223372036854775807n;
export const STROOPS_PER_UNIT = 10000000n;

/**
 * Parses a Stellar amount string into stroops (1 unit = 10^7 stroops).
 * Follows grammar ^(0|[1-9][0-9]*)(\.[0-9]{1,7})?$
 * Rejects any values above int64 max (9223372036854775807 stroops).
 */
export function parseAmountToStroops(s: string): bigint {
  if (typeof s !== "string" || !AMOUNT_REGEX.test(s)) {
    throw new PortcullisError("INVALID_CONFIG", `Invalid amount format: "${s}"`);
  }

  const [intPartStr, fracPartStr = ""] = s.split(".");
  const intPart = BigInt(intPartStr as string);
  const fracPartPadded = fracPartStr.padEnd(7, "0");
  const fracPart = BigInt(fracPartPadded);

  const stroops = intPart * STROOPS_PER_UNIT + fracPart;

  if (stroops > MAX_STROOPS) {
    throw new PortcullisError(
      "INVALID_CONFIG",
      `Amount exceeds maximum supported stroops (${MAX_STROOPS}): "${s}"`,
    );
  }

  return stroops;
}

/**
 * Formats a stroops bigint into a Stellar asset amount string with fixed 7 decimal places.
 */
export function formatStroops(v: bigint): string {
  if (typeof v !== "bigint" || v < 0n || v > MAX_STROOPS) {
    throw new PortcullisError(
      "INVALID_CONFIG",
      `Stroops value out of range (0..${MAX_STROOPS}): ${v}`,
    );
  }

  const intPart = v / STROOPS_PER_UNIT;
  const fracPart = v % STROOPS_PER_UNIT;

  return `${intPart.toString()}.${fracPart.toString().padStart(7, "0")}`;
}
