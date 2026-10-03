import { describe, expect, it } from "vitest";
import { createServerApp } from "../../src/server/app.js";
import { VERSION } from "../../src/version.js";

describe("GET /health endpoint", () => {
  it("returns ok: true and the current package version", async () => {
    const app = createServerApp();
    const res = await app.request("/health", { method: "GET" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(VERSION);
  });
});
