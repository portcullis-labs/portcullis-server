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

  return txOrFeeBump;
}
