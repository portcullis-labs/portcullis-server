import { describe, expect, it } from "vitest";
import { createServerApp } from "../../src/server/app.js";

describe("CORS and preflight middleware", () => {
  it("answers OPTIONS preflight requests with CORS headers and 204", async () => {
    const app = createServerApp();
    app.post("/tx_approve", (c) => c.json({ status: "success" }));

    const res = await app.request("/tx_approve", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example-wallet.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  it("adds Access-Control-Allow-Origin: * to GET and POST responses", async () => {
    const app = createServerApp();
    app.get("/health", (c) => c.json({ ok: true }));
    app.post("/tx_approve", (c) => c.json({ status: "success" }));

    const getRes = await app.request("/health", { method: "GET" });
    expect(getRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const postRes = await app.request("/tx_approve", { method: "POST" });
    expect(postRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
