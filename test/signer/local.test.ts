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
import { createSignerFromConfig, LocalSigner } from "../../src/signer/local.js";

describe("LocalSigner", () => {
  const issuerKp = Keypair.random();
  const otherKp = Keypair.random();
  const userKp = Keypair.random();

  it("signs a transaction producing a valid signature matching issuer public key", async () => {
    const signer = new LocalSigner(issuerKp.secret(), issuerKp.publicKey());
    expect(signer.publicKey()).toBe(issuerKp.publicKey());

    const account = new Account(userKp.publicKey(), "100");
    const builder = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 1000, maxTime: 2000 },
    });
    builder.addOperation(
      Operation.payment({
        destination: otherKp.publicKey(),
        asset: Asset.native(),
        amount: "10",
      }),
    );
    const tx = builder.build();

    expect(tx.signatures.length).toBe(0);
    const signedTx = await signer.signTransaction(tx);
    expect(signedTx.signatures.length).toBe(1);

    const txHash = signedTx.hash();
    const sig = signedTx.signatures[0];
    expect(sig).toBeDefined();
    if (sig) {
      const verified = issuerKp.verify(txHash, sig.signature);
      expect(verified).toBe(true);
    }
  });

  it("throws INVALID_CONFIG if secret key public key does not match configured issuer", () => {
    expect(() => {
      new LocalSigner(issuerKp.secret(), otherKp.publicKey());
    }).toThrow(PortcullisError);

    try {
      new LocalSigner(issuerKp.secret(), otherKp.publicKey());
    } catch (err) {
      expect(err).toBeInstanceOf(PortcullisError);
      expect((err as PortcullisError).code).toBe("INVALID_CONFIG");
    }
  });

  it("throws INVALID_CONFIG if secret key string is malformed", () => {
    expect(() => {
      new LocalSigner("not-a-valid-secret-key", issuerKp.publicKey());
    }).toThrow(PortcullisError);

    try {
      new LocalSigner("not-a-valid-secret-key", issuerKp.publicKey());
    } catch (err) {
      expect(err).toBeInstanceOf(PortcullisError);
      expect((err as PortcullisError).code).toBe("INVALID_CONFIG");
    }
  });

  it("redacts key material in toString() and JSON.stringify()", () => {
    const signer = new LocalSigner(issuerKp.secret(), issuerKp.publicKey());
    const str = signer.toString();
    const json = JSON.stringify(signer);

    expect(str).not.toContain(issuerKp.secret());
    expect(json).not.toContain(issuerKp.secret());
    expect(str).toContain(issuerKp.publicKey());
    expect(json).toContain(issuerKp.publicKey());
  });

  it("createSignerFromConfig loads secret from specified env variable", () => {
    const env = {
      MY_SIGNER_KEY: issuerKp.secret(),
    };
    const signer = createSignerFromConfig(
      {
        signer: { type: "local", secretEnv: "MY_SIGNER_KEY" },
        asset: { code: "USDC", issuer: issuerKp.publicKey() },
      },
      env,
    );
    expect(signer.publicKey()).toBe(issuerKp.publicKey());
  });

  it("createSignerFromConfig throws INVALID_CONFIG if env variable is unset", () => {
    expect(() =>
      createSignerFromConfig(
        {
          signer: { type: "local", secretEnv: "UNSET_KEY" },
          asset: { code: "USDC", issuer: issuerKp.publicKey() },
        },
        {},
      ),
    ).toThrow(PortcullisError);
  });
});
