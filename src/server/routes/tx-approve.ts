import type { Context } from "hono";
import { type ApprovalDependencies, runApproval } from "../../pipeline/runner.js";
import { parseTxApproveRequest } from "../parse-request.js";

/**
 * Handles POST /tx_approve requests per SEP-8 specification.
 */
export async function handleTxApprove(c: Context, deps: ApprovalDependencies) {
  const parsed = await parseTxApproveRequest(c);
  if (!parsed.success) {
    return c.json({ status: "rejected", error: parsed.error }, parsed.httpStatus);
  }

  const result = await runApproval({ tx: parsed.tx }, deps);
  return c.json(result.body, result.httpStatus as 200 | 400 | 500);
}
