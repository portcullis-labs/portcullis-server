import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import { verifyRequesterSignature } from "../../src/pipeline/verify-signature.js";

describe("verifyRequesterSignature", () => {
  const userKp = Keypair.random();
  const otherKp = Keypair.random();
  const network = Networks.TESTNET;

  it("passes when transaction is correctly signed by the source account", () => {
    const account = new Account(userKp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: otherKp.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(300)
      .build();
    tx.sign(userKp);

    expect(() => verifyRequesterSignature(tx)).not.toThrow();
  });

  it("throws BAD_REQUESTER_SIGNATURE when transaction has no signatures", () => {
    const account = new Account(userKp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: otherKp.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(300)
      .build();

    expect(() => verifyRequesterSignature(tx)).toThrow(PortcullisError);
    try {
      verifyRequesterSignature(tx);
    } catch (err) {
      expect(err).toBeInstanceOf(PortcullisError);
      expect((err as PortcullisError).code).toBe("BAD_REQUESTER_SIGNATURE");
      expect((err as PortcullisError).message).toContain("network passphrase mismatch");
    }
  });

  it("throws BAD_REQUESTER_SIGNATURE when transaction is signed by a different account", () => {
    const account = new Account(userKp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: otherKp.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(300)
      .build();
    tx.sign(otherKp); // Signed by otherKp, not userKp

    expect(() => verifyRequesterSignature(tx)).toThrow(PortcullisError);
    try {
      verifyRequesterSignature(tx);
    } catch (err) {
      expect(err).toBeInstanceOf(PortcullisError);
      expect((err as PortcullisError).code).toBe("BAD_REQUESTER_SIGNATURE");
    }
  });

  it("throws BAD_REQUESTER_SIGNATURE when signed against a different network passphrase", () => {
    const account = new Account(userKp.publicKey(), "100");
    // Built and signed for PUBLIC network
    const txPublic = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(
        Operation.payment({
          destination: otherKp.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(300)
      .build();
    txPublic.sign(userKp);

    // Decoded / evaluated as TESTNET transaction
    const xdr = txPublic.toXdr();
    const txTestnet = TransactionBuilder.fromXdr(xdr, Networks.TESTNET) as Transaction;

    expect(() => verifyRequesterSignature(txTestnet)).toThrow(PortcullisError);
  });
});
