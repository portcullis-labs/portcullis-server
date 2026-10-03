import { describe, expect, it } from "vitest";
import { type ErrorCode, PortcullisError } from "../src/errors.js";

describe("PortcullisError", () => {
  it("should instantiate with code, message, and default 400 status", () => {
    const err = new PortcullisError("MALFORMED_XDR", "Invalid transaction XDR");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PortcullisError);
    expect(err.name).toBe("PortcullisError");
    expect(err.code).toBe("MALFORMED_XDR");
    expect(err.message).toBe("Invalid transaction XDR");
    expect(err.httpStatus).toBe(400);
  });

  it("should allow setting custom 500 status", () => {
    const err = new PortcullisError("INTERNAL", "Unexpected failure", 500);
    expect(err.code).toBe("INTERNAL");
    expect(err.httpStatus).toBe(500);
  });

  it("should support all defined error codes", () => {
    const codes: ErrorCode[] = [
      "MALFORMED_XDR",
      "WRONG_NETWORK",
      "UNSUPPORTED_FEE_BUMP",
      "UNSUPPORTED_OPERATION",
      "BAD_REQUESTER_SIGNATURE",
      "MISSING_TIMEBOUND",
      "TIMEBOUND_TOO_FAR",
      "RULE_REJECTED",
      "UNSAFE_TO_SIGN",
      "UPSTREAM_UNAVAILABLE",
      "INVALID_CONFIG",
      "INTERNAL",
    ];

    for (const code of codes) {
      const err = new PortcullisError(code, `Error for ${code}`);
      expect(err.code).toBe(code);
    }
  });
});
