import { describe, expect, it, vi } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import { AccountStateProvider } from "../../src/stellar/account-state.js";

describe("AccountStateProvider", () => {
  const asset = {
    code: "GOAT",
    issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
  };
  const accountId = "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX";

  it("loads existing account with authorized regulated asset trustline", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: accountId,
        balances: [
          {
            asset_type: "credit_alphanumeric4",
            asset_code: "GOAT",
            asset_issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
            balance: "123.4567890",
            is_authorized: true,
          },
        ],
      }),
    } as unknown as Response);

    const provider = new AccountStateProvider(
      {
        url: "https://horizon-testnet.stellar.org",
        timeoutMs: 3000,
        cacheTtlSeconds: 5,
      },
      mockFetch,
    );

    const states = await provider.load([accountId], asset, 1000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const state = states.get(accountId);
    expect(state).toBeDefined();
    expect(state?.balance).toBe(1234567890n);
    expect(state?.hasTrustline).toBe(true);
    expect(state?.authorized).toBe(true);
  });

  it("handles existing account without regulated asset trustline", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: accountId,
        balances: [{ asset_type: "native", balance: "50.0000000" }],
      }),
    } as unknown as Response);

    const provider = new AccountStateProvider(
      {
        url: "https://horizon-testnet.stellar.org",
        timeoutMs: 3000,
        cacheTtlSeconds: 5,
      },
      mockFetch,
    );

    const states = await provider.load([accountId], asset, 1000);
    const state = states.get(accountId);
    expect(state?.balance).toBe(0n);
    expect(state?.hasTrustline).toBe(false);
    expect(state?.authorized).toBe(false);
  });

  it("returns zero balance and no trustline for 404 non-existent account", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as unknown as Response);

    const provider = new AccountStateProvider(
      {
        url: "https://horizon-testnet.stellar.org",
        timeoutMs: 3000,
        cacheTtlSeconds: 5,
      },
      mockFetch,
    );

    const states = await provider.load([accountId], asset, 1000);
    const state = states.get(accountId);
    expect(state?.balance).toBe(0n);
    expect(state?.hasTrustline).toBe(false);
    expect(state?.authorized).toBe(false);
  });

  it("throws UPSTREAM_UNAVAILABLE on Horizon 500 error or network failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    const provider = new AccountStateProvider(
      {
        url: "https://horizon-testnet.stellar.org",
        timeoutMs: 3000,
        cacheTtlSeconds: 5,
      },
      mockFetch,
    );

    await expect(provider.load([accountId], asset, 1000)).rejects.toThrow(PortcullisError);
    try {
      await provider.load([accountId], asset, 1000);
    } catch (err) {
      expect((err as PortcullisError).code).toBe("UPSTREAM_UNAVAILABLE");
      expect((err as PortcullisError).httpStatus).toBe(500);
    }
  });

  it("throws UPSTREAM_UNAVAILABLE on request timeout / abort", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("The operation was aborted"));

    const provider = new AccountStateProvider(
      {
        url: "https://horizon-testnet.stellar.org",
        timeoutMs: 10,
        cacheTtlSeconds: 5,
      },
      mockFetch,
    );

    await expect(provider.load([accountId], asset, 1000)).rejects.toThrow(PortcullisError);
  });

  it("serves cached account state within cacheTtlSeconds and refreshes after expiry", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: accountId,
        balances: [
          {
            asset_type: "credit_alphanumeric4",
            asset_code: "GOAT",
            asset_issuer: "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW",
            balance: "100.0000000",
            is_authorized: true,
          },
        ],
      }),
    } as unknown as Response);

    const provider = new AccountStateProvider(
      {
        url: "https://horizon-testnet.stellar.org",
        timeoutMs: 3000,
        cacheTtlSeconds: 5,
      },
      mockFetch,
    );

    // Initial load at t = 1000ms
    await provider.load([accountId], asset, 1000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Load at t = 3000ms (within 5s TTL) -> cache hit, fetch not called
    const cachedStates = await provider.load([accountId], asset, 3000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(cachedStates.get(accountId)?.balance).toBe(100_0000000n);

    // Load at t = 7000ms (6s later, expired) -> cache miss, fetch called again
    await provider.load([accountId], asset, 7000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
