import { FeeBumpTransaction, type OperationRecord, type Transaction } from "@stellar/stellar-sdk";
import { PortcullisError } from "../errors.js";

export interface GuardContext {
  issuer: string;
  assetCode: string;
  maxOperations: number;
}

function matchesRegulatedAsset(
  asset: unknown,
  expectedCode: string,
  expectedIssuer: string,
): boolean {
  if (!asset || typeof asset !== "object") return false;
  const a = asset as {
    isNative?(): boolean;
    getCode?(): string;
    getIssuer?(): string;
    code?: string;
    issuer?: string;
  };
  if (typeof a.isNative === "function" && a.isNative()) return false;
  const code = typeof a.getCode === "function" ? a.getCode() : a.code;
  const issuer = typeof a.getIssuer === "function" ? a.getIssuer() : a.issuer;
  return code === expectedCode && issuer === expectedIssuer;
}

function isAuthorizeOp(op: OperationRecord, issuer: string, assetCode: string): string | null {
  const opSource = op.source ?? "";
  if (opSource !== issuer) return null;

  if (op.type === "setTrustLineFlags") {
    const flagOp = op as OperationRecord & {
      trustor?: string;
      asset?: unknown;
      flags?: {
        authorized?: boolean;
        authorizedToMaintainLiabilities?: boolean;
        clawbackEnabled?: boolean;
      };
    };
    if (!matchesRegulatedAsset(flagOp.asset, assetCode, issuer)) return null;
    if (
      flagOp.flags?.authorized === true &&
      flagOp.flags?.authorizedToMaintainLiabilities === undefined &&
      flagOp.flags?.clawbackEnabled === undefined
    ) {
      return flagOp.trustor && flagOp.trustor !== issuer ? flagOp.trustor : null;
    }
    return null;
  }

  if (op.type === "allowTrust") {
    const allowOp = op as OperationRecord & {
      trustor?: string;
      assetCode?: string;
      authorize?: boolean | number;
    };
    if (
      allowOp.assetCode === assetCode &&
      (allowOp.authorize === true || allowOp.authorize === 1)
    ) {
      return allowOp.trustor && allowOp.trustor !== issuer ? allowOp.trustor : null;
    }
    return null;
  }

  return null;
}

function isDeauthorizeOp(op: OperationRecord, issuer: string, assetCode: string): string | null {
  const opSource = op.source ?? "";
  if (opSource !== issuer) return null;

  if (op.type === "setTrustLineFlags") {
    const flagOp = op as OperationRecord & {
      trustor?: string;
      asset?: unknown;
      flags?: {
        authorized?: boolean;
        authorizedToMaintainLiabilities?: boolean;
        clawbackEnabled?: boolean;
      };
    };
    if (!matchesRegulatedAsset(flagOp.asset, assetCode, issuer)) return null;
    if (
      flagOp.flags?.authorized === false &&
      flagOp.flags?.authorizedToMaintainLiabilities === undefined &&
      flagOp.flags?.clawbackEnabled === undefined
    ) {
      return flagOp.trustor && flagOp.trustor !== issuer ? flagOp.trustor : null;
    }
    return null;
  }

  if (op.type === "allowTrust") {
    const allowOp = op as OperationRecord & {
      trustor?: string;
      assetCode?: string;
      authorize?: boolean | number;
    };
    if (
      allowOp.assetCode === assetCode &&
      (allowOp.authorize === false || allowOp.authorize === 0)
    ) {
      return allowOp.trustor && allowOp.trustor !== issuer ? allowOp.trustor : null;
    }
    return null;
  }

  return null;
}

/**
 * Asserts that a transaction is completely safe for the issuer to sign.
 * Throws PortcullisError("UNSAFE_TO_SIGN", ...) if any invariant is violated.
 */
export function assertSafeToSign(
  tx: Transaction | FeeBumpTransaction,
  ctx: GuardContext,
): asserts tx is Transaction {
  // 1. Must not be a FeeBumpTransaction
  if (tx instanceof FeeBumpTransaction || "innerTransaction" in tx) {
    throw new PortcullisError(
      "UNSAFE_TO_SIGN",
      "Fee-bump transaction envelopes cannot be signed by Portcullis",
    );
  }

  // 2. Transaction source must not be the issuer
  if (tx.source === ctx.issuer) {
    throw new PortcullisError(
      "UNSAFE_TO_SIGN",
      "Transaction source account is the issuer; sequence number must belong to user",
    );
  }

  // 3. Operation count must not exceed maxOperations
  if (tx.operations.length === 0) {
    throw new PortcullisError("UNSAFE_TO_SIGN", "Transaction contains no operations");
  }

  if (tx.operations.length > ctx.maxOperations) {
    throw new PortcullisError(
      "UNSAFE_TO_SIGN",
      `Operation count (${tx.operations.length}) exceeds maxOperations (${ctx.maxOperations})`,
    );
  }

  const ops = tx.operations;
  let index = 0;

  // Phase 1: Leading block of issuer-sourced authorize operations
  const authTrustors: string[] = [];
  const seenAuthTrustors = new Set<string>();

  while (index < ops.length) {
    const op = ops[index];
    if (!op) break;
    const opSource = op.source ?? tx.source;
    if (opSource === ctx.issuer) {
      const trustor = isAuthorizeOp(op, ctx.issuer, ctx.assetCode);
      if (!trustor) {
        throw new PortcullisError(
          "UNSAFE_TO_SIGN",
          `Issuer operation at index ${index} is not a valid authorize operation for ${ctx.assetCode}`,
        );
      }
      if (seenAuthTrustors.has(trustor)) {
        throw new PortcullisError(
          "UNSAFE_TO_SIGN",
          `Duplicate authorize operation for trustor: ${trustor}`,
        );
      }
      seenAuthTrustors.add(trustor);
      authTrustors.push(trustor);
      index++;
    } else {
      break;
    }
  }

  // Phase 2: Middle block of user-sourced payments of the regulated asset
  const paymentCounterparties = new Set<string>();
  const paymentStartIndex = index;

  while (index < ops.length) {
    const op = ops[index];
    if (!op) break;
    const opSource = op.source ?? tx.source;
    if (opSource === ctx.issuer) {
      // Reached trailing block of issuer operations
      break;
    }

    if (op.type !== "payment") {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `User-sourced operation at index ${index} is type "${op.type}", only "payment" is permitted`,
      );
    }

    const paymentOp = op as OperationRecord & {
      destination?: string;
      source?: string;
      asset?: unknown;
    };

    if (paymentOp.source === ctx.issuer || paymentOp.destination === ctx.issuer) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `Payment at index ${index} touches issuer account directly`,
      );
    }

    if (!paymentOp.destination) {
      throw new PortcullisError("UNSAFE_TO_SIGN", `Payment at index ${index} missing destination`);
    }

    if (!matchesRegulatedAsset(paymentOp.asset, ctx.assetCode, ctx.issuer)) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `Payment at index ${index} is not for regulated asset ${ctx.assetCode}:${ctx.issuer}`,
      );
    }

    paymentCounterparties.add(opSource);
    paymentCounterparties.add(paymentOp.destination);
    index++;
  }

  if (index === paymentStartIndex) {
    throw new PortcullisError("UNSAFE_TO_SIGN", "Transaction contains no user payment operations");
  }

  // Phase 3: Trailing block of issuer-sourced deauthorize operations
  const deauthTrustors: string[] = [];
  const seenDeauthTrustors = new Set<string>();

  while (index < ops.length) {
    const op = ops[index];
    if (!op) break;
    const opSource = op.source ?? tx.source;
    if (opSource !== ctx.issuer) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `Non-issuer operation at index ${index} encountered after payment block`,
      );
    }

    const trustor = isDeauthorizeOp(op, ctx.issuer, ctx.assetCode);
    if (!trustor) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `Issuer operation at index ${index} is not a valid deauthorize operation for ${ctx.assetCode}`,
      );
    }

    if (seenDeauthTrustors.has(trustor)) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `Duplicate deauthorize operation for trustor: ${trustor}`,
      );
    }

    seenDeauthTrustors.add(trustor);
    deauthTrustors.push(trustor);
    index++;
  }

  // Check sandwich balance and bidirectional counterparty correspondence:
  if (authTrustors.length !== deauthTrustors.length) {
    throw new PortcullisError(
      "UNSAFE_TO_SIGN",
      `Authorize count (${authTrustors.length}) does not match deauthorize count (${deauthTrustors.length})`,
    );
  }

  for (const trustor of seenAuthTrustors) {
    if (!seenDeauthTrustors.has(trustor)) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `Trustor ${trustor} authorized but not deauthorized`,
      );
    }
    if (!paymentCounterparties.has(trustor)) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        `Trustor ${trustor} is authorized/deauthorized but does not participate in payments`,
      );
    }
  }
}
