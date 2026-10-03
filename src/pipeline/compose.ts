import {
  Account,
  Asset,
  Operation,
  type OperationRecord,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { PortcullisConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import { formatStroops } from "../stellar/amount.js";
import type { ClassifiedOperations } from "./classify.js";

export interface ComposeResult {
  tx: Transaction;
  revised: boolean;
  message?: string;
}

/**
 * Checks if the transaction already has the complete SEP-8 shape:
 * 1. Issuer-sourced authorize operations for every distinct account in payments.
 * 2. Original payment operations.
 * 3. Issuer-sourced deauthorize operations for every distinct account in payments.
 */
function isAlreadySep8Shaped(
  tx: Transaction,
  distinctAccounts: string[],
  classified: ClassifiedOperations,
  issuer: string,
  assetCode: string,
): boolean {
  const n = distinctAccounts.length;
  const expectedTotalOps = n + classified.payments.length + n;
  if (tx.operations.length !== expectedTotalOps) {
    return false;
  }

  // Check prefix: N authorize ops
  for (let i = 0; i < n; i++) {
    const op = tx.operations[i] as OperationRecord & {
      trustor?: string;
      asset?: { getCode?(): string; getIssuer?(): string };
      assetCode?: string;
      flags?: { authorized?: boolean };
      authorize?: boolean | number;
    };
    const expectedAccount = distinctAccounts[i];
    const opSource = op.source ?? tx.source;

    if (opSource !== issuer) return false;
    if (op.trustor !== expectedAccount) return false;

    if (op.type === "setTrustLineFlags") {
      if (op.asset?.getCode?.() !== assetCode || op.asset?.getIssuer?.() !== issuer) return false;
      if (!op.flags?.authorized) return false;
    } else if (op.type === "allowTrust") {
      if (op.assetCode !== assetCode) return false;
      if (!op.authorize) return false;
    } else {
      return false;
    }
  }

  // Check middle: original payment ops
  for (let i = 0; i < classified.payments.length; i++) {
    const op = tx.operations[n + i];
    if (op?.type !== "payment") return false;
  }

  // Check suffix: N deauthorize ops
  for (let i = 0; i < n; i++) {
    const op = tx.operations[n + classified.payments.length + i] as OperationRecord & {
      trustor?: string;
      asset?: { getCode?(): string; getIssuer?(): string };
      assetCode?: string;
      flags?: { authorized?: boolean };
      authorize?: boolean | number;
    };
    const expectedAccount = distinctAccounts[i];
    const opSource = op.source ?? tx.source;

    if (opSource !== issuer) return false;
    if (op.trustor !== expectedAccount) return false;

    if (op.type === "setTrustLineFlags") {
      if (op.asset?.getCode?.() !== assetCode || op.asset?.getIssuer?.() !== issuer) return false;
      if (op.flags?.authorized) return false; // Must be false for deauthorize
    } else if (op.type === "allowTrust") {
      if (op.assetCode !== assetCode) return false;
      if (op.authorize) return false;
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Composes a SEP-8 compliant transaction envelope by sandwiching user payments
 * between issuer-sourced authorize and deauthorize operations.
 * If already shaped, returns unchanged with revised: false.
 */
export function compose(
  tx: Transaction,
  classified: ClassifiedOperations,
  config: PortcullisConfig,
): ComposeResult {
  if (classified.payments.length === 0) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      "Transaction contains no regulated payments to approve",
    );
  }

  // Collect distinct accounts in payment order (preserving appearance order)
  const distinctAccounts: string[] = [];
  const seenAccounts = new Set<string>();
  for (const p of classified.payments) {
    if (!seenAccounts.has(p.from)) {
      seenAccounts.add(p.from);
      distinctAccounts.push(p.from);
    }
    if (!seenAccounts.has(p.to)) {
      seenAccounts.add(p.to);
      distinctAccounts.push(p.to);
    }
  }

  const issuer = config.asset.issuer;
  const assetCode = config.asset.code;
  const stellarAsset = new Asset(assetCode, issuer);

  // Check if already shaped
  if (isAlreadySep8Shaped(tx, distinctAccounts, classified, issuer, assetCode)) {
    return {
      tx,
      revised: false,
    };
  }

  // Calculate fees
  const originalOpCount = BigInt(tx.operations.length);
  const totalOriginalFee = BigInt(tx.fee);
  const feePerOp = totalOriginalFee / (originalOpCount > 0n ? originalOpCount : 1n);

  const maxFeePerOp = BigInt(config.approval.maxFeePerOperationStroops);
  if (feePerOp > maxFeePerOp) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      `Fee per operation (${feePerOp} stroops) exceeds maxFeePerOperationStroops (${maxFeePerOp} stroops)`,
    );
  }

  const newOpCount = distinctAccounts.length + classified.payments.length + distinctAccounts.length;
  if (newOpCount > config.approval.maxOperations) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      `Revised transaction operation count (${newOpCount}) exceeds maxOperations (${config.approval.maxOperations})`,
    );
  }

  // Build revised transaction
  const builderOpts: {
    fee: string;
    networkPassphrase: string;
    timebounds?: { minTime: number; maxTime: number };
  } = {
    fee: feePerOp.toString(),
    networkPassphrase: tx.networkPassphrase,
  };

  if (tx.timeBounds) {
    builderOpts.timebounds = {
      minTime: Number.parseInt(tx.timeBounds.minTime, 10),
      maxTime: Number.parseInt(tx.timeBounds.maxTime, 10),
    };
  }

  const prevSeq = (BigInt(tx.sequence) - 1n).toString();
  const sourceAccount = new Account(tx.source, prevSeq);

  const builder = new TransactionBuilder(sourceAccount, builderOpts);

  if (tx.memo) {
    builder.addMemo(tx.memo);
  }

  // 1. Authorize operations
  for (const account of distinctAccounts) {
    builder.addOperation(
      Operation.setTrustLineFlags({
        trustor: account,
        asset: stellarAsset,
        flags: { authorized: true },
        source: issuer,
      }),
    );
  }

  // 2. User payment operations
  for (const payment of classified.payments) {
    const paymentOpts: {
      destination: string;
      asset: Asset;
      amount: string;
      source?: string;
    } = {
      destination: payment.to,
      asset: stellarAsset,
      amount: formatStroops(payment.amount),
    };
    if (payment.from !== tx.source) {
      paymentOpts.source = payment.from;
    }
    builder.addOperation(Operation.payment(paymentOpts));
  }

  // 3. Deauthorize operations
  for (const account of distinctAccounts) {
    builder.addOperation(
      Operation.setTrustLineFlags({
        trustor: account,
        asset: stellarAsset,
        flags: { authorized: false },
        source: issuer,
      }),
    );
  }

  const revisedTx = builder.build();
  const message = `Added ${distinctAccounts.length} authorize and ${distinctAccounts.length} deauthorize operations for accounts: ${distinctAccounts.join(", ")}`;

  return {
    tx: revisedTx,
    revised: true,
    message,
  };
}
