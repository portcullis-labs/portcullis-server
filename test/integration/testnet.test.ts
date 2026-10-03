import { mkdirSync, writeFileSync } from "node:fs";
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
import { AccountLockManager } from "../../src/pipeline/lock.js";
import { runApproval } from "../../src/pipeline/runner.js";
import { LocalSigner } from "../../src/signer/local.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { AccountStateProvider } from "../../src/stellar/account-state.js";

const isTestnetEnabled = process.env.PORTCULLIS_TESTNET === "1";

describe.skipIf(!isTestnetEnabled)("opt-in testnet live round trip", () => {
  it("runs full SEP-8 approval and submit flow on testnet", async (ctx) => {
    const horizonUrl = "https://horizon-testnet.stellar.org";
    const server = new Horizon.Server(horizonUrl);

    // 1. Generate keys
    const issuerKp = Keypair.random();
    const userKp = Keypair.random();
    const destKp = Keypair.random();

    // 2. Fund with friendbot (with explicit test skipping if network/Horizon is unreachable)
    try {
      await server.friendbot(issuerKp.publicKey()).call();
      await server.friendbot(userKp.publicKey()).call();
      await server.friendbot(destKp.publicKey()).call();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return ctx.skip(`Testnet Horizon/Friendbot unreachable: ${reason}`);
    }

    // 3. Set issuer flags (AUTH_REQUIRED | AUTH_REVOCABLE = 3)
    let setFlagsRes: Horizon.HorizonApi.SubmitTransactionResponse;
    try {
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
      setFlagsRes = await server.submitTransaction(setFlagsTx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return ctx.skip(`Failed setting issuer flags on testnet: ${reason}`);
    }

    const asset = new Asset("REG", issuerKp.publicKey());

    // 4. Create trustlines for user and dest
    let userTrustRes: Horizon.HorizonApi.SubmitTransactionResponse;
    let destTrustRes: Horizon.HorizonApi.SubmitTransactionResponse;
    try {
      const userAcc = await server.loadAccount(userKp.publicKey());
      const userTrustTx = new TransactionBuilder(userAcc, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset, limit: "1000000" }))
        .setTimeout(30)
        .build();
      userTrustTx.sign(userKp);
      userTrustRes = await server.submitTransaction(userTrustTx);

      const destAcc = await server.loadAccount(destKp.publicKey());
      const destTrustTx = new TransactionBuilder(destAcc, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset, limit: "1000000" }))
        .setTimeout(30)
        .build();
      destTrustTx.sign(destKp);
      destTrustRes = await server.submitTransaction(destTrustTx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return ctx.skip(`Failed creating trustlines on testnet: ${reason}`);
    }

    // 5. Build user payment transaction
    let paymentTx: ReturnType<typeof TransactionBuilder.prototype.build>;
    try {
      const latestUserAcc = await server.loadAccount(userKp.publicKey());
      const nowSec = Math.floor(Date.now() / 1000);
      const builder = new TransactionBuilder(latestUserAcc, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
        timebounds: { minTime: nowSec - 10, maxTime: nowSec + 200 },
      });
      builder.addOperation(
        Operation.payment({
          destination: destKp.publicKey(),
          asset,
          amount: "10.0000000",
        }),
      );
      paymentTx = builder.build();
      paymentTx.sign(userKp);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return ctx.skip(`Failed building user payment transaction: ${reason}`);
    }

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
    const lockManager = new AccountLockManager();

    const result = await runApproval(
      { tx: paymentTx.toXDR() },
      {
        config,
        rules: [],
        signer,
        stateStore,
        accountStateProvider,
        decisionLogger,
        lockManager,
      },
    );

    if (
      result.httpStatus === 400 &&
      result.body.status === "rejected" &&
      result.body.error === "Compliance check temporarily unavailable. Try again."
    ) {
      return ctx.skip("Horizon account loading failed (network unavailable during approval).");
    }

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("revised");
    if (result.body.status !== "revised") {
      return;
    }

    // 7. User signs revised tx and submits to Horizon
    const revisedTx = TransactionBuilder.fromXDR(result.body.tx, Networks.TESTNET);
    revisedTx.sign(userKp);
    const submitRes = await server.submitTransaction(revisedTx);
    expect(submitRes.successful).toBe(true);

    // 8. Reload trustlines and assert is_authorized === false (temporary sandwich deauthorization)
    const finalUserAcc = await server.loadAccount(userKp.publicKey());
    const userBalance = finalUserAcc.balances.find(
      (b) => "asset_code" in b && b.asset_code === "REG",
    );
    expect(userBalance).toBeDefined();
    expect((userBalance as Horizon.HorizonApi.BalanceLineAsset).is_authorized).toBe(false);

    const finalDestAcc = await server.loadAccount(destKp.publicKey());
    const destBalance = finalDestAcc.balances.find(
      (b) => "asset_code" in b && b.asset_code === "REG",
    );
    expect(destBalance).toBeDefined();
    expect((destBalance as Horizon.HorizonApi.BalanceLineAsset).is_authorized).toBe(false);

    // 9. Record run details to scratch/testnet-run.json
    const runSummary = {
      timestamp: new Date().toISOString(),
      issuer: issuerKp.publicKey(),
      user: userKp.publicKey(),
      destination: destKp.publicKey(),
      setFlagsTxHash: setFlagsRes.hash,
      userTrustTxHash: userTrustRes.hash,
      destTrustTxHash: destTrustRes.hash,
      approvedTxHash: submitRes.hash,
      userAuthorizedPostSubmit: (userBalance as Horizon.HorizonApi.BalanceLineAsset).is_authorized,
      destAuthorizedPostSubmit: (destBalance as Horizon.HorizonApi.BalanceLineAsset).is_authorized,
    };

    mkdirSync(join(process.cwd(), "scratch"), { recursive: true });
    writeFileSync(
      join(process.cwd(), "scratch/testnet-run.json"),
      JSON.stringify(runSummary, null, 2),
    );
  }, 120000);
});
