import process from "node:process";
import { serve } from "@hono/node-server";
import { verifyIssuerAccount } from "../config/issuer-check.js";
import { loadConfigFile } from "../config/loader.js";
import { DecisionLogger } from "../log/logger.js";
import { logError, logInfo, logWarn } from "../log/stderr.js";
import { AccountLockManager } from "../pipeline/lock.js";
import type { ApprovalDependencies } from "../pipeline/runner.js";
import { buildRules } from "../rules/registry.js";
import { LocalSigner } from "../signer/local.js";
import { MemoryStateStore } from "../state/memory.js";
import { AccountStateProvider } from "../stellar/account-state.js";
import { VERSION } from "../version.js";
import { createServerApp } from "./app.js";

export interface ServerCliArgs {
  configPath: string;
  skipIssuerCheck: boolean;
  portOverride?: number | undefined;
}

export function parseCliArgs(args: string[]): ServerCliArgs {
  let configPath = "./portcullis.yaml";
  let skipIssuerCheck = false;
  let portOverride: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      const val = args[++i];
      if (!val) {
        throw new Error("Missing value for --config flag");
      }
      configPath = val;
    } else if (arg === "--skip-issuer-check") {
      skipIssuerCheck = true;
    } else if (arg === "--port" || arg === "-p") {
      const val = args[++i];
      if (!val) {
        throw new Error("Missing value for --port flag");
      }
      const p = Number.parseInt(val, 10);
      if (Number.isNaN(p) || p < 1 || p > 65535) {
        throw new Error(`Invalid port number: ${val}`);
      }
      portOverride = p;
    }
  }

  return { configPath, skipIssuerCheck, portOverride };
}

export async function bootstrapServer(cliArgs: ServerCliArgs) {
  logInfo(`Starting Portcullis Server v${VERSION}...`);
  logInfo(`Loading configuration from: ${cliArgs.configPath}`);

  const config = loadConfigFile(cliArgs.configPath);

  const secretKey = process.env[config.signer.secretEnv];
  if (!secretKey) {
    throw new Error(
      `Signer secret environment variable "${config.signer.secretEnv}" is not set or empty`,
    );
  }

  const signer = new LocalSigner(secretKey, config.asset.issuer);
  const rules = buildRules(config);
  const lockManager = new AccountLockManager();
  const stateStore = new MemoryStateStore();
  const accountStateProvider = new AccountStateProvider(config.horizon);
  const decisionLogger = new DecisionLogger(config.log);

  logInfo(`Verifying issuer account ${config.asset.issuer} on Horizon (${config.horizon.url})...`);
  await verifyIssuerAccount({
    issuer: config.asset.issuer,
    horizon: config.horizon,
    publicBaseUrl: config.server.publicBaseUrl,
    skipIssuerCheck: cliArgs.skipIssuerCheck,
    onWarn: (msg) => logWarn(msg),
  });

  const deps: ApprovalDependencies = {
    config,
    rules,
    signer,
    stateStore,
    accountStateProvider,
    decisionLogger,
    lockManager,
    onInternalError: (err: unknown) => {
      logError("Internal approval pipeline error", err);
    },
  };

  const app = createServerApp(deps);
  const port = cliArgs.portOverride ?? config.server.port;

  const server = serve({ fetch: app.fetch, port }, (info) => {
    logInfo(`Portcullis Server listening on http://localhost:${info.port}`);
    logInfo(`Public Base URL: ${config.server.publicBaseUrl}`);
    logInfo(`Managing regulated asset: ${config.asset.code}:${config.asset.issuer}`);
    logInfo(`Configured rules (${rules.length}): ${rules.map((r) => r.id).join(", ")}`);
  });

  const shutdown = () => {
    logInfo("Received shutdown signal. Stopping HTTP server...");
    server.close((err) => {
      if (err) {
        logError("Error during server shutdown", err);
        process.exit(1);
      }
      logInfo("Server stopped cleanly. Goodbye.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, config, deps };
}

// Auto-start if executed directly as main script
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  try {
    const parsedArgs = parseCliArgs(process.argv.slice(2));
    bootstrapServer(parsedArgs).catch((err) => {
      logError("Fatal error during server startup", err);
      process.exit(1);
    });
  } catch (err) {
    logError("CLI argument parsing error", err);
    process.exit(1);
  }
}
