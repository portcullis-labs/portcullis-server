import type { Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { PortcullisConfig } from "../../src/config/schema.js";
import type { ApprovalDependencies } from "../../src/pipeline/runner.js";

import { createServerApp } from "../../src/server/app.js";

import { generateStellarToml } from "../../src/server/routes/stellar-toml.js";

describe("GET /.well-known/stellar.toml endpoint", () => {
  const sampleConfig: PortcullisConfig = {
    network: "testnet",
    asset: {
      code: "GOAT",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
    approval: {
      maxTimeWindowSeconds: 300,
      maxFeePerOperationStroops: "10000",
      maxOperations: 10,
    },
    horizon: {
      url: "https://horizon-testnet.stellar.org",
      timeoutMs: 3000,
      cacheTtlSeconds: 5,
    },
    signer: {
      type: "local",
      secretEnv: "ISSUER_SECRET",
    },
    server: {
      port: 8080,
      publicBaseUrl: "https://example.org",
    },
    log: {
      path: "./decisions.jsonl",
      includeXdr: false,
    },
    rules: [
      { id: "per_tx_limit", max: "1000.0000000" },
      { id: "holding_cap", max: "50000.0000000" },
      {
        id: "allowlist",
        path: "./allowlist.csv",
        onMiss: {
          action: "action_required",
          url: "https://example.org/verify",
          method: "GET",
          message: "Complete verification",
        },
      },
      { id: "denylist", path: "./denylist.csv" },
      { id: "lockup", until: "2027-01-01T00:00:00Z", applyTo: ["source"], exempt: [] },
      {
        id: "review_threshold",
        above: "5000.0000000",
        timeoutMs: 60000,
        message: "Manual review required",
        approvedTxHashesPath: "./approved-txs.txt",
      },
    ],
  };

  it("generates valid stellar.toml string from config", () => {
    const toml = generateStellarToml(sampleConfig);

    expect(toml).toContain("[[CURRENCIES]]");
    expect(toml).toContain('code = "GOAT"');
    expect(toml).toContain('issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"');
    expect(toml).toContain("regulated = true");
    expect(toml).toContain('approval_server = "https://example.org/tx_approve"');
    expect(toml).toContain("Per-transaction limit: 1000.0000000");
    expect(toml).toContain("Holding cap: 50000.0000000");
    expect(toml).toContain("Allowlist required (Verification: https://example.org/verify)");
    expect(toml).toContain("Denylist enforced");
    expect(toml).toContain("Lockup until 2027-01-01T00:00:00Z");
    expect(toml).toContain("Manual review threshold above 5000.0000000");
  });

  it("serves GET /.well-known/stellar.toml with text/plain and CORS header", async () => {
    const deps = {
      config: sampleConfig,
      rules: [],
      signer: {
        publicKey: () => sampleConfig.asset.issuer,
        signTransaction: async (tx: Transaction) => tx,
      },

      stateStore: {} as unknown as ApprovalDependencies["stateStore"],
      accountStateProvider: {} as unknown as ApprovalDependencies["accountStateProvider"],
      decisionLogger: {} as unknown as ApprovalDependencies["decisionLogger"],
      lockManager: {} as unknown as ApprovalDependencies["lockManager"],
    };
    const app = createServerApp(deps);

    const res = await app.request("/.well-known/stellar.toml", { method: "GET" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Content-Type")).toContain("text/plain");

    const text = await res.text();
    expect(text).toContain('code = "GOAT"');
    expect(text).toContain('approval_server = "https://example.org/tx_approve"');
  });
});
