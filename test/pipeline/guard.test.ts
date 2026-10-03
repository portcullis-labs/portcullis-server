import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import { assertSafeToSign, type GuardContext } from "../../src/pipeline/guard.js";

interface GuardGoldenFixture {
  name: string;
  description: string;
  xdr: string;
  issuer: string;
  assetCode: string;
  maxOperations: number;
  expected: "pass" | "UNSAFE_TO_SIGN";
}

describe("safe-to-sign guard golden fixtures", () => {
  const fixturesDir = join(process.cwd(), "fixtures/guard");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  it("should have at least 9 adversarial fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), "utf-8");
    const fixture = JSON.parse(raw) as GuardGoldenFixture;

    it(`fixture: ${fixture.name} (${file}) - ${fixture.description}`, () => {
      const tx = TransactionBuilder.fromXDR(fixture.xdr, Networks.TESTNET);
      const ctx: GuardContext = {
        issuer: fixture.issuer,
        assetCode: fixture.assetCode,
        maxOperations: fixture.maxOperations,
      };

      if (fixture.expected === "pass") {
        expect(() => assertSafeToSign(tx, ctx)).not.toThrow();
      } else {
        expect(() => assertSafeToSign(tx, ctx)).toThrow(PortcullisError);
        try {
          assertSafeToSign(tx, ctx);
        } catch (err) {
          expect(err).toBeInstanceOf(PortcullisError);
          expect((err as PortcullisError).code).toBe("UNSAFE_TO_SIGN");
        }
      }
    });
  }
});
