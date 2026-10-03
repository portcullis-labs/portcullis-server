import { Keypair, type Transaction } from "@stellar/stellar-sdk";
import type { PortcullisConfig } from "../config/schema.js";
import { PortcullisError } from "../errors.js";
import type { IssuerSigner } from "./types.js";

export class LocalSigner implements IssuerSigner {
  private readonly keypair: Keypair;

  constructor(secretKey: string, expectedIssuerPublicKey: string) {
    try {
      this.keypair = Keypair.fromSecret(secretKey);
    } catch {
      throw new PortcullisError(
        "INVALID_CONFIG",
        "Signer secret key is invalid or cannot be parsed",
      );
    }

    if (this.keypair.publicKey() !== expectedIssuerPublicKey) {
      throw new PortcullisError(
        "INVALID_CONFIG",
        `Signer public key (${this.keypair.publicKey()}) does not match configured asset issuer (${expectedIssuerPublicKey})`,
      );
    }
  }

  publicKey(): string {
    return this.keypair.publicKey();
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }

  toString(): string {
    return `[LocalSigner publicKey=${this.publicKey()}]`;
  }

  toJSON(): Record<string, unknown> {
    return {
      type: "local",
      publicKey: this.publicKey(),
    };
  }
}

/**
 * Creates an IssuerSigner instance from configuration and environment variables.
 */
export function createSignerFromConfig(
  config: Pick<PortcullisConfig, "signer" | "asset">,
  env: NodeJS.ProcessEnv = process.env,
): IssuerSigner {
  const secret = env[config.signer.secretEnv];
  if (!secret) {
    throw new PortcullisError(
      "INVALID_CONFIG",
      `Signer secret environment variable "${config.signer.secretEnv}" is not set`,
    );
  }
  return new LocalSigner(secret, config.asset.issuer);
}
