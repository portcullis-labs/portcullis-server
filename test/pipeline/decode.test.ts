import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import { decodeEnvelope } from "../../src/pipeline/decode.js";

describe("decodeEnvelope", () => {
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), "100");
  const network = Networks.TESTNET;

  it("successfully decodes a valid transaction envelope XDR", () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(300)
      .build();
    tx.sign(kp);

    const xdr = tx.toXdr();
    const decoded = decodeEnvelope(xdr, network);

    expect(decoded).toBeInstanceOf(Transaction);
    expect(decoded.source).toBe(kp.publicKey());
    expect(decoded.sequence).toBe("101");
    expect(decoded.operations).toHaveLength(1);
  });

  it("throws MALFORMED_XDR for invalid or corrupt XDR strings", () => {
    expect(() => decodeEnvelope("invalid-base64", network)).toThrow(PortcullisError);
    try {
      decodeEnvelope("invalid-base64", network);
    } catch (err) {
      expect(err).toBeInstanceOf(PortcullisError);
      expect((err as PortcullisError).code).toBe("MALFORMED_XDR");
    }

    expect(() => decodeEnvelope("", network)).toThrow(PortcullisError);
  });

  it("throws UNSUPPORTED_FEE_BUMP for fee-bump transactions", () => {
    const innerTx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(300)
      .build();
    innerTx.sign(kp);

    const feeSourceKp = Keypair.random();
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      feeSourceKp,
      "200",
      innerTx,
      network,
    );
    feeBumpTx.sign(feeSourceKp);

    const feeBumpXdr = feeBumpTx.toXdr();

    expect(() => decodeEnvelope(feeBumpXdr, network)).toThrow(PortcullisError);
    try {
      decodeEnvelope(feeBumpXdr, network);
    } catch (err) {
      expect(err).toBeInstanceOf(PortcullisError);
      expect((err as PortcullisError).code).toBe("UNSUPPORTED_FEE_BUMP");
    }
  });
});
