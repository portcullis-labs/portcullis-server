import { describe, expect, it } from "vitest";
import { createServerApp } from "../../src/server/app.js";
import { MAX_BODY_BYTES, parseTxApproveRequest } from "../../src/server/parse-request.js";

describe("POST /tx_approve request parsing", () => {
  it("parses valid JSON request containing tx string", async () => {
    const app = createServerApp();
    app.post("/tx_approve", async (c) => {
      const parsed = await parseTxApproveRequest(c);
      if (!parsed.success) {
        return c.json({ status: "rejected", error: parsed.error }, parsed.httpStatus);
      }
      return c.json({ status: "success", tx: parsed.tx });
    });

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: "AAAA_VALID_TX_XDR_STRING" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; tx: string };
    expect(body.status).toBe("success");
    expect(body.tx).toBe("AAAA_VALID_TX_XDR_STRING");
  });

  it("parses valid form-urlencoded request containing tx string", async () => {
    const app = createServerApp();
    app.post("/tx_approve", async (c) => {
      const parsed = await parseTxApproveRequest(c);
      if (!parsed.success) {
        return c.json({ status: "rejected", error: parsed.error }, parsed.httpStatus);
      }
      return c.json({ status: "success", tx: parsed.tx });
    });

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "tx=AAAA_FORM_TX_XDR_STRING",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; tx: string };
    expect(body.status).toBe("success");
    expect(body.tx).toBe("AAAA_FORM_TX_XDR_STRING");
  });

  it("rejects request with missing tx parameter in JSON", async () => {
    const app = createServerApp();
    app.post("/tx_approve", async (c) => {
      const parsed = await parseTxApproveRequest(c);
      if (!parsed.success) {
        return c.json({ status: "rejected", error: parsed.error }, parsed.httpStatus);
      }
      return c.json({ status: "success" });
    });

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ other: "field" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("rejected");
    expect(body.error).toContain("Missing or invalid 'tx' parameter");
  });

  it("rejects request with malformed JSON body", async () => {
    const app = createServerApp();
    app.post("/tx_approve", async (c) => {
      const parsed = await parseTxApproveRequest(c);
      if (!parsed.success) {
        return c.json({ status: "rejected", error: parsed.error }, parsed.httpStatus);
      }
      return c.json({ status: "success" });
    });

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("rejected");
    expect(body.error).toContain("Malformed JSON");
  });

  it("rejects request with unsupported Content-Type", async () => {
    const app = createServerApp();
    app.post("/tx_approve", async (c) => {
      const parsed = await parseTxApproveRequest(c);
      if (!parsed.success) {
        return c.json({ status: "rejected", error: parsed.error }, parsed.httpStatus);
      }
      return c.json({ status: "success" });
    });

    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "AAAA_RAW_TX",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("rejected");
    expect(body.error).toContain("Unsupported Content-Type");
  });

  it("rejects payload exceeding 64KB with HTTP 413", async () => {
    const app = createServerApp();
    app.post("/tx_approve", async (c) => {
      const parsed = await parseTxApproveRequest(c);
      if (!parsed.success) {
        return c.json({ status: "rejected", error: parsed.error }, parsed.httpStatus);
      }
      return c.json({ status: "success" });
    });

    const oversizedTx = "A".repeat(MAX_BODY_BYTES + 100);
    const res = await app.request("/tx_approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: oversizedTx }),
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("rejected");
    expect(body.error).toContain("exceeds maximum allowed size");
  });

  it("returns 404 JSON for unknown routes", async () => {
    const app = createServerApp();
    const res = await app.request("/unknown_route", { method: "GET" });
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not Found");
  });
});
