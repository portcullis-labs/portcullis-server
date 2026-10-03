import { join } from "node:path";
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
import { DecisionLogger } from "../../src/log/logger.js";
import { AccountLockManager } from "../../src/pipeline/lock.js";
import type { ApprovalDependencies } from "../../src/pipeline/runner.js";
import { AllowlistRule } from "../../src/rules/allowlist.js";
import { PerTxLimitRule } from "../../src/rules/per-tx-limit.js";
import { ReviewThresholdRule } from "../../src/rules/review-threshold.js";
import { createServerApp } from "../../src/server/app.js";
import { LocalSigner } from "../../src/signer/local.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { AccountStateProvider } from "../../src/stellar/account-state.js";

describe("POST /tx_approve endpoint", () => {
  const issuerKp = Keypair.random();
  const user1Kp = Keypair.random();
  const user2Kp = Keypair.random();
  const strangerKp = Keypair.random();

  const testLogPath = join(process.cwd(), "scratch/test-server-decision.log");

  const config: PortcullisConfig = {
    network: "testnet",
    asset: {
      code: "USDC",
      issuer: issuerKp.publicKey(),
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
      path: testLogPath,
      includeXdr: false,
    },
    rules: [],
  };

  const signer = new LocalSigner(issuerKp.secret(), issuerKp.publicKey());
  const stellarAsset = new Asset(config.asset.code, config.asset.issuer);
  const lockManager = new AccountLockManager();

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    const accountId = url.split("/").pop() ?? "";
    return new Response(
      JSON.stringify({
        id: accountId,
        balances: [
          {
            asset_type: "credit_alphanumeric4",
            asset_code: "USDC",
            asset_issuer: issuerKp.publicKey(),
            balance: "1000.0000000",
            is_authorized: false,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const accountStateProvider = new AccountStateProvider(config.horizon, mockFetch);

  function makeDeps(overrides: Partial<ApprovalDependencies> = {}): ApprovalDependencies {
    return {
      config,
      rules: [],
      signer,
      stateStore: new MemoryStateStore(),
      accountStateProvider,
      decisionLogger: new DecisionLogger({ path: testLogPath, includeXdr: false }),
      lockManager,
      ...overrides,
    };
  }

  function buildPaymentTx(
    sourceKp: Keypair,
    dest: string,
    amount: string,
    minTime = 0,
    maxTime = Math.floor(Date.now() / 1000) + 120,
  ) {
    const account = new Account(sourceKp.publicKey(), "1000");
    const builder = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime, maxTime },
    });
    builder.addOperation(
      Operation.payment({
        destination: dest,
        asset: stellarAsset,
        amount,
      }),
    );
    const tx = builder.build();
    tx.sign(sourceKp);
    return tx;
  }

  it("returns revised status (HTTP 200) for unshaped transaction", async () => {
    const deps = makeDeps();
    const app = createServerApp(deps);
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "10.0000000");

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: tx.toXDR() }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await res.json()) as { status: string; tx?: string; message?: string };
    expect(body.status).toBe("revised");
    expect(body.tx).toBeDefined();
    expect(body.message).toContain("Added");
    expect(body).not.toHaveProperty("code");
  });

  it("accepts form-urlencoded body format", async () => {
    const deps = makeDeps();
    const app = createServerApp(deps);
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "10.0000000");

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `tx=${encodeURIComponent(tx.toXDR())}`,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; tx?: string };
    expect(body.status).toBe("revised");
    expect(body.tx).toBeDefined();
  });

  it("returns success status (HTTP 200) for already-shaped transaction", async () => {
    const deps = makeDeps();
    const app = createServerApp(deps);

    const now = Math.floor(Date.now() / 1000);
    const account = new Account(user1Kp.publicKey(), "1000");
    const builder = new TransactionBuilder(account, {
      fee: "300",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime: now + 120 },
    });
    builder.addOperation(
      Operation.setTrustLineFlags({
        trustor: user1Kp.publicKey(),
        asset: stellarAsset,
        flags: { authorized: true },
        source: issuerKp.publicKey(),
      }),
    );
    builder.addOperation(
      Operation.setTrustLineFlags({
        trustor: user2Kp.publicKey(),
        asset: stellarAsset,
        flags: { authorized: true },
        source: issuerKp.publicKey(),
      }),
    );
    builder.addOperation(
      Operation.payment({
        destination: user2Kp.publicKey(),
        asset: stellarAsset,
        amount: "50.0000000",
      }),
    );
    builder.addOperation(
      Operation.setTrustLineFlags({
        trustor: user1Kp.publicKey(),
        asset: stellarAsset,
        flags: { authorized: false },
        source: issuerKp.publicKey(),
      }),
    );
    builder.addOperation(
      Operation.setTrustLineFlags({
        trustor: user2Kp.publicKey(),
        asset: stellarAsset,
        flags: { authorized: false },
        source: issuerKp.publicKey(),
      }),
    );
    const shapedTx = builder.build();
    shapedTx.sign(user1Kp);

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: shapedTx.toXDR() }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; tx?: string };
    expect(body.status).toBe("success");
    expect(body.tx).toBeDefined();
    expect(body).not.toHaveProperty("code");
  });

  it("returns pending status (HTTP 200) for review_threshold rule", async () => {
    const reviewRule = new ReviewThresholdRule({
      id: "review_threshold",
      above: "100.0000000",
      timeoutMs: 3600000,
      message: "Needs manual review",
      approvedTxHashesPath: join(
        process.cwd(),
        "fixtures/rules/review_threshold/test_approved_hashes.txt",
      ),
    });
    const deps = makeDeps({ rules: [reviewRule] });
    const app = createServerApp(deps);

    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "500.0000000");

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: tx.toXDR() }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timeout?: number; message?: string };
    expect(body.status).toBe("pending");
    expect(body.timeout).toBe(3600000);
    expect(body.message).toContain("Needs manual review");
    expect(body).not.toHaveProperty("code");
  });

  it("returns action_required status (HTTP 200) for allowlist onMiss", async () => {
    const allowlistRule = new AllowlistRule({
      id: "allowlist",
      path: join(process.cwd(), "fixtures/rules/allowlist/test_allowlist.csv"),
      onMiss: {
        action: "action_required",
        url: "https://kyc.example.com/verify",
        message: "KYC required",
        method: "GET",
      },
    });
    const deps = makeDeps({ rules: [allowlistRule] });
    const app = createServerApp(deps);

    const tx = buildPaymentTx(user1Kp, strangerKp.publicKey(), "10.0000000");

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: tx.toXDR() }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      action_url?: string;
      action_method?: string;
      message?: string;
    };
    expect(body.status).toBe("action_required");
    expect(body.action_url).toBe("https://kyc.example.com/verify");
    expect(body.action_method).toBe("GET");
    expect(body).not.toHaveProperty("code");
  });

  it("returns rejected status (HTTP 400) when rule rejects", async () => {
    const perTxRule = new PerTxLimitRule({
      id: "per_tx_limit",
      max: "5.0000000",
    });
    const deps = makeDeps({ rules: [perTxRule] });
    const app = createServerApp(deps);

    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "10.0000000");

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: tx.toXDR() }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error?: string };
    expect(body.status).toBe("rejected");
    expect(body.error).toContain("exceeds limit");
    expect(body).not.toHaveProperty("code");
  });

  it("returns rejected status (HTTP 400) when Horizon upstream fails", async () => {
    const failingProvider = new AccountStateProvider(config.horizon, async () => {
      throw new Error("Horizon network timeout");
    });
    const deps = makeDeps({ accountStateProvider: failingProvider });
    const app = createServerApp(deps);

    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "10.0000000");

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: tx.toXDR() }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error?: string };
    expect(body.status).toBe("rejected");
    expect(body.error).toBe("Compliance check temporarily unavailable. Try again.");
    expect(body).not.toHaveProperty("code");
  });

  it("returns rejected status (HTTP 500) on internal unexpected failure", async () => {
    const brokenSigner = {
      publicKey: () => issuerKp.publicKey(),
      signTransaction: async () => {
        throw new Error("Hardware fault SECRET_XYZ");
      },
    };
    const deps = makeDeps({ signer: brokenSigner });
    const app = createServerApp(deps);

    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "10.0000000");

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: tx.toXDR() }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; error?: string };
    expect(body.status).toBe("rejected");
    expect(body.error).toBe("Request could not be processed.");
    expect(body.error).not.toContain("SECRET_XYZ");
    expect(body).not.toHaveProperty("code");
  });
});
