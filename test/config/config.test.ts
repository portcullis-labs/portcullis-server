import { describe, expect, it } from "vitest";
import { loadConfigFile, loadConfigFromYaml } from "../../src/config/loader.js";
import { PortcullisError } from "../../src/errors.js";

const VALID_ISSUER = "GA7DACFRQUIDE2L3NPC6G43W2Y5UT33IRCVY5MQLN7XG7G6ZRPSXNLCW";
const VALID_EXEMPT = "GBTVKLRH6EXASHIPVZGT6Z7CIHHECPTNOCULT6DNMUH6NIPG7K2W5GRX";

const VALID_YAML = `
network: testnet
asset:
  code: GOAT
  issuer: ${VALID_ISSUER}
approval:
  maxTimeWindowSeconds: 300
  maxFeePerOperationStroops: "10000"
  maxOperations: 10
horizon:
  url: https://horizon-testnet.stellar.org
  timeoutMs: 3000
  cacheTtlSeconds: 5
signer:
  type: local
  secretEnv: ISSUER_SECRET
server:
  port: 8080
  publicBaseUrl: https://example.org
log:
  path: ./decisions.jsonl
  includeXdr: false
rules:
  - id: per_tx_limit
    max: "1000.0000000"
  - id: holding_cap
    max: "50000.0000000"
  - id: allowlist
    path: ./allowlist.csv
    onMiss:
      action: action_required
      url: "https://example.org/verify"
      method: GET
      message: "Complete verification"
  - id: denylist
    path: ./denylist.csv
  - id: lockup
    until: "2027-01-01T00:00:00Z"
    applyTo: [source]
    exempt: [${VALID_EXEMPT}]
  - id: review_threshold
    above: "5000.0000000"
    timeoutMs: 60000
    message: "Manual review required"
    approvedTxHashesPath: ./approved-txs.txt
`;

describe("config parser and loader", () => {
  it("should parse a valid complete configuration", () => {
    const config = loadConfigFromYaml(VALID_YAML);
    expect(config.network).toBe("testnet");
    expect(config.asset.code).toBe("GOAT");
    expect(config.asset.issuer).toBe(VALID_ISSUER);
    expect(config.approval.maxTimeWindowSeconds).toBe(300);
    expect(config.rules).toHaveLength(6);
    expect(config.rules[0]?.id).toBe("per_tx_limit");
    expect(config.rules[4]?.id).toBe("lockup");
    if (config.rules[4]?.id === "lockup") {
      expect(config.rules[4].exempt).toEqual([VALID_EXEMPT]);
    }
  });

  it("should reject unknown top-level keys", () => {
    const yamlWithUnknownTopLevel = `${VALID_YAML}\nunexpected_key: "not allowed"\n`;
    expect(() => loadConfigFromYaml(yamlWithUnknownTopLevel)).toThrowError(PortcullisError);
  });

  it("should reject unknown keys inside nested sections", () => {
    const yamlWithUnknownNested = VALID_YAML.replace(
      "code: GOAT",
      "code: GOAT\n  unexpected_field: 123",
    );
    expect(() => loadConfigFromYaml(yamlWithUnknownNested)).toThrowError(PortcullisError);
  });

  it("should reject unknown rule IDs", () => {
    const yamlWithUnknownRule = VALID_YAML.replace(
      "- id: per_tx_limit",
      "- id: unknown_rule_id\n    some_field: 123",
    );
    expect(() => loadConfigFromYaml(yamlWithUnknownRule)).toThrowError(PortcullisError);
  });

  it("should reject unknown keys inside rule configs", () => {
    const yamlWithUnknownRuleKey = VALID_YAML.replace(
      'max: "1000.0000000"',
      'max: "1000.0000000"\n    extra_rule_param: "invalid"',
    );
    expect(() => loadConfigFromYaml(yamlWithUnknownRuleKey)).toThrowError(PortcullisError);
  });

  it("should reject invalid Stellar public keys", () => {
    const yamlWithBadIssuer = VALID_YAML.replace(VALID_ISSUER, "INVALID_STELLAR_KEY_NOT_G_ADDRESS");
    expect(() => loadConfigFromYaml(yamlWithBadIssuer)).toThrowError(PortcullisError);
  });

  it("should reject invalid asset codes", () => {
    const yamlWithBadAssetCode = VALID_YAML.replace("code: GOAT", "code: TOOLONGCURRENCYCODE12345");
    expect(() => loadConfigFromYaml(yamlWithBadAssetCode)).toThrowError(PortcullisError);
  });

  it("should reject invalid amount formats in rules", () => {
    const yamlWithBadAmount = VALID_YAML.replace(
      'max: "1000.0000000"',
      'max: "1000.12345678"', // 8 decimals
    );
    expect(() => loadConfigFromYaml(yamlWithBadAmount)).toThrowError(PortcullisError);
  });

  it("should reject pubnet with local signer", () => {
    const yamlPubnetLocal = VALID_YAML.replace("network: testnet", "network: pubnet");
    expect(() => loadConfigFromYaml(yamlPubnetLocal)).toThrowError(
      /network: pubnet with signer\.type: local is rejected/,
    );
  });

  it("should reject empty or malformed YAML", () => {
    expect(() => loadConfigFromYaml("")).toThrowError(PortcullisError);
    expect(() => loadConfigFromYaml("   ")).toThrowError(PortcullisError);
    expect(() => loadConfigFromYaml("invalid: : : yaml")).toThrowError(PortcullisError);
    expect(() => loadConfigFromYaml("- just\n- an\n- array")).toThrowError(PortcullisError);
  });

  it("should reject non-existent config file path in loadConfigFile", () => {
    expect(() => loadConfigFile("./non-existent-config-file.yml")).toThrowError(PortcullisError);
  });
});
