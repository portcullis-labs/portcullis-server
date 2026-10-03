export type Stroops = bigint;

export interface AssetId {
  code: string;
  issuer: string;
}

export interface Payment {
  from: string;
  to: string;
  asset: AssetId;
  amount: Stroops;
}

export interface AccountState {
  id: string;
  balance: Stroops; // balance of the regulated asset (0n if no trustline)
  hasTrustline: boolean;
  authorized: boolean; // trustline currently authorized
}
