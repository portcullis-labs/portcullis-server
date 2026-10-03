import { Keypair, type Transaction } from "@stellar/stellar-sdk";
import { PortcullisError } from "../errors.js";

/**
 * Verifies that the transaction contains at least one valid signature from the source account.
 * Rejects with BAD_REQUESTER_SIGNATURE if missing or invalid, noting that a network passphrase
 * mismatch can be a possible cause.
 *
 * Limitation in v0.1: Accounts that rely on non-master signers will not verify.
 */
export function verifyRequesterSignature(tx: Transaction): void {
  let sourceKeypair: Keypair;
  try {
    sourceKeypair = Keypair.fromPublicKey(tx.source);
  } catch {
    throw new PortcullisError(
      "BAD_REQUESTER_SIGNATURE",
      `Invalid source account public key: "${tx.source}"`,
    );
  }

  const rawPubKey = sourceKeypair.rawPublicKey();
  const expectedHint = rawPubKey.subarray(rawPubKey.length - 4);
  const txHash = tx.hash();

  for (const decSig of tx.signatures) {
    const hintBytes = decSig.hint.value;
    if (
      hintBytes.length === 4 &&
      hintBytes[0] === expectedHint[0] &&
      hintBytes[1] === expectedHint[1] &&
      hintBytes[2] === expectedHint[2] &&
      hintBytes[3] === expectedHint[3]
    ) {
      try {
        const isValid = sourceKeypair.verify(txHash, decSig.signature.value);
        if (isValid) {
          return;
        }
      } catch {
        // Continue checking other signatures if verification threw
      }
    }
  }

  throw new PortcullisError(
    "BAD_REQUESTER_SIGNATURE",
    "Transaction lacks a valid signature from source account. Note: a network passphrase mismatch can cause signature verification to fail.",
  );
}
