import { FeeBumpTransaction, type OperationRecord, type Transaction } from "@stellar/stellar-sdk";
import { PortcullisError } from "../errors.js";

export interface GuardContext {
  issuer: string;
  assetCode: string;
  maxOperations: number;
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

  // Collect all legitimate user account addresses that appear in payments or tx source
  const userAccounts = new Set<string>();
  userAccounts.add(tx.source);

  for (const op of tx.operations) {
    if (op.type === "payment") {
      const paymentOp = op as OperationRecord & {
        destination: string;
        source?: string;
      };
      if (paymentOp.source) {
        userAccounts.add(paymentOp.source);
      }
      userAccounts.add(paymentOp.destination);
    }
  }

  // Inspect each operation
  for (const op of tx.operations) {
    const opSource = op.source ?? tx.source;

    // Reject any operation that touches issuer options or signers or trustlines
    if (op.type === "setOptions" && opSource === ctx.issuer) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        "SetOptions operation sourced by issuer is forbidden",
      );
    }

    if (op.type === "changeTrust" && opSource === ctx.issuer) {
      throw new PortcullisError(
        "UNSAFE_TO_SIGN",
        "ChangeTrust operation sourced by issuer is forbidden",
      );
    }

    if (opSource === ctx.issuer) {
      // Every issuer-sourced operation MUST be a trustline flag operation for the regulated asset
      if (op.type === "setTrustLineFlags") {
        const flagOp = op as OperationRecord & {
          trustor: string;
          asset: { isNative?(): boolean; getCode?(): string; getIssuer?(): string };
        };

        if (
          flagOp.asset.isNative?.() ||
          flagOp.asset.getCode?.() !== ctx.assetCode ||
          flagOp.asset.getIssuer?.() !== ctx.issuer
        ) {
          throw new PortcullisError(
            "UNSAFE_TO_SIGN",
            "Issuer-sourced SetTrustLineFlags targets a different asset",
          );
        }

        if (!userAccounts.has(flagOp.trustor)) {
          throw new PortcullisError(
            "UNSAFE_TO_SIGN",
            `Issuer-sourced SetTrustLineFlags targets unrelated account: ${flagOp.trustor}`,
          );
        }
      } else if (op.type === "allowTrust") {
        const allowOp = op as OperationRecord & {
          trustor: string;
          assetCode: string;
        };

        if (allowOp.assetCode !== ctx.assetCode) {
          throw new PortcullisError(
            "UNSAFE_TO_SIGN",
            "Issuer-sourced AllowTrust targets a different asset code",
          );
        }

        if (!userAccounts.has(allowOp.trustor)) {
          throw new PortcullisError(
            "UNSAFE_TO_SIGN",
            `Issuer-sourced AllowTrust targets unrelated account: ${allowOp.trustor}`,
          );
        }
      } else {
        throw new PortcullisError(
          "UNSAFE_TO_SIGN",
          `Issuer cannot source operation of type: "${op.type}"`,
        );
      }
    } else {
      // User-sourced operations: only payments of the regulated asset
      if (op.type !== "payment") {
        throw new PortcullisError(
          "UNSAFE_TO_SIGN",
          `User-sourced operation of type "${op.type}" is not permitted in approved transactions`,
        );
      }
    }
  }
}
