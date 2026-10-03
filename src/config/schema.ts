import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { parseAmountToStroops } from "../stellar/amount.js";

const stellarPublicKeySchema = z.string().refine((val) => StrKey.isValidEd25519PublicKey(val), {
  message: "Invalid Stellar ed25519 public key (must be valid G... address)",
});

const assetCodeSchema = z
  .string()
  .min(1)
  .max(12)
  .regex(/^[a-zA-Z0-9]+$/, {
    message: "Asset code must be 1-12 alphanumeric characters",
  });

const amountStringSchema = z.string().refine(
  (val) => {
    try {
      parseAmountToStroops(val);
      return true;
    } catch {
      return false;
    }
  },
  {
    message: "Invalid amount string; must match amount grammar and not exceed max stroops",
  },
);

const onMissSchema = z
  .object({
    action: z.literal("action_required"),
    url: z.string().url(),
    method: z.enum(["GET", "POST"]).default("GET"),
    message: z.string().min(1),
  })
  .strict();

export const perTxLimitRuleSchema = z
  .object({
    id: z.literal("per_tx_limit"),
    max: amountStringSchema,
  })
  .strict();

export const holdingCapRuleSchema = z
  .object({
    id: z.literal("holding_cap"),
    max: amountStringSchema,
  })
  .strict();

export const allowlistRuleSchema = z
  .object({
    id: z.literal("allowlist"),
    path: z.string().min(1),
    onMiss: onMissSchema.optional(),
  })
  .strict();

export const denylistRuleSchema = z
  .object({
    id: z.literal("denylist"),
    path: z.string().min(1),
  })
  .strict();

export const lockupRuleSchema = z
  .object({
    id: z.literal("lockup"),
    until: z.string().datetime({ offset: true }),
    applyTo: z.array(z.enum(["source", "destination"])).default(["source"]),
    exempt: z.array(stellarPublicKeySchema).default([]),
  })
  .strict();

export const reviewThresholdRuleSchema = z
  .object({
    id: z.literal("review_threshold"),
    above: amountStringSchema,
    timeoutMs: z.number().int().positive(),
    message: z.string().min(1),
    approvedTxHashesPath: z.string().min(1),
  })
  .strict();

export const ruleConfigSchema = z.discriminatedUnion("id", [
  perTxLimitRuleSchema,
  holdingCapRuleSchema,
  allowlistRuleSchema,
  denylistRuleSchema,
  lockupRuleSchema,
  reviewThresholdRuleSchema,
]);

export const configSchema = z
  .object({
    network: z.enum(["testnet", "pubnet"]),
    asset: z
      .object({
        code: assetCodeSchema,
        issuer: stellarPublicKeySchema,
      })
      .strict(),
    approval: z
      .object({
        maxTimeWindowSeconds: z.number().int().min(1).max(3600),
        maxFeePerOperationStroops: amountStringSchema,
        maxOperations: z.number().int().min(1),
      })
      .strict(),
    horizon: z
      .object({
        url: z.string().url(),
        timeoutMs: z.number().int().positive(),
        cacheTtlSeconds: z.number().int().nonnegative(),
      })
      .strict(),
    signer: z
      .object({
        type: z.literal("local"),
        secretEnv: z.string().min(1),
      })
      .strict(),
    server: z
      .object({
        port: z.number().int().min(1).max(65535),
        publicBaseUrl: z.string().url(),
      })
      .strict(),
    log: z
      .object({
        path: z.string().min(1),
        includeXdr: z.boolean(),
      })
      .strict(),
    rules: z.array(ruleConfigSchema),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.network === "pubnet" && data.signer.type === "local") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signer", "type"],
        message: "network: pubnet with signer.type: local is rejected (unsupported in v0.1)",
      });
    }
  });

export type PortcullisConfig = z.infer<typeof configSchema>;
export type RuleConfig = z.infer<typeof ruleConfigSchema>;
export type PerTxLimitRuleConfig = z.infer<typeof perTxLimitRuleSchema>;
export type HoldingCapRuleConfig = z.infer<typeof holdingCapRuleSchema>;
export type AllowlistRuleConfig = z.infer<typeof allowlistRuleSchema>;
export type DenylistRuleConfig = z.infer<typeof denylistRuleSchema>;
export type LockupRuleConfig = z.infer<typeof lockupRuleSchema>;
export type ReviewThresholdRuleConfig = z.infer<typeof reviewThresholdRuleSchema>;
