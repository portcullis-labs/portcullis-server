import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { FeeBumpTransaction, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { loadConfigFile } from "../config/loader.js";
import type { AccountState } from "../domain/types.js";
import { PortcullisError } from "../errors.js";

import { classify } from "../pipeline/classify.js";
import { evaluateAndAggregate } from "../rules/aggregate.js";
import { buildRules } from "../rules/registry.js";
import { MemoryStateStore } from "../state/memory.js";
import { AccountStateProvider } from "../stellar/account-state.js";
import { parseAmountToStroops } from "../stellar/amount.js";

export interface CheckCliArgs {
  configPath: string;
  txInput: string;
  stateInput?: string | undefined;
  jsonOutput: boolean;
  nowMs?: number | undefined;
}

export interface CheckExecutionResult {
  exitCode: 0 | 1 | 2 | 3;
  outcome: "pass" | "reject" | "pending" | "action_required" | "error";
  message: string;
  details?: unknown;
}

export function parseCheckCliArgs(args: string[]): CheckCliArgs {
  let configPath = "";
  let txInput = "";
  let stateInput: string | undefined;
  let jsonOutput = false;
  let nowMs: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      const val = args[++i];
      if (!val) throw new Error("Missing value for --config flag");
      configPath = val;
    } else if (arg === "--tx" || arg === "-t") {
      const val = args[++i];
      if (!val) throw new Error("Missing value for --tx flag");
      txInput = val;
    } else if (arg === "--state" || arg === "-s") {
      const val = args[++i];
      if (!val) throw new Error("Missing value for --state flag");
      stateInput = val;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--now") {
      const val = args[++i];
      if (!val) throw new Error("Missing value for --now flag");
      const parsedNow = Number.isNaN(Number(val)) ? Date.parse(val) : Number(val);
      if (Number.isNaN(parsedNow)) throw new Error(`Invalid date/time for --now: ${val}`);
      nowMs = parsedNow;
    }
  }

  if (!configPath) {
    throw new Error("Missing required --config flag");
  }
  if (!txInput) {
    throw new Error("Missing required --tx flag");
  }

  return { configPath, txInput, stateInput, jsonOutput, nowMs };
}

function resolveInputString(input: string): string {
  if (existsSync(input)) {
    return readFileSync(input, "utf-8").trim();
  }
  return input.trim();
}

export function parseMockState(stateRaw: string): Map<string, AccountState> {
  const parsed = JSON.parse(stateRaw) as Record<
    string,
    {
      balance?: string;
      hasTrustline?: boolean;
      authorized?: boolean;
    }
  >;
  const accountMap = new Map<string, AccountState>();

  for (const [id, val] of Object.entries(parsed)) {
    const balance = val.balance !== undefined ? parseAmountToStroops(val.balance) : 0n;
    accountMap.set(id, {
      id,
      balance,
      hasTrustline: val.hasTrustline ?? true,
      authorized: val.authorized ?? false,
    });
  }

  return accountMap;
}

export async function executeCheck(cliArgs: CheckCliArgs): Promise<CheckExecutionResult> {
  try {
    const config = loadConfigFile(cliArgs.configPath);
    const networkPassphrase = config.network === "pubnet" ? Networks.PUBLIC : Networks.TESTNET;

    const rawTx = resolveInputString(cliArgs.txInput);
    const tx = TransactionBuilder.fromXDR(rawTx, networkPassphrase);
    if (tx instanceof FeeBumpTransaction || "innerTransaction" in tx) {
      throw new PortcullisError(
        "UNSUPPORTED_FEE_BUMP",
        "Fee-bump transaction envelopes are unsupported in v0.1",
      );
    }

    const nowMs = cliArgs.nowMs ?? Date.now();
    const rules = buildRules(config);
    const classified = classify(tx, {
      code: config.asset.code,
      issuer: config.asset.issuer,
    });

    const accountMap = new Map<string, AccountState>();
    if (cliArgs.stateInput) {
      const rawState = resolveInputString(cliArgs.stateInput);
      const mockAccounts = parseMockState(rawState);
      for (const [k, v] of mockAccounts) {
        accountMap.set(k, v);
      }
    } else {
      const provider = new AccountStateProvider(config.horizon);
      const accountsToFetch: string[] = [];
      for (const p of classified.payments) {
        accountsToFetch.push(p.from, p.to);
      }
      const loaded = await provider.load(
        accountsToFetch,
        { code: config.asset.code, issuer: config.asset.issuer },
        nowMs,
      );
      for (const [k, v] of loaded) {
        accountMap.set(k, v);
      }
    }

    const stateStore = new MemoryStateStore();
    const txHash = Buffer.from(tx.hash()).toString("hex").toLowerCase();

    const ruleCtx = {
      txHash,
      payments: classified.payments,
      accounts: accountMap,
      nowMs,
      store: stateStore,
    };

    const aggregated = await evaluateAndAggregate(rules, ruleCtx);

    switch (aggregated.outcome) {
      case "pass":
        return {
          exitCode: 0,
          outcome: "pass",
          message: "Transaction passed all configured compliance rules.",
          details: aggregated,
        };
      case "reject": {
        const rejectRes = aggregated.winningResult as { code?: string; message?: string };
        return {
          exitCode: 1,
          outcome: "reject",
          message: `Transaction rejected: [${rejectRes.code ?? "REJECTED"}] ${rejectRes.message ?? ""}`,
          details: aggregated,
        };
      }
      case "pending": {
        const pendingRes = aggregated.winningResult as { timeoutMs?: number; message?: string };
        return {
          exitCode: 2,
          outcome: "pending",
          message: `Transaction requires pending review (timeout: ${pendingRes.timeoutMs ?? 0}ms): ${pendingRes.message ?? ""}`,
          details: aggregated,
        };
      }
      case "action_required": {
        const actionRes = aggregated.winningResult as { actionUrl?: string; message?: string };
        return {
          exitCode: 2,
          outcome: "action_required",
          message: `Transaction requires user action: ${actionRes.message ?? ""} (${actionRes.actionUrl ?? ""})`,
          details: aggregated,
        };
      }
      default:
        return {
          exitCode: 3,
          outcome: "error",
          message: "Unknown rule outcome",
          details: aggregated,
        };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 3,
      outcome: "error",
      message: `Error evaluating check: ${errorMsg}`,
    };
  }
}

// CLI runner
const isMain = process.argv[1]?.endsWith("check.js") || process.argv[1]?.endsWith("check.ts");
if (isMain) {
  try {
    const args = parseCheckCliArgs(process.argv.slice(2));
    executeCheck(args).then((res) => {
      if (args.jsonOutput) {
        process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      } else {
        process.stdout.write(`[${res.outcome.toUpperCase()}] ${res.message}\n`);
      }
      process.exit(res.exitCode);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ERROR] ${msg}\n`);
    process.exit(3);
  }
}
