import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Asset,
  Keypair,
  Networks,
  Operation,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
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

  it("should have at least 23 adversarial and safe fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(23);
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

  it("rejects when transaction has empty operations", () => {
    const emptyTx = {
      source: "GCAXSG5YHH7G5HDCXAWX4PJA2P2Y2RCL2V45E3N7276X5P7XNYO3B7M2",
      operations: [],
    } as unknown as Transaction;

    expect(() =>
      assertSafeToSign(emptyTx, {
        issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        assetCode: "USDC",
        maxOperations: 10,
      }),
    ).toThrow(PortcullisError);
  });

  it("rejects unknown user-sourced operations like accountMerge", () => {
    const invalidTx = {
      source: "GCAXSG5YHH7G5HDCXAWX4PJA2P2Y2RCL2V45E3N7276X5P7XNYO3B7M2",
      operations: [
        {
          type: "accountMerge",
          destination: "GAYOLLLUI437MDRO6ZOH2EQWAKP6K2H5QY4M65HQJMMY7YQDVG2DEB5A",
        },
      ],
    } as unknown as Transaction;

    expect(() =>
      assertSafeToSign(invalidTx, {
        issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        assetCode: "USDC",
        maxOperations: 10,
      }),
    ).toThrow(PortcullisError);
  });

  it("verifies decoded XDR flag representations for set and clear", () => {
    const issuerKp = Keypair.random();
    const userKp = Keypair.random();
    const asset = new Asset("USDC", issuerKp.publicKey());

    function buildAndDecodeFlags(flags: {
      authorized?: boolean;
      authorizedToMaintainLiabilities?: boolean;
      clawbackEnabled?: boolean;
    }) {
      const b = new TransactionBuilder(
        {
          accountId: () => userKp.publicKey(),
          sequenceNumber: () => "100",
          incrementSequenceNumber: () => {},
        },
        {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
          timebounds: { minTime: 0, maxTime: 1000 },
        },
      );
      b.addOperation(
        Operation.setTrustLineFlags({
          trustor: userKp.publicKey(),
          asset,
          flags,
          source: issuerKp.publicKey(),
        }),
      );
      const decoded = TransactionBuilder.fromXDR(b.build().toXDR(), Networks.TESTNET);
      return (decoded.operations[0] as { flags?: unknown }).flags;
    }

    // Exact authorize: only authorized is true, others undefined
    expect(buildAndDecodeFlags({ authorized: true })).toEqual({
      authorized: true,
      authorizedToMaintainLiabilities: undefined,
      clawbackEnabled: undefined,
    });

    // Authorize with clawbackEnabled cleared (false)
    expect(buildAndDecodeFlags({ authorized: true, clawbackEnabled: false })).toEqual({
      authorized: true,
      authorizedToMaintainLiabilities: undefined,
      clawbackEnabled: false,
    });

    // Authorize with authorizedToMaintainLiabilities cleared (false)
    expect(
      buildAndDecodeFlags({ authorized: true, authorizedToMaintainLiabilities: false }),
    ).toEqual({
      authorized: true,
      authorizedToMaintainLiabilities: false,
      clawbackEnabled: undefined,
    });

    // Exact deauthorize: only authorized is false, others undefined
    expect(buildAndDecodeFlags({ authorized: false })).toEqual({
      authorized: false,
      authorizedToMaintainLiabilities: undefined,
      clawbackEnabled: undefined,
    });

    // Deauthorize with clawbackEnabled cleared (false)
    expect(buildAndDecodeFlags({ authorized: false, clawbackEnabled: false })).toEqual({
      authorized: false,
      authorizedToMaintainLiabilities: undefined,
      clawbackEnabled: false,
    });
  });
});
