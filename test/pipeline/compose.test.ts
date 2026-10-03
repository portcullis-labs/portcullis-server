import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { PortcullisConfig } from "../../src/config/schema.js";
import { PortcullisError } from "../../src/errors.js";
import { classify } from "../../src/pipeline/classify.js";
import { compose } from "../../src/pipeline/compose.js";

const issuerKeypair = Keypair.random();
const userKeypair1 = Keypair.random();
const userKeypair2 = Keypair.random();
const userKeypair3 = Keypair.random();

const config: PortcullisConfig = {
  network: "testnet",
  asset: {
    code: "USDC",
    issuer: issuerKeypair.publicKey(),
  },
  approval: {
    maxTimeWindowSeconds: 300,
    maxFeePerOperationStroops: "1000",
    maxOperations: 10,
  },
  horizon: {
    url: "https://horizon-testnet.stellar.org",
    timeoutMs: 5000,
    cacheTtlSeconds: 60,
  },
  signer: {
    type: "local",
    secretEnv: "ISSUER_SECRET",
  },
  server: {
    port: 3000,
    publicBaseUrl: "http://127.0.0.1:3000",
  },
  log: {
    path: "portcullis.log",
    includeXdr: false,
  },
  rules: [],
};

const stellarAsset = new Asset(config.asset.code, config.asset.issuer);

function buildPaymentTx(
  sourceKeypair: Keypair,
  payments: Array<{ to: string; amount: string; from?: string }>,
  feePerOp = "100",
) {
  const account = new Account(sourceKeypair.publicKey(), "1000");
  const builder = new TransactionBuilder(account, {
    fee: feePerOp,
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 1000, maxTime: 2000 },
  });

  for (const p of payments) {
    const paymentOpts: {
      destination: string;
      asset: Asset;
      amount: string;
      source?: string;
    } = {
      destination: p.to,
      asset: stellarAsset,
      amount: p.amount,
    };
    if (p.from) {
      paymentOpts.source = p.from;
    }
    builder.addOperation(Operation.payment(paymentOpts));
  }

  const tx = builder.build();
  tx.sign(sourceKeypair);
  return tx;
}

describe("compose", () => {
  it("composes a revised transaction for naked payment", () => {
    const tx = buildPaymentTx(userKeypair1, [
      { to: userKeypair2.publicKey(), amount: "50.0000000" },
    ]);
    const classified = classify(tx, config.asset);

    const result = compose(tx, classified, config);
    expect(result.revised).toBe(true);
    expect(result.message).toBeDefined();

    // 1 authorize user1 + 1 authorize user2 + 1 payment + 1 deauth user1 + 1 deauth user2 = 5 ops
    expect(result.tx.operations.length).toBe(5);

    // Op 0: authorize user1
    const op0 = result.tx.operations[0];
    expect(op0?.type).toBe("setTrustLineFlags");
    if (op0?.type === "setTrustLineFlags") {
      expect(op0.trustor).toBe(userKeypair1.publicKey());
      expect(op0.flags.authorized).toBe(true);
      expect(op0.source).toBe(issuerKeypair.publicKey());
    }

    // Op 1: authorize user2
    const op1 = result.tx.operations[1];
    expect(op1?.type).toBe("setTrustLineFlags");
    if (op1?.type === "setTrustLineFlags") {
      expect(op1.trustor).toBe(userKeypair2.publicKey());
      expect(op1.flags.authorized).toBe(true);
      expect(op1.source).toBe(issuerKeypair.publicKey());
    }

    // Op 2: payment
    const op2 = result.tx.operations[2];
    expect(op2?.type).toBe("payment");

    // Op 3: deauthorize user1
    const op3 = result.tx.operations[3];
    expect(op3?.type).toBe("setTrustLineFlags");
    if (op3?.type === "setTrustLineFlags") {
      expect(op3.trustor).toBe(userKeypair1.publicKey());
      expect(op3.flags.authorized).toBe(false);
      expect(op3.source).toBe(issuerKeypair.publicKey());
    }

    // Op 4: deauthorize user2
    const op4 = result.tx.operations[4];
    expect(op4?.type).toBe("setTrustLineFlags");
    if (op4?.type === "setTrustLineFlags") {
      expect(op4.trustor).toBe(userKeypair2.publicKey());
      expect(op4.flags.authorized).toBe(false);
      expect(op4.source).toBe(issuerKeypair.publicKey());
    }
  });

  it("returns revised: false when transaction is already SEP-8 shaped", () => {
    const tx = buildPaymentTx(userKeypair1, [
      { to: userKeypair2.publicKey(), amount: "50.0000000" },
    ]);
    const classified = classify(tx, config.asset);
    const revisedResult = compose(tx, classified, config);

    // Now re-compose the revised transaction
    const reClassified = classify(revisedResult.tx, config.asset);
    const reComposeResult = compose(revisedResult.tx, reClassified, config);

    expect(reComposeResult.revised).toBe(false);
    expect(reComposeResult.tx).toBe(revisedResult.tx);
  });

  it("handles multiple payments with overlapping accounts in appearance order", () => {
    const tx = buildPaymentTx(userKeypair1, [
      { to: userKeypair2.publicKey(), amount: "10.0000000" },
      { to: userKeypair3.publicKey(), amount: "20.0000000" },
      { to: userKeypair2.publicKey(), amount: "30.0000000" },
    ]);
    const classified = classify(tx, config.asset);
    const result = compose(tx, classified, config);

    // Distinct accounts: user1, user2, user3 (3 accounts)
    // Auth ops: 3, Payments: 3, Deauth ops: 3 -> Total 9 ops
    expect(result.tx.operations.length).toBe(9);
    expect(result.revised).toBe(true);
  });

  it("rejects when fee per op exceeds maxFeePerOperationStroops", () => {
    const tx = buildPaymentTx(
      userKeypair1,
      [{ to: userKeypair2.publicKey(), amount: "50.0000000" }],
      "5000",
    );
    const classified = classify(tx, config.asset);

    expect(() => compose(tx, classified, config)).toThrow(PortcullisError);
  });

  it("rejects when revised operation count exceeds maxOperations", () => {
    const lowMaxOpConfig: PortcullisConfig = {
      ...config,
      approval: {
        ...config.approval,
        maxOperations: 3,
      },
    };
    const tx = buildPaymentTx(userKeypair1, [
      { to: userKeypair2.publicKey(), amount: "50.0000000" },
    ]);
    const classified = classify(tx, lowMaxOpConfig.asset);

    expect(() => compose(tx, classified, lowMaxOpConfig)).toThrow(PortcullisError);
  });

  it("rejects when classified payments is empty", () => {
    const tx = buildPaymentTx(userKeypair1, [
      { to: userKeypair2.publicKey(), amount: "50.0000000" },
    ]);
    const emptyClassified = {
      payments: [],
      issuerFlagOps: [],
    };

    expect(() => compose(tx, emptyClassified, config)).toThrow(PortcullisError);
  });
});
