import type { Transaction } from "@stellar/stellar-sdk";

export interface IssuerSigner {
  publicKey(): string;
  signTransaction(tx: Transaction): Promise<Transaction>;
}
