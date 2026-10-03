import { type OperationRecord, StrKey, type Transaction } from "@stellar/stellar-sdk";
import type { AssetId, Payment } from "../domain/types.js";
import { PortcullisError } from "../errors.js";
import { parseAmountToStroops } from "../stellar/amount.js";

export interface IssuerFlagOp {
  type: "setTrustLineFlags" | "allowTrust";
  source: string;
  trustor: string;
  asset: AssetId;
  authorize: boolean;
}

export interface ClassifiedOperations {
  payments: Payment[];
  issuerFlagOps: IssuerFlagOp[];
}

function assertValidEd25519Address(address: string, contextDescription: string): void {
  if (address.startsWith("M") || StrKey.isValidMed25519PublicKey(address)) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      `Muxed accounts are unsupported in v0.1 (${contextDescription})`,
    );
  }
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      `Invalid Stellar ed25519 public key (${contextDescription}): "${address}"`,
    );
  }
}

/**
 * Inspects and classifies operations in a transaction.
 * Accepts only payments of the regulated asset and issuer-sourced trustline flag operations.
 * Rejects any other operation types, muxed accounts, or payments involving the issuer as counterparty.
 */
export function classify(tx: Transaction, asset: AssetId): ClassifiedOperations {
  assertValidEd25519Address(tx.source, "transaction source");

  const payments: Payment[] = [];
  const issuerFlagOps: IssuerFlagOp[] = [];

  for (const op of tx.operations) {
    const opSource = op.source ?? tx.source;
    assertValidEd25519Address(opSource, "operation source");

    if (op.type === "payment") {
      const paymentOp = op as OperationRecord & {
        destination: string;
        asset: { isNative(): boolean; getCode(): string; getIssuer(): string };
        amount: string;
      };

      assertValidEd25519Address(paymentOp.destination, "payment destination");

      if (paymentOp.asset.isNative()) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          "Payment operation with native XLM asset is unsupported; regulated asset required",
        );
      }

      if (
        paymentOp.asset.getCode() !== asset.code ||
        paymentOp.asset.getIssuer() !== asset.issuer
      ) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          `Payment operation asset (${paymentOp.asset.getCode()}:${paymentOp.asset.getIssuer()}) does not match regulated asset (${asset.code}:${asset.issuer})`,
        );
      }

      if (opSource === asset.issuer || paymentOp.destination === asset.issuer) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          "Issuer cannot be payment source or destination in approved transactions",
        );
      }

      const stroopsAmount = parseAmountToStroops(paymentOp.amount);
      payments.push({
        from: opSource,
        to: paymentOp.destination,
        asset,
        amount: stroopsAmount,
      });
    } else if (op.type === "setTrustLineFlags") {
      const flagOp = op as OperationRecord & {
        trustor: string;
        asset: { isNative(): boolean; getCode(): string; getIssuer(): string };
        flags: { authorized?: boolean };
      };

      if (opSource !== asset.issuer) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          "SetTrustLineFlags operation must be sourced by the asset issuer",
        );
      }

      assertValidEd25519Address(flagOp.trustor, "trustor");

      if (flagOp.asset.isNative()) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          "SetTrustLineFlags cannot target native XLM",
        );
      }

      if (flagOp.asset.getCode() !== asset.code || flagOp.asset.getIssuer() !== asset.issuer) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          "SetTrustLineFlags operation targets a different asset",
        );
      }

      const authorize = Boolean(flagOp.flags?.authorized);
      issuerFlagOps.push({
        type: "setTrustLineFlags",
        source: opSource,
        trustor: flagOp.trustor,
        asset,
        authorize,
      });
    } else if (op.type === "allowTrust") {
      const allowOp = op as OperationRecord & {
        trustor: string;
        assetCode: string;
        authorize?: number | boolean;
      };

      if (opSource !== asset.issuer) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          "AllowTrust operation must be sourced by the asset issuer",
        );
      }

      assertValidEd25519Address(allowOp.trustor, "trustor");

      if (allowOp.assetCode !== asset.code) {
        throw new PortcullisError(
          "UNSUPPORTED_OPERATION",
          "AllowTrust operation targets a different asset code",
        );
      }

      const authorize = Boolean(allowOp.authorize);
      issuerFlagOps.push({
        type: "allowTrust",
        source: opSource,
        trustor: allowOp.trustor,
        asset,
        authorize,
      });
    } else {
      throw new PortcullisError(
        "UNSUPPORTED_OPERATION",
        `Unsupported operation type: "${op.type}"`,
      );
    }
  }

  return {
    payments,
    issuerFlagOps,
  };
}
