import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import { checkTimebounds } from "../../src/pipeline/timebounds.js";

describe("checkTimebounds", () => {
  const kp = Keypair.random();
  const network = Networks.TESTNET;

  function buildTxWithTimebounds(minTime: number, maxTime: number) {
    const account = new Account(kp.publicKey(), "100");
    if (minTime === 0 && maxTime === 0) {
      return new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: network,
      })
        .addOperation(
          Operation.payment({
            destination: Keypair.random().publicKey(),
            asset: Asset.native(),
            amount: "10",
          }),
        )
        .setTimeout(TimeoutInfinite)
        .build();
    }

    return new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: network,
      timebounds: {
        minTime,
        maxTime,
      },
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .build();
  }

  it("passes when maxTime is in future and within maxWindowSeconds", () => {
    const nowSec = 1700000000;
    const maxWindowSeconds = 300;
    const tx = buildTxWithTimebounds(nowSec, nowSec + 200);

    expect(() => checkTimebounds(tx, nowSec, maxWindowSeconds)).not.toThrow();
  });

  it("passes when maxTime is exactly at nowSec + maxWindowSeconds", () => {
    const nowSec = 1700000000;
    const maxWindowSeconds = 300;
    const tx = buildTxWithTimebounds(nowSec, nowSec + 300);

    expect(() => checkTimebounds(tx, nowSec, maxWindowSeconds)).not.toThrow();
  });

  it("throws MISSING_TIMEBOUND when timebounds are omitted or maxTime is zero", () => {
    const nowSec = 1700000000;
    const maxWindowSeconds = 300;
    const txNoBounds = buildTxWithTimebounds(0, 0);

    expect(() => checkTimebounds(txNoBounds, nowSec, maxWindowSeconds)).toThrow(PortcullisError);
    try {
      checkTimebounds(txNoBounds, nowSec, maxWindowSeconds);
    } catch (err) {
      expect((err as PortcullisError).code).toBe("MISSING_TIMEBOUND");
    }
  });

  it("throws TIMEBOUND_EXPIRED when maxTime is in the past or equal to nowSec", () => {
    const nowSec = 1700000000;
    const maxWindowSeconds = 300;

    const txPast = buildTxWithTimebounds(nowSec - 100, nowSec - 10);
    expect(() => checkTimebounds(txPast, nowSec, maxWindowSeconds)).toThrow(PortcullisError);
    try {
      checkTimebounds(txPast, nowSec, maxWindowSeconds);
    } catch (err) {
      expect((err as PortcullisError).code).toBe("TIMEBOUND_EXPIRED");
    }

    const txExactNow = buildTxWithTimebounds(nowSec - 100, nowSec);
    expect(() => checkTimebounds(txExactNow, nowSec, maxWindowSeconds)).toThrow(PortcullisError);
    try {
      checkTimebounds(txExactNow, nowSec, maxWindowSeconds);
    } catch (err) {
      expect((err as PortcullisError).code).toBe("TIMEBOUND_EXPIRED");
    }
  });

  it("throws TIMEBOUND_TOO_FAR when maxTime exceeds nowSec + maxWindowSeconds", () => {
    const nowSec = 1700000000;
    const maxWindowSeconds = 300;
    const txTooFar = buildTxWithTimebounds(nowSec, nowSec + 301);

    expect(() => checkTimebounds(txTooFar, nowSec, maxWindowSeconds)).toThrow(PortcullisError);
    try {
      checkTimebounds(txTooFar, nowSec, maxWindowSeconds);
    } catch (err) {
      expect((err as PortcullisError).code).toBe("TIMEBOUND_TOO_FAR");
    }
  });
});
