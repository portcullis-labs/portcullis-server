import type { HorizonConfig } from "./schema.js";

export interface IssuerCheckOptions {
  issuer: string;
  horizon: HorizonConfig;
  publicBaseUrl?: string;
  skipIssuerCheck?: boolean;
  fetchFn?: typeof fetch;
  onWarn?: (message: string) => void;
}

export interface HorizonAccountFlags {
  auth_required?: boolean;
  auth_revocable?: boolean;
  auth_immutable?: boolean;
  auth_clawback_enabled?: boolean;
}

export interface HorizonAccountResponse {
  id: string;
  flags?: HorizonAccountFlags;
  home_domain?: string;
}

/**
 * Checks the issuer account on Horizon at startup:
 * 1. Ensures the issuer account exists.
 * 2. Enforces that both auth_required and auth_revocable are set (true).
 * 3. Warns if home_domain does not match publicBaseUrl hostname.
 */
export async function verifyIssuerAccount(options: IssuerCheckOptions): Promise<void> {
  if (options.skipIssuerCheck) {
    return;
  }

  const customFetch = options.fetchFn ?? fetch;
  const horizonUrl = options.horizon.url.replace(/\/+$/, "");
  const accountUrl = `${horizonUrl}/accounts/${options.issuer}`;

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.horizon.timeoutMs);
    try {
      response = await customFetch(accountUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new Error(
      `Failed to contact Horizon for issuer check at ${accountUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (response.status === 404) {
    throw new Error(`Issuer account ${options.issuer} does not exist on Horizon (${horizonUrl})`);
  }

  if (!response.ok) {
    throw new Error(
      `Horizon returned HTTP ${response.status} when querying issuer account ${options.issuer}`,
    );
  }

  const account = (await response.json()) as HorizonAccountResponse;

  if (!account.flags?.auth_required) {
    throw new Error(
      `Issuer account ${options.issuer} does not have Authorization Required (auth_required: true) set.`,
    );
  }

  if (!account.flags?.auth_revocable) {
    throw new Error(
      `Issuer account ${options.issuer} does not have Authorization Revocable (auth_revocable: true) set.`,
    );
  }

  if (options.publicBaseUrl && account.home_domain) {
    try {
      const publicUrl = new URL(options.publicBaseUrl);
      if (
        account.home_domain.toLowerCase() !== publicUrl.hostname.toLowerCase() &&
        account.home_domain.toLowerCase() !== publicUrl.host.toLowerCase()
      ) {
        options.onWarn?.(
          `Issuer account home_domain ("${account.home_domain}") does not match server publicBaseUrl ("${options.publicBaseUrl}"). Wallets finding the approval server through stellar.toml may fail discovery.`,
        );
      }
    } catch (_e) {
      // Ignore invalid URL parsing for publicBaseUrl warning
    }
  }
}
