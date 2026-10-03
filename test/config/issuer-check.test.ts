import { describe, expect, it, vi } from "vitest";
import { verifyIssuerAccount } from "../../src/config/issuer-check.js";
import type { HorizonConfig } from "../../src/config/schema.js";

describe("issuer startup check", () => {
  const testIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const horizonConfig: HorizonConfig = {
    url: "https://horizon-testnet.stellar.org",
    timeoutMs: 2000,
    cacheTtlSeconds: 5,
  };

  it("passes when issuer account has both auth_required and auth_revocable set", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          id: testIssuer,
          flags: {
            auth_required: true,
            auth_revocable: true,
          },
          home_domain: "example.org",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    await expect(
      verifyIssuerAccount({
        issuer: testIssuer,
        horizon: horizonConfig,
        publicBaseUrl: "https://example.org",
        fetchFn: mockFetch,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when auth_required is false or missing", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          id: testIssuer,
          flags: {
            auth_required: false,
            auth_revocable: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    await expect(
      verifyIssuerAccount({
        issuer: testIssuer,
        horizon: horizonConfig,
        fetchFn: mockFetch,
      }),
    ).rejects.toThrow("Authorization Required");
  });

  it("throws when auth_revocable is false or missing", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          id: testIssuer,
          flags: {
            auth_required: true,
            auth_revocable: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    await expect(
      verifyIssuerAccount({
        issuer: testIssuer,
        horizon: horizonConfig,
        fetchFn: mockFetch,
      }),
    ).rejects.toThrow("Authorization Revocable");
  });

  it("throws when issuer account is not found (404)", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ title: "Resource Missing" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(
      verifyIssuerAccount({
        issuer: testIssuer,
        horizon: horizonConfig,
        fetchFn: mockFetch,
      }),
    ).rejects.toThrow("does not exist on Horizon");
  });

  it("emits a warning when home_domain does not match publicBaseUrl hostname", async () => {
    const onWarn = vi.fn();
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          id: testIssuer,
          flags: {
            auth_required: true,
            auth_revocable: true,
          },
          home_domain: "other-domain.com",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    await verifyIssuerAccount({
      issuer: testIssuer,
      horizon: horizonConfig,
      publicBaseUrl: "https://example.org",
      fetchFn: mockFetch,
      onWarn,
    });

    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]?.[0]).toContain("home_domain");
    expect(onWarn.mock.calls[0]?.[0]).toContain("other-domain.com");
  });

  it("skips check when skipIssuerCheck is true even if fetch fails", async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error("Horizon completely unreachable");
    };

    await expect(
      verifyIssuerAccount({
        issuer: testIssuer,
        horizon: horizonConfig,
        skipIssuerCheck: true,
        fetchFn: mockFetch,
      }),
    ).resolves.toBeUndefined();
  });
});
