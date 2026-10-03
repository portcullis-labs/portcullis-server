import { writeFileSync } from "node:fs";
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
import { executeCheck, parseCheckCliArgs } from "../../src/cli/check.js";

describe("check CLI command", () => {
  const issuerKp = Keypair.random();
  const user1Kp = Keypair.random();
  const user2Kp = Keypair.random();
  const strangerKp = Keypair.random();

  const stellarAsset = new Asset("USDC", issuerKp.publicKey());

  const tempConfigPath = join(process.cwd(), "scratch/test_check_config.yaml");
  const tempAllowlistPath = join(process.cwd(), "scratch/test_check_allowlist.csv");
  const tempReviewPath = join(process.cwd(), "scratch/test_check_review_hashes.txt");

  writeFileSync(tempAllowlistPath, `${user1Kp.publicKey()}\n${user2Kp.publicKey()}\n`, "utf-8");
  writeFileSync(tempReviewPath, "", "utf-8");

  const yamlConfig = `
network: testnet
asset:
  code: USDC
  issuer: ${issuerKp.publicKey()}
approval:
  maxTimeWindowSeconds: 300
  maxFeePerOperationStroops: "1000"
  maxOperations: 10
horizon:
  url: https://horizon-testnet.stellar.org
  timeoutMs: 5000
  cacheTtlSeconds: 60
signer:
  type: local
  secretEnv: ISSUER_SECRET
server:
  port: 3000
  publicBaseUrl: http://127.0.0.1:3000
log:
  path: scratch/test_check_decisions.jsonl
  includeXdr: false
rules:
  - id: per_tx_limit
    max: "100.0000000"
  - id: allowlist
    path: ${tempAllowlistPath}
    onMiss:
      action: action_required
      url: https://kyc.example.com
      method: GET
      message: KYC Required
  - id: review_threshold
    above: "50.0000000"
    timeoutMs: 60000
    message: Manual review required
    approvedTxHashesPath: ${tempReviewPath}
`;
  writeFileSync(tempConfigPath, yamlConfig, "utf-8");

  function buildPaymentTx(sourceKp: Keypair, dest: string, amount: string) {
    const account = new Account(sourceKp.publicKey(), "1000");
    const builder = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 120 },
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

  const defaultMockState = JSON.stringify({
    [user1Kp.publicKey()]: {
      balance: "1000.0000000",
      hasTrustline: true,
      authorized: false,
    },
    [user2Kp.publicKey()]: {
      balance: "500.0000000",
      hasTrustline: true,
      authorized: false,
    },
    [strangerKp.publicKey()]: {
      balance: "0.0000000",
      hasTrustline: true,
      authorized: false,
    },
  });

  it("returns exitCode 0 (pass) for compliant transaction", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "25.0000000");
    const result = await executeCheck({
      configPath: tempConfigPath,
      txInput: tx.toXDR(),
      stateInput: defaultMockState,
      jsonOutput: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.outcome).toBe("pass");
    expect(result.message).toContain("passed");
  });

  it("returns exitCode 1 (reject) when transaction violates per_tx_limit", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "150.0000000");
    const result = await executeCheck({
      configPath: tempConfigPath,
      txInput: tx.toXDR(),
      stateInput: defaultMockState,
      jsonOutput: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcome).toBe("reject");
    expect(result.message).toContain("PER_TX_LIMIT");
  });

  it("returns exitCode 2 (action_required) when allowlist misses unallowlisted stranger", async () => {
    const tx = buildPaymentTx(user1Kp, strangerKp.publicKey(), "10.0000000");
    const result = await executeCheck({
      configPath: tempConfigPath,
      txInput: tx.toXDR(),
      stateInput: defaultMockState,
      jsonOutput: false,
    });

    expect(result.exitCode).toBe(2);
    expect(result.outcome).toBe("action_required");
    expect(result.message).toContain("https://kyc.example.com");
  });

  it("returns exitCode 2 (pending) when review_threshold is exceeded", async () => {
    const tx = buildPaymentTx(user1Kp, user2Kp.publicKey(), "75.0000000");
    const result = await executeCheck({
      configPath: tempConfigPath,
      txInput: tx.toXDR(),
      stateInput: defaultMockState,
      jsonOutput: false,
    });

    expect(result.exitCode).toBe(2);
    expect(result.outcome).toBe("pending");
    expect(result.message).toContain("Manual review required");
  });

  it("returns exitCode 3 (error) on invalid config path or invalid XDR", async () => {
    const result = await executeCheck({
      configPath: "/nonexistent/config.yaml",
      txInput: "INVALID_XDR",
      jsonOutput: false,
    });

    expect(result.exitCode).toBe(3);
    expect(result.outcome).toBe("error");
    expect(result.message).toContain("Error evaluating check");
  });

  it("parses CLI flags correctly", () => {
    const parsed = parseCheckCliArgs([
      "--config",
      "./test.yaml",
      "--tx",
      "AAAA...",
      "--state",
      '{"G...":{}}',
      "--json",
      "--now",
      "1700000000000",
    ]);

    expect(parsed.configPath).toBe("./test.yaml");
    expect(parsed.txInput).toBe("AAAA...");
    expect(parsed.stateInput).toBe('{"G...":{}}');
    expect(parsed.jsonOutput).toBe(true);
    expect(parsed.nowMs).toBe(1700000000000);
  });
});
