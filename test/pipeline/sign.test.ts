import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { sign } from "../../src/pipeline/sign.js";
import { LocalSigner } from "../../src/signer/local.js";

describe("pipeline sign", () => {
  const issuerKp = Keypair.random();
  const userKp = Keypair.random();
  const destKp = Keypair.random();
  const signer = new LocalSigner(issuerKp.secret(), issuerKp.publicKey());

  function buildUserSignedTx() {
    const account = new Account(userKp.publicKey(), "1000");
    const builder = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 1000, maxTime: 2000 },
    });
    builder.addOperation(
      Operation.payment({
        destination: destKp.publicKey(),
        asset: Asset.native(),
        amount: "10",
      }),
    );
    const tx = builder.build();
    tx.sign(userKp);
    return tx;
  }

  it("success case (revised: false) preserves user signature and appends issuer signature", async () => {
    const tx = buildUserSignedTx();
    expect(tx.signatures.length).toBe(1);

    const signedTx = await sign(tx, false, signer);
    expect(signedTx.signatures.length).toBe(2);

    const txHash = signedTx.hash();
    const userSig = signedTx.signatures[0];
    const issuerSig = signedTx.signatures[1];

    expect(userSig).toBeDefined();
    expect(issuerSig).toBeDefined();

    if (userSig && issuerSig) {
      expect(userKp.verify(txHash, userSig.signature)).toBe(true);
      expect(issuerKp.verify(txHash, issuerSig.signature)).toBe(true);
    }
  });

  it("revised case (revised: true) contains only the issuer signature", async () => {
    const tx = buildUserSignedTx();
    expect(tx.signatures.length).toBe(1);

    const signedTx = await sign(tx, true, signer);
    expect(signedTx.signatures.length).toBe(1);

    const txHash = signedTx.hash();
    const issuerSig = signedTx.signatures[0];
    expect(issuerSig).toBeDefined();

    if (issuerSig) {
      expect(issuerKp.verify(txHash, issuerSig.signature)).toBe(true);
    }
  });
});
