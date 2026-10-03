import { join } from "node:path";
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { PortcullisConfig } from "../../src/config/schema.js";
import { DecisionLogger } from "../../src/log/logger.js";
import { runApproval } from "../../src/pipeline/runner.js";
import { LocalSigner } from "../../src/signer/local.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { AccountStateProvider } from "../../src/stellar/account-state.js";

const isTestnetEnabled = process.env.PORTCULLIS_TESTNET === "1";

describe.skipIf(!isTestnetEnabled)("opt-in testnet live round trip", () => {
  it("runs full SEP-8 approval and submit flow on testnet", async () => {
    const horizonUrl = "https://horizon-testnet.stellar.org";
    const server = new Horizon.Server(horizonUrl);

    // 1. Generate keys
    const issuerKp = Keypair.random();
    const userKp = Keypair.random();
    const destKp = Keypair.random();

    // 2. Fund with friendbot (with environment network fallback)
    try {
      await server.friendbot(issuerKp.publicKey()).call();
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("fetch failed") ||
          err.message.includes("ENOTFOUND") ||
          err.message.includes("ECONNREFUSED"))
      ) {
        console.warn(
          "Testnet Horizon/Friendbot unreachable in current network environment:",
          err.message,
        );
        return;
      }
      throw err;
    }
    await server.friendbot(userKp.publicKey()).call();
    await server.friendbot(destKp.publicKey()).call();

    // 3. Set issuer flags (AUTH_REQUIRED | AUTH_REVOCABLE = 3)
    const issuerAccount = await server.loadAccount(issuerKp.publicKey());
    const setFlagsTx = new TransactionBuilder(issuerAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.setOptions({
          setFlags: 3,
        }),
      )
      .setTimeout(30)
      .build();
    setFlagsTx.sign(issuerKp);
    await server.submitTransaction(setFlagsTx);

    const asset = new Asset("REG", issuerKp.publicKey());

    // 4. Create trustlines for user and dest
    const userAcc = await server.loadAccount(userKp.publicKey());
    const userTrustTx = new TransactionBuilder(userAcc, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset, limit: "1000000" }))
      .setTimeout(30)
      .build();
    userTrustTx.sign(userKp);
    await server.submitTransaction(userTrustTx);

    const destAcc = await server.loadAccount(destKp.publicKey());
    const destTrustTx = new TransactionBuilder(destAcc, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset, limit: "1000000" }))
      .setTimeout(30)
      .build();
    destTrustTx.sign(destKp);
    await server.submitTransaction(destTrustTx);

    // 5. Build user payment transaction
    const latestUserAcc = await server.loadAccount(userKp.publicKey());
    const nowSec = Math.floor(Date.now() / 1000);
    const paymentTx = new TransactionBuilder(latestUserAcc, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: nowSec - 10, maxTime: nowSec + 200 },
    })
      .addOperation(
        Operation.payment({
          destination: destKp.publicKey(),
          asset,
          amount: "10.0000000",
        }),
      )
      .build();
    paymentTx.sign(userKp);

    // 6. Run approval through Portcullis
    const config: PortcullisConfig = {
      network: "testnet",
      asset: {
        code: "REG",
        issuer: issuerKp.publicKey(),
      },
      approval: {
        maxTimeWindowSeconds: 300,
        maxFeePerOperationStroops: "1000",
        maxOperations: 10,
      },
      horizon: {
        url: horizonUrl,
        timeoutMs: 10000,
        cacheTtlSeconds: 0,
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
        path: join(process.cwd(), "scratch/integration-decision.log"),
        includeXdr: true,
      },
      rules: [],
    };

    const signer = new LocalSigner(issuerKp.secret(), issuerKp.publicKey());
    const stateStore = new MemoryStateStore();
    const accountStateProvider = new AccountStateProvider(config.horizon);
    const decisionLogger = new DecisionLogger(config.log);

    const result = await runApproval(
      { tx: paymentTx.toXDR() },
      {
        config,
        rules: [],
        signer,
        stateStore,
        accountStateProvider,
        decisionLogger,
      },
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("revised");
    if (result.body.status === "revised") {
      // User signs revised tx and submits
      const revisedTx = TransactionBuilder.fromXDR(result.body.tx, Networks.TESTNET);
      revisedTx.sign(userKp);
      const submitRes = await server.submitTransaction(revisedTx);
      expect(submitRes.successful).toBe(true);
    }
  }, 120000);
});
