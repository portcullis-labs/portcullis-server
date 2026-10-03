import { randomUUID } from "node:crypto";
import { Networks } from "@stellar/stellar-sdk";
import type { PortcullisConfig } from "../config/schema.js";
import type { AccountState } from "../domain/types.js";
import { PortcullisError } from "../errors.js";
import type { DecisionLogger, RuleEvaluationLog } from "../log/logger.js";
import { evaluateAndAggregate } from "../rules/aggregate.js";
import type { Rule, RuleContext } from "../rules/types.js";
import type { IssuerSigner } from "../signer/types.js";
import type { StateStore } from "../state/types.js";
import type { AccountStateProvider } from "../stellar/account-state.js";
import { classify } from "./classify.js";
import { compose } from "./compose.js";
import { decodeEnvelope } from "./decode.js";
import { assertSafeToSign } from "./guard.js";
import { AccountLockManager, withAccountLocks } from "./lock.js";
import { sign } from "./sign.js";
import { checkTimebounds } from "./timebounds.js";
import { verifyRequesterSignature } from "./verify-signature.js";

export interface ApprovalRequest {
  tx: string;
  requestId?: string;
  nowMs?: number;
}

export type ApprovalResponse =
  | {
      status: "success";
      tx: string;
      message?: string;
    }
  | {
      status: "revised";
      tx: string;
      message?: string;
    }
  | {
      status: "pending";
      timeout: number;
      message?: string;
    }
  | {
      status: "action_required";
      message: string;
      action_url?: string;
      action_method?: string;
      action_fields?: string[];
    }
  | {
      status: "rejected";
      error: string;
    };

export interface ApprovalDependencies {
  config: PortcullisConfig;
  rules: Rule[];
  signer: IssuerSigner;
  stateStore: StateStore;
  accountStateProvider: AccountStateProvider;
  decisionLogger: DecisionLogger;
  lockManager?: AccountLockManager;
  onInternalError?: (error: unknown) => void;
}

export interface RunApprovalResult {
  httpStatus: number;
  body: ApprovalResponse;
}

export async function runApproval(
  request: ApprovalRequest,
  deps: ApprovalDependencies,
): Promise<RunApprovalResult> {
  const startTime = Date.now();
  const requestId = request.requestId ?? randomUUID();
  const nowMs = request.nowMs ?? startTime;
  const nowSeconds = Math.floor(nowMs / 1000);
  const ruleLogs: RuleEvaluationLog[] = [];

  let txHash = "unknown";
  let txSource = "unknown";

  try {
    if (!request.tx || typeof request.tx !== "string" || request.tx.trim().length === 0) {
      throw new PortcullisError("MALFORMED_XDR", "Request 'tx' parameter is missing or empty");
    }

    const networkPassphrase = deps.config.network === "pubnet" ? Networks.PUBLIC : Networks.TESTNET;

    // 1. Decode envelope
    const tx = decodeEnvelope(request.tx, networkPassphrase);
    txHash = Buffer.from(tx.hash()).toString("hex");
    txSource = tx.source;

    // 2. Classify operations
    const classified = classify(tx, deps.config.asset);

    // 3. Verify requester signature
    verifyRequesterSignature(tx);

    // 4. Check timebounds
    checkTimebounds(tx, nowSeconds, deps.config.approval.maxTimeWindowSeconds);

    // Collect distinct accounts in payments
    const distinctPaymentAccounts: string[] = [];
    const seenAccounts = new Set<string>();
    for (const p of classified.payments) {
      if (!seenAccounts.has(p.from)) {
        seenAccounts.add(p.from);
        distinctPaymentAccounts.push(p.from);
      }
      if (!seenAccounts.has(p.to)) {
        seenAccounts.add(p.to);
        distinctPaymentAccounts.push(p.to);
      }
    }

    // Serialize check-and-reserve per account
    const lockMgr = deps.lockManager ?? new AccountLockManager();

    return await withAccountLocks(
      distinctPaymentAccounts,
      async () => {
        // 5. Load account states from provider (with fail closed on error)
        let accountStates: Map<string, AccountState>;
        try {
          accountStates = await deps.accountStateProvider.load(
            distinctPaymentAccounts,
            deps.config.asset,
            nowMs,
          );
        } catch {
          const durationMs = Date.now() - startTime;
          try {
            deps.decisionLogger.log({
              timestamp: new Date().toISOString(),
              requestId,
              txHash,
              source: txSource,
              outcome: "rejected",
              rules: [],
              errorCode: "UPSTREAM_UNAVAILABLE",
              durationMs,
              xdr: request.tx,
            });
          } catch {
            // ignore logging error on upstream rejection
          }

          return {
            httpStatus: 400,
            body: {
              status: "rejected",
              error: "Compliance check temporarily unavailable. Try again.",
            },
          };
        }

        // 5b. Verify all payment participants have a trustline for the regulated asset
        for (const p of classified.payments) {
          const sourceState = accountStates.get(p.from);
          if (!sourceState || !sourceState.hasTrustline) {
            throw new PortcullisError(
              "NO_TRUSTLINE",
              `Payment source account ${p.from} does not have a trustline for ${deps.config.asset.code}:${deps.config.asset.issuer}`,
            );
          }
          const destState = accountStates.get(p.to);
          if (!destState || !destState.hasTrustline) {
            throw new PortcullisError(
              "NO_TRUSTLINE",
              `Payment destination account ${p.to} does not have a trustline for ${deps.config.asset.code}:${deps.config.asset.issuer}`,
            );
          }
        }

        // 6. Evaluate and aggregate rules
        const ruleContext: RuleContext = {
          txHash,
          nowMs,
          store: deps.stateStore,
          payments: classified.payments,
          accounts: accountStates,
        };

        const agg = await evaluateAndAggregate(deps.rules, ruleContext);

        for (const r of agg.results) {
          const logItem: RuleEvaluationLog = {
            id: r.ruleId,
            outcome: r.result.outcome,
          };
          if ("message" in r.result && r.result.message) {
            logItem.message = r.result.message;
          }
          if ("code" in r.result && r.result.code) {
            logItem.code = r.result.code;
          }
          ruleLogs.push(logItem);
        }

        if (agg.winningResult.outcome === "reject") {
          const { code, message } = agg.winningResult;
          const durationMs = Date.now() - startTime;
          try {
            deps.decisionLogger.log({
              timestamp: new Date().toISOString(),
              requestId,
              txHash,
              source: txSource,
              outcome: "rejected",
              rules: ruleLogs,
              errorCode: code,
              durationMs,
              xdr: request.tx,
            });
          } catch {
            // ignore log error
          }

          return {
            httpStatus: 400,
            body: {
              status: "rejected",
              error: message,
            },
          };
        }

        if (agg.winningResult.outcome === "pending") {
          const { timeoutMs, message } = agg.winningResult;
          const durationMs = Date.now() - startTime;
          try {
            deps.decisionLogger.log({
              timestamp: new Date().toISOString(),
              requestId,
              txHash,
              source: txSource,
              outcome: "pending",
              rules: ruleLogs,
              durationMs,
              xdr: request.tx,
            });
          } catch {
            // ignore log error
          }

          const body: ApprovalResponse = {
            status: "pending",
            timeout: timeoutMs,
          };
          if (message) {
            body.message = message;
          }

          return {
            httpStatus: 200,
            body,
          };
        }

        if (agg.winningResult.outcome === "action_required") {
          const { message, actionUrl, actionMethod, actionFields } = agg.winningResult;
          const durationMs = Date.now() - startTime;
          try {
            deps.decisionLogger.log({
              timestamp: new Date().toISOString(),
              requestId,
              txHash,
              source: txSource,
              outcome: "action_required",
              rules: ruleLogs,
              durationMs,
              xdr: request.tx,
            });
          } catch {
            // ignore log error
          }

          const body: ApprovalResponse = {
            status: "action_required",
            message,
          };
          if (actionUrl) {
            body.action_url = actionUrl;
          }
          if (actionMethod) {
            body.action_method = actionMethod;
          }
          if (actionFields) {
            body.action_fields = actionFields;
          }

          return {
            httpStatus: 200,
            body,
          };
        }

        // 7. Compose SEP-8 transaction
        const composeResult = compose(tx, classified, deps.config);

        // 8. Safe-to-sign guard
        assertSafeToSign(composeResult.tx, {
          issuer: deps.config.asset.issuer,
          assetCode: deps.config.asset.code,
          maxOperations: deps.config.approval.maxOperations,
        });

        // 9. Sign transaction with issuer key
        const signedTx = await sign(composeResult.tx, composeResult.revised, deps.signer);

        // 10. Reserve quota in state store
        const expiresAtMs = tx.timeBounds
          ? Number.parseInt(tx.timeBounds.maxTime, 10) * 1000
          : nowMs + deps.config.approval.maxTimeWindowSeconds * 1000;

        for (const payment of classified.payments) {
          await deps.stateStore.reserve({
            txHash,
            account: payment.from,
            asset: payment.asset,
            amount: payment.amount,
            direction: "out",
            expiresAtMs,
          });
          await deps.stateStore.reserve({
            txHash,
            account: payment.to,
            asset: payment.asset,
            amount: payment.amount,
            direction: "in",
            expiresAtMs,
          });
        }

        const durationMs = Date.now() - startTime;
        const outcome = composeResult.revised ? "revised" : "success";

        try {
          deps.decisionLogger.log({
            timestamp: new Date().toISOString(),
            requestId,
            txHash,
            source: txSource,
            outcome,
            rules: ruleLogs,
            durationMs,
            xdr: request.tx,
          });
        } catch {
          // ignore
        }

        const body: ApprovalResponse = composeResult.revised
          ? {
              status: "revised",
              tx: signedTx.toXDR(),
              ...(composeResult.message ? { message: composeResult.message } : {}),
            }
          : {
              status: "success",
              tx: signedTx.toXDR(),
              ...(composeResult.message ? { message: composeResult.message } : {}),
            };

        return {
          httpStatus: 200,
          body,
        };
      },
      lockMgr,
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;

    if (err instanceof PortcullisError) {
      const isInternal =
        err.code === "LOG_FAILURE" ||
        err.code === "INVALID_CONFIG" ||
        err.code === "UNSAFE_TO_SIGN";

      if (isInternal) {
        deps.onInternalError?.(err);
        try {
          deps.decisionLogger.log({
            timestamp: new Date().toISOString(),
            requestId,
            txHash,
            source: txSource,
            outcome: "rejected",
            rules: ruleLogs,
            errorCode: err.code,
            durationMs,
            xdr: request.tx,
          });
        } catch (logErr) {
          deps.onInternalError?.(logErr);
        }

        return {
          httpStatus: 500,
          body: {
            status: "rejected",
            error: "Request could not be processed.",
          },
        };
      }

      // Ordinary client-visible rejection
      try {
        deps.decisionLogger.log({
          timestamp: new Date().toISOString(),
          requestId,
          txHash,
          source: txSource,
          outcome: "rejected",
          rules: ruleLogs,
          errorCode: err.code,
          durationMs,
          xdr: request.tx,
        });
      } catch {
        // ignore log error
      }

      return {
        httpStatus: 400,
        body: {
          status: "rejected",
          error: err.message,
        },
      };
    }

    // Unexpected runtime exception
    deps.onInternalError?.(err);
    try {
      deps.decisionLogger.log({
        timestamp: new Date().toISOString(),
        requestId,
        txHash,
        source: txSource,
        outcome: "rejected",
        rules: ruleLogs,
        errorCode: "INTERNAL_ERROR",
        durationMs,
        xdr: request.tx,
      });
    } catch (logErr) {
      deps.onInternalError?.(logErr);
    }

    return {
      httpStatus: 500,
      body: {
        status: "rejected",
        error: "Request could not be processed.",
      },
    };
  }
}
