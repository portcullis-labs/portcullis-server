import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import {
  formatStroops,
  MAX_STROOPS,
  parseAmountToStroops,
  STROOPS_PER_UNIT,
} from "../../src/stellar/amount.js";

describe("stellar amount parsing and formatting", () => {
  describe("parseAmountToStroops", () => {
    it("should parse valid whole amounts", () => {
      expect(parseAmountToStroops("0")).toBe(0n);
      expect(parseAmountToStroops("1")).toBe(10000000n);
      expect(parseAmountToStroops("100")).toBe(1000000000n);
      expect(parseAmountToStroops("922337203685")).toBe(9223372036850000000n);
    });

    it("should parse valid fractional amounts with 1 to 7 decimal places", () => {
      expect(parseAmountToStroops("0.1")).toBe(1000000n);
      expect(parseAmountToStroops("0.01")).toBe(100000n);
      expect(parseAmountToStroops("0.001")).toBe(10000n);
      expect(parseAmountToStroops("0.0001")).toBe(1000n);
      expect(parseAmountToStroops("0.00001")).toBe(100n);
      expect(parseAmountToStroops("0.000001")).toBe(10n);
      expect(parseAmountToStroops("0.0000001")).toBe(1n);
      expect(parseAmountToStroops("100.5000000")).toBe(1005000000n);
      expect(parseAmountToStroops("922337203685.4775807")).toBe(MAX_STROOPS);
    });

    it("should reject invalid amount formats with INVALID_CONFIG error", () => {
      const invalidAmounts = [
        "",
        " ",
        " 10",
        "10 ",
        "-1",
        "-0.5",
        "+5",
        ".5",
        "5.",
        "01",
        "00.5",
        "1.12345678", // 8 decimals
        "1e7",
        "NaN",
        "Infinity",
        "abc",
        "1,000",
        "922337203685.4775808", // exceeds MAX_STROOPS
        "922337203686.0000000",
      ];

      for (const invalid of invalidAmounts) {
        expect(
          () => parseAmountToStroops(invalid),
          `Expected "${invalid}" to be rejected`,
        ).toThrowError(PortcullisError);
      }
    });
  });

  describe("formatStroops", () => {
    it("should format valid stroops values to 7 decimal places", () => {
      expect(formatStroops(0n)).toBe("0.0000000");
      expect(formatStroops(1n)).toBe("0.0000001");
      expect(formatStroops(10000000n)).toBe("1.0000000");
      expect(formatStroops(1005000000n)).toBe("100.5000000");
      expect(formatStroops(MAX_STROOPS)).toBe("922337203685.4775807");
    });

    it("should reject out-of-range stroops values", () => {
      expect(() => formatStroops(-1n)).toThrowError(PortcullisError);
      expect(() => formatStroops(MAX_STROOPS + 1n)).toThrowError(PortcullisError);
    });
  });

  describe("property: parseAmountToStroops(formatStroops(x)) === x", () => {
    it("should round-trip for boundary and fixed test cases", () => {
      const cases = [
        0n,
        1n,
        2n,
        7n,
        10n,
        99n,
        100n,
        1000000n,
        STROOPS_PER_UNIT,
        1234567890123n,
        MAX_STROOPS - 1n,
        MAX_STROOPS,
      ];

      for (const val of cases) {
        expect(parseAmountToStroops(formatStroops(val))).toBe(val);
      }
    });

    it("should round-trip across fast-check generated BigInt property suite", () => {
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: MAX_STROOPS }), (val) => {
          const formatted = formatStroops(val);
          const parsed = parseAmountToStroops(formatted);
          return parsed === val;
        }),
        { numRuns: 1000 },
      );
    });
  });
});
