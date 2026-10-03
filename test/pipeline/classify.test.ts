import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import { classify } from "../../src/pipeline/classify.js";

describe("classify", () => {
  const issuerKp = Keypair.random();
  const user1Kp = Keypair.random();
  const user2Kp = Keypair.random();
  const network = Networks.TESTNET;

  const assetId = {
    code: "GOAT",
    issuer: issuerKp.publicKey(),
  };
  const stellarAsset = new Asset(assetId.code, assetId.issuer);

  it("successfully classifies valid regulated asset payments", () => {
    const account = new Account(user1Kp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: user2Kp.publicKey(),
          asset: stellarAsset,
          amount: "50.1234567",
        }),
      )
      .setTimeout(300)
      .build();

    const classified = classify(tx, assetId);
    expect(classified.payments).toHaveLength(1);
    expect(classified.payments[0]).toEqual({
      from: user1Kp.publicKey(),
      to: user2Kp.publicKey(),
      asset: assetId,
      amount: 501234567n,
    });
    expect(classified.issuerFlagOps).toHaveLength(0);
  });

  it("successfully classifies valid issuer SetTrustLineFlags and AllowTrust operations", () => {
    const account = new Account(user1Kp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "300",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.setTrustLineFlags({
          trustor: user1Kp.publicKey(),
          asset: stellarAsset,
          flags: { authorized: true },
          source: issuerKp.publicKey(),
        }),
      )
      .addOperation(
        Operation.payment({
          destination: user2Kp.publicKey(),
          asset: stellarAsset,
          amount: "10.0000000",
        }),
      )
      .addOperation(
        Operation.setTrustLineFlags({
          trustor: user1Kp.publicKey(),
          asset: stellarAsset,
          flags: { authorized: false },
          source: issuerKp.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const classified = classify(tx, assetId);
    expect(classified.payments).toHaveLength(1);
    expect(classified.issuerFlagOps).toHaveLength(2);
    expect(classified.issuerFlagOps[0]?.authorize).toBe(true);
    expect(classified.issuerFlagOps[1]?.authorize).toBe(false);
  });

  it("rejects payments of native XLM", () => {
    const account = new Account(user1Kp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: user2Kp.publicKey(),
          asset: Asset.native(),
          amount: "10.0000000",
        }),
      )
      .setTimeout(300)
      .build();

    expect(() => classify(tx, assetId)).toThrow(PortcullisError);
  });

  it("rejects payments where the issuer is the source or destination", () => {
    const account = new Account(user1Kp.publicKey(), "100");
    const txToIssuer = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.payment({
          destination: issuerKp.publicKey(),
          asset: stellarAsset,
          amount: "10.0000000",
        }),
      )
      .setTimeout(300)
      .build();

    expect(() => classify(txToIssuer, assetId)).toThrow(PortcullisError);
  });

  it("rejects unsupported operations such as SetOptions or ChangeTrust", () => {
    const account = new Account(user1Kp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.setOptions({
          homeDomain: "example.org",
        }),
      )
      .setTimeout(300)
      .build();

    expect(() => classify(tx, assetId)).toThrow(PortcullisError);
  });

  it("rejects trustline flag operations not sourced by the issuer", () => {
    const account = new Account(user1Kp.publicKey(), "100");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
    })
      .addOperation(
        Operation.setTrustLineFlags({
          trustor: user2Kp.publicKey(),
          asset: stellarAsset,
          flags: { authorized: true },
          source: user1Kp.publicKey(), // Wrong source
        }),
      )
      .setTimeout(300)
      .build();

    expect(() => classify(tx, assetId)).toThrow(PortcullisError);
  });
});
