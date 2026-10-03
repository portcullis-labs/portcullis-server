import { Transaction, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import type { IssuerSigner } from "../signer/types.js";

/**
 * Signs an approved transaction with the issuer's key.
 *
 * - If `revised` is false (SEP-8 "success" outcome):
 *   The original transaction is preserved with all user signatures intact,
 *   and the issuer's signature is appended.
 *
 * - If `revised` is true (SEP-8 "revised" outcome):
 *   The revised transaction is signed ONLY by the issuer. (User signatures over
 *   the previous transaction hash are invalid for the revised transaction;
 *   the wallet will sign the revised transaction upon receipt).
 */
export async function sign(
  tx: Transaction,
  revised: boolean,
  signer: IssuerSigner,
): Promise<Transaction> {
  let targetTx = tx;

  if (revised && tx.signatures.length > 0) {
    const env = tx.toEnvelope() as {
      v1?: { tx: xdr.Transaction };
    };
    if (env.v1) {
      // Rebuild envelope with no signatures
      const { xdr: sdkXdr } = await import("@stellar/stellar-sdk");
      const strippedEnv = sdkXdr.TransactionEnvelope.envelopeTypeTx(
        new sdkXdr.TransactionV1Envelope({
          tx: env.v1.tx,
          signatures: [],
        }),
      );
      const parsed = TransactionBuilder.fromXDR(strippedEnv.toXDR("base64"), tx.networkPassphrase);
      if (parsed instanceof Transaction) {
        targetTx = parsed;
      }
    }
  }

  return await signer.signTransaction(targetTx);
}
