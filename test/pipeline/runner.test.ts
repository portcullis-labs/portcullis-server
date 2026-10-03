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
import { runApproval } from "../../src/pipeline/runner.js";
import { AllowlistRule } from "../../src/rules/allowlist.js";
import { PerTxLimitRule } from "../../src/rules/per-tx-limit.js";
import { ReviewThresholdRule } from "../../src/rules/review-threshold.js";
import { LocalSigner } from "../../src/signer/local.js";
import { MemoryStateStore } from "../../src/state/memory.js";
import { AccountStateProvider } from "../../src/stellar/account-state.js";

describe("pipeline runner end-to-end", () => {
  const issuerKp = Keypair.random();
  const user1Kp = Keypair.random();
  const user2Kp = Keypair.random();
  const strangerKp = Keypair.random();

  const testLogPath = join(process.cwd(), "scratch/test-runner-decision.log");

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

  function buildPaymentTx(
    sourceKp: Keypair,
    dest: string,
    amount: string,
    minTime = 1000,
    maxTime = 1200,
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

  it("approves clean naked payment returning revised (200)", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "50.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [],
        signer,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("revised");
    if (result.body.status === "revised") {
      expect(result.body.tx).toBeDefined();
      expect(result.body.message).toContain("Added");
    }

    // Verify reservations were written
    const reservedIn = await store.sumReserved(user2Kp.publicKey(), "in", 1050 * 1000);
    expect(reservedIn).toBe(500000000n);
  });

  it("approves already-composed SEP-8 transaction returning success (200)", async () => {
    const account = new Account(user1Kp.publicKey(), "1000");
    const builder = new TransactionBuilder(account, {
      fee: "300",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 1000, maxTime: 1200 },
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
    const tx = builder.build();
    tx.sign(user1Kp);

    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [],
        signer,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("success");
    if (result.body.status === "success") {
      expect(result.body.tx).toBeDefined();
    }
  });

  it("rejects when transaction exceeds per_tx_limit returning rejected (400)", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "500.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });
    const perTxLimitRule = new PerTxLimitRule({
      id: "per_tx_limit",
      max: "100.0000000",
    });

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [perTxLimitRule],
        signer,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(400);
    expect(result.body.status).toBe("rejected");
    expect(result.body).not.toHaveProperty("code");
    if (result.body.status === "rejected") {
      expect(result.body.error).toContain("exceeds limit");
    }

    // Ensure no reservation was written
    const reserved = await store.sumReserved(user2Kp.publicKey(), "in", 1050 * 1000);
    expect(reserved).toBe(0n);
  });

  it("returns action_required (200) on allowlist miss with action_url", async () => {
    const tx = buildPaymentTx(user1Kp, strangerKp.publicKey(), "10.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

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

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [allowlistRule],
        signer,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("action_required");
    if (result.body.status === "action_required") {
      expect(result.body.action_url).toBe("https://kyc.example.com/verify");
      expect(result.body.action_method).toBe("GET");
    }
  });

  it("returns pending (200) for review_threshold above limit and unapproved hash", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "2000.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const reviewRule = new ReviewThresholdRule({
      id: "review_threshold",
      above: "1000.0000000",
      timeoutMs: 3600000,
      message: "Manual review required",
      approvedTxHashesPath: join(
        process.cwd(),
        "fixtures/rules/review_threshold/test_approved_hashes.txt",
      ),
    });

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [reviewRule],
        signer,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("pending");
    if (result.body.status === "pending") {
      expect(result.body.timeout).toBe(3600000);
      expect(result.body.message).toContain("Manual review required");
    }
  });

  it("rejects bad requester signature returning rejected (400)", async () => {
    const attackerKp = Keypair.random();
    const account = new Account(user1Kp.publicKey(), "1000");
    const builder = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 1000, maxTime: 1200 },
    });
    builder.addOperation(
      Operation.payment({
        destination: user2Kp.publicKey(),
        asset: stellarAsset,
        amount: "50.0000000",
      }),
    );
    const badTx = builder.build();
    badTx.sign(attackerKp); // Signed by attacker, not source user1Kp

    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const result = await runApproval(
      { tx: badTx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [],
        signer,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(400);
    expect(result.body.status).toBe("rejected");
    expect(result.body).not.toHaveProperty("code");
    if (result.body.status === "rejected") {
      expect(result.body.error).toContain("Transaction lacks a valid signature");
    }
  });

  it("rejects expired timebound returning rejected (400)", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "50.0000000", 1000, 1100);
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1200 * 1000 }, // now is past maxTime (1100)
      {
        config,
        rules: [],
        signer,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(400);
    expect(result.body.status).toBe("rejected");
    expect(result.body).not.toHaveProperty("code");
    if (result.body.status === "rejected") {
      expect(result.body.error).toContain("Transaction timebound has expired");
    }
  });

  it("returns rejected (400) when Horizon account provider throws (upstream failure) without signing", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "50.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const failingFetch: typeof fetch = async () => {
      throw new Error("Horizon offline or timeout");
    };
    const failingAccountProvider = new AccountStateProvider(config.horizon, failingFetch);

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [],
        signer,
        stateStore: store,
        accountStateProvider: failingAccountProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(400);
    expect(result.body.status).toBe("rejected");
    expect(result.body).not.toHaveProperty("code");
    if (result.body.status === "rejected") {
      expect(result.body.error).toBe("Compliance check temporarily unavailable. Try again.");
    }
  });

  it("sanitizes internal errors returning generic 500 without leaking secrets", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "50.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const throwingSigner = {
      publicKey: () => issuerKp.publicKey(),
      signTransaction: async () => {
        throw new Error("Signer internal failure: TEST_SECRET_VALUE_123");
      },
    };

    let reportedInternalError: unknown = null;

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [],
        signer: throwingSigner,
        stateStore: store,
        accountStateProvider,
        decisionLogger: logger,
        onInternalError: (err) => {
          reportedInternalError = err;
        },
      },
    );

    expect(result.httpStatus).toBe(500);
    expect(result.body.status).toBe("rejected");
    expect(result.body).not.toHaveProperty("code");
    if (result.body.status === "rejected") {
      expect(result.body.error).toBe("Request could not be processed.");
      expect(result.body.error).not.toContain("TEST_SECRET_VALUE_123");
    }

    // onInternalError received the real underlying error
    expect(reportedInternalError).toBeInstanceOf(Error);
    expect((reportedInternalError as Error).message).toContain("TEST_SECRET_VALUE_123");
  });

  it("rejects when payment source has no trustline (400 NO_TRUSTLINE)", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "50.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const noSourceTrustProvider = new AccountStateProvider(config.horizon, async (input) => {
      const url = String(input);
      const isSource = url.includes(user1Kp.publicKey());
      return new Response(
        JSON.stringify({
          id: isSource ? user1Kp.publicKey() : user2Kp.publicKey(),
          balances: isSource
            ? [] // No trustline on source
            : [
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
    });

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [],
        signer,
        stateStore: store,
        accountStateProvider: noSourceTrustProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(400);
    expect(result.body.status).toBe("rejected");
    expect(result.body).not.toHaveProperty("code");
    if (result.body.status === "rejected") {
      expect(result.body.error).toContain("Payment source account");
      expect(result.body.error).toContain(user1Kp.publicKey());
      expect(result.body.error).toContain("does not have a trustline");
    }
  });

  it("rejects when payment destination has no trustline (400 NO_TRUSTLINE)", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "50.0000000");
    const store = new MemoryStateStore();
    const logger = new DecisionLogger({ path: testLogPath, includeXdr: false });

    const noDestTrustProvider = new AccountStateProvider(config.horizon, async (input) => {
      const url = String(input);
      const isDest = url.includes(user2Kp.publicKey());
      return new Response(
        JSON.stringify({
          id: isDest ? user2Kp.publicKey() : user1Kp.publicKey(),
          balances: isDest
            ? [] // No trustline on destination
            : [
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
    });

    const result = await runApproval(
      { tx: tx.toXDR(), nowMs: 1050 * 1000 },
      {
        config,
        rules: [],
        signer,
        stateStore: store,
        accountStateProvider: noDestTrustProvider,
        decisionLogger: logger,
      },
    );

    expect(result.httpStatus).toBe(400);
    expect(result.body.status).toBe("rejected");
    expect(result.body).not.toHaveProperty("code");
    if (result.body.status === "rejected") {
      expect(result.body.error).toContain("Payment destination account");
      expect(result.body.error).toContain(user2Kp.publicKey());
      expect(result.body.error).toContain("does not have a trustline");
    }
  });
});
