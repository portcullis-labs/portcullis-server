export type ErrorCode =
  | "MALFORMED_XDR"
  | "UNSUPPORTED_FEE_BUMP"
  | "UNSUPPORTED_OPERATION"
  | "BAD_REQUESTER_SIGNATURE"
  | "MISSING_TIMEBOUND"
  | "TIMEBOUND_EXPIRED"
  | "TIMEBOUND_TOO_FAR"
  | "NO_TRUSTLINE"
  | "RULE_REJECTED"
  | "UNSAFE_TO_SIGN"
  | "UPSTREAM_UNAVAILABLE"
  | "INVALID_CONFIG"
  | "LOG_FAILURE"
  | "INTERNAL";

export class PortcullisError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: 400 | 500;

  constructor(code: ErrorCode, message: string, httpStatus: 400 | 500 = 400) {
    super(message);
    this.name = "PortcullisError";
    this.code = code;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
