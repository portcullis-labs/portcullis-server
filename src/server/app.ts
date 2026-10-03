import { Hono } from "hono";
import type { ApprovalDependencies } from "../pipeline/runner.js";
import { handleHealth } from "./routes/health.js";
import { handleStellarToml } from "./routes/stellar-toml.js";
import { handleTxApprove } from "./routes/tx-approve.js";

export function createServerApp(deps?: ApprovalDependencies) {
  const app = new Hono();

  // CORS middleware: set Access-Control-Allow-Origin: * on all responses and handle OPTIONS preflight
  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      return c.body(null, 204);
    }
    await next();
    c.header("Access-Control-Allow-Origin", "*");
  });

  if (deps) {
    app.post("/tx_approve", (c) => handleTxApprove(c, deps));
    app.get("/.well-known/stellar.toml", (c) => handleStellarToml(c, deps.config));
  }

  app.get("/health", (c) => handleHealth(c));

  // Not Found handler: returns 404 JSON with CORS
  app.notFound((c) => {
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ error: "Not Found" }, 404);
  });

  // Error handler: returns 500 JSON with CORS
  app.onError((_err, c) => {
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ status: "rejected", error: "Request could not be processed." }, 500);
  });

  return app;
}
