import { FeeBumpTransaction, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { PortcullisError } from "../errors.js";

/**
 * Decodes a base64 XDR transaction envelope string against the given network passphrase.
 * Rejects malformed XDR with MALFORMED_XDR and fee-bump transactions with UNSUPPORTED_FEE_BUMP.
 */
export function decodeEnvelope(xdrBase64: string, networkPassphrase: string): Transaction {
  if (typeof xdrBase64 !== "string" || xdrBase64.trim() === "") {
    throw new PortcullisError("MALFORMED_XDR", "Transaction XDR must be a non-empty base64 string");
  }

  let txOrFeeBump: Transaction | FeeBumpTransaction;
  try {
    txOrFeeBump = TransactionBuilder.fromXdr(xdrBase64, networkPassphrase);
  } catch (err) {
    throw new PortcullisError(
      "MALFORMED_XDR",
      `Malformed transaction envelope XDR: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (txOrFeeBump instanceof FeeBumpTransaction) {
    throw new PortcullisError(
      "UNSUPPORTED_FEE_BUMP",
      "Fee-bump transactions are unsupported in v0.1",
    );
  }

  const tx = txOrFeeBump;

  if (tx.ledgerBounds !== undefined) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      "Unsupported transaction precondition: ledgerBounds is not supported in v0.1",
    );
  }
  if (tx.minAccountSequence !== undefined) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      "Unsupported transaction precondition: minAccountSequence is not supported in v0.1",
    );
  }
  if (tx.minAccountSequenceAge !== undefined && tx.minAccountSequenceAge !== 0n) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      "Unsupported transaction precondition: minAccountSequenceAge is not supported in v0.1",
    );
  }
  if (tx.minAccountSequenceLedgerGap !== undefined && tx.minAccountSequenceLedgerGap !== 0) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      "Unsupported transaction precondition: minAccountSequenceLedgerGap is not supported in v0.1",
    );
  }
  if (
    tx.extraSigners !== undefined &&
    (Array.isArray(tx.extraSigners) ? tx.extraSigners.length > 0 : true)
  ) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      "Unsupported transaction precondition: extraSigners is not supported in v0.1",
    );
  }
  if (tx.minAccountSequenceAge !== undefined) {
    throw new PortcullisError(
      "UNSUPPORTED_OPERATION",
      "Unsupported transaction precondition: v2 preconditions are not supported in v0.1",
    );
  }

  return tx;
}
