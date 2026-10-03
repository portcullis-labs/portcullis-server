import type { AccountState, AssetId } from "../domain/types.js";
import { PortcullisError } from "../errors.js";
import { parseAmountToStroops } from "./amount.js";

export interface AccountStateProviderConfig {
  url: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
}

interface CacheEntry {
  state: AccountState;
  cachedAtMs: number;
}

interface HorizonBalanceLine {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance?: string;
  is_authorized?: boolean;
}

interface HorizonAccountResponse {
  id: string;
  balances: HorizonBalanceLine[];
}

export class AccountStateProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly customFetch?: typeof fetch | undefined;

  constructor(
    readonly config: AccountStateProviderConfig,
    customFetch?: typeof fetch,
  ) {
    this.customFetch = customFetch;
  }

  private getEffectiveFetch(): typeof fetch {
    return this.customFetch ?? fetch;
  }

  private getCached(accountId: string, nowMs: number): AccountState | null {
    if (this.config.cacheTtlSeconds <= 0) {
      return null;
    }
    const entry = this.cache.get(accountId);
    if (!entry) {
      return null;
    }
    if (nowMs - entry.cachedAtMs > this.config.cacheTtlSeconds * 1000) {
      this.cache.delete(accountId);
      return null;
    }
    return entry.state;
  }

  private setCache(accountId: string, state: AccountState, nowMs: number): void {
    if (this.config.cacheTtlSeconds > 0) {
      this.cache.set(accountId, { state, cachedAtMs: nowMs });
    }
  }

  async loadAccount(
    accountId: string,
    asset: AssetId,
    nowMs: number = Date.now(),
  ): Promise<AccountState> {
    const cached = this.getCached(accountId, nowMs);
    if (cached) {
      return cached;
    }

    const baseUrl = this.config.url.replace(/\/+$/, "");
    const url = `${baseUrl}/accounts/${accountId}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let res: Response;
    try {
      res = await this.getEffectiveFetch()(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      throw new PortcullisError(
        "UPSTREAM_UNAVAILABLE",
        `Compliance check temporarily unavailable. Horizon request failed or timed out: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status === 404) {
      const nonExistent: AccountState = {
        id: accountId,
        balance: 0n,
        hasTrustline: false,
        authorized: false,
      };
      this.setCache(accountId, nonExistent, nowMs);
      return nonExistent;
    }

    if (!res.ok) {
      throw new PortcullisError(
        "UPSTREAM_UNAVAILABLE",
        `Compliance check temporarily unavailable. Horizon returned status ${res.status}`,
        500,
      );
    }

    let data: HorizonAccountResponse;
    try {
      data = (await res.json()) as HorizonAccountResponse;
    } catch (err) {
      throw new PortcullisError(
        "UPSTREAM_UNAVAILABLE",
        `Compliance check temporarily unavailable. Failed to parse Horizon response: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    let targetBalance: AccountState = {
      id: accountId,
      balance: 0n,
      hasTrustline: false,
      authorized: false,
    };

    if (Array.isArray(data.balances)) {
      for (const b of data.balances) {
        if (
          (b.asset_type === "credit_alphanumeric4" || b.asset_type === "credit_alphanumeric12") &&
          b.asset_code === asset.code &&
          b.asset_issuer === asset.issuer
        ) {
          const rawAmount = b.balance ?? "0";
          targetBalance = {
            id: accountId,
            balance: parseAmountToStroops(rawAmount),
            hasTrustline: true,
            authorized: b.is_authorized === true,
          };
          break;
        }
      }
    }

    this.setCache(accountId, targetBalance, nowMs);
    return targetBalance;
  }

  /**
   * Loads account states for all unique account IDs.
   */
  async load(
    accountIds: string[],
    asset: AssetId,
    nowMs: number = Date.now(),
  ): Promise<Map<string, AccountState>> {
    const uniqueIds = Array.from(new Set(accountIds));
    const states = await Promise.all(uniqueIds.map((id) => this.loadAccount(id, asset, nowMs)));

    const result = new Map<string, AccountState>();
    for (const st of states) {
      result.set(st.id, st);
    }
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
