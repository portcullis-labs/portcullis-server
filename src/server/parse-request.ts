import type { Context } from "hono";

export const MAX_BODY_BYTES = 64 * 1024; // 64 KB

export type ParsedRequestResult =
  | { success: true; tx: string }
  | { success: false; httpStatus: 400 | 413; error: string };

/**
 * Parses and validates the request body for POST /tx_approve.
 * Supports application/json and application/x-www-form-urlencoded.
 * Enforces a 64KB size limit.
 */
export async function parseTxApproveRequest(c: Context): Promise<ParsedRequestResult> {
  const contentType = c.req.header("content-type") ?? "";

  // Check content-length header if provided
  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
      return {
        success: false,
        httpStatus: 413,
        error: `Payload exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes.`,
      };
    }
  }

  // Read raw body bytes to enforce size limit reliably
  let rawBody: string;
  try {
    const arrayBuffer = await c.req.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BODY_BYTES) {
      return {
        success: false,
        httpStatus: 413,
        error: `Payload exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes.`,
      };
    }
    rawBody = new TextDecoder().decode(arrayBuffer);
  } catch (_err) {
    return {
      success: false,
      httpStatus: 400,
      error: "Failed to read request body.",
    };
  }

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          success: false,
          httpStatus: 400,
          error: "Request body must be a JSON object with a 'tx' property.",
        };
      }
      const tx = (parsed as { tx?: unknown }).tx;
      if (typeof tx !== "string" || tx.trim() === "") {
        return {
          success: false,
          httpStatus: 400,
          error: "Missing or invalid 'tx' parameter in JSON body.",
        };
      }
      return { success: true, tx: tx.trim() };
    } catch (_err) {
      return {
        success: false,
        httpStatus: 400,
        error: "Malformed JSON payload.",
      };
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const params = new URLSearchParams(rawBody);
      const tx = params.get("tx");
      if (!tx || tx.trim() === "") {
        return {
          success: false,
          httpStatus: 400,
          error: "Missing or invalid 'tx' parameter in form body.",
        };
      }
      return { success: true, tx: tx.trim() };
    } catch (_err) {
      return {
        success: false,
        httpStatus: 400,
        error: "Malformed form-urlencoded payload.",
      };
    }
  }

  return {
    success: false,
    httpStatus: 400,
    error:
      "Unsupported Content-Type. Expected application/json or application/x-www-form-urlencoded.",
  };
}
