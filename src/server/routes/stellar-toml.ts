import type { Context } from "hono";
import type { PortcullisConfig, RuleConfig } from "../../config/schema.js";

/**
 * Derives a human-readable criteria summary for a rule.
 */
export function describeRuleCriteria(rule: RuleConfig): string {
  switch (rule.id) {
    case "per_tx_limit":
      return `Per-transaction limit: ${rule.max}`;
    case "holding_cap":
      return `Holding cap: ${rule.max}`;
    case "allowlist":
      return `Allowlist required${rule.onMiss ? ` (Verification: ${rule.onMiss.url})` : ""}`;
    case "denylist":
      return "Denylist enforced";
    case "lockup":
      return `Lockup until ${rule.until}`;
    case "review_threshold":
      return `Manual review threshold above ${rule.above}`;
    default:
      return `${(rule as { id: string }).id} rule`;
  }
}

/**
 * Generates stellar.toml content from PortcullisConfig per SEP-1 / SEP-8.
 */
export function generateStellarToml(config: PortcullisConfig): string {
  const baseUrl = config.server.publicBaseUrl.replace(/\/+$/, "");
  const approvalServer = `${baseUrl}/tx_approve`;
  const criteriaList = config.rules.map(describeRuleCriteria);
  const approvalCriteria =
    criteriaList.length > 0
      ? criteriaList.join("; ")
      : "Transfers subject to SEP-8 compliance approval.";

  return `[[CURRENCIES]]
code = "${config.asset.code}"
issuer = "${config.asset.issuer}"
regulated = true
approval_server = "${approvalServer}"
approval_criteria = "${approvalCriteria}"
`;
}

/**
 * Handles GET /.well-known/stellar.toml requests.
 */
export function handleStellarToml(c: Context, config: PortcullisConfig) {
  const toml = generateStellarToml(config);
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.text(toml, 200);
}
