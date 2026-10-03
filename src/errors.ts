export type ErrorCode =
  | "MALFORMED_XDR"
  | "WRONG_NETWORK"
  | "UNSUPPORTED_FEE_BUMP"
  | "UNSUPPORTED_OPERATION"
  | "BAD_REQUESTER_SIGNATURE"
  | "MISSING_TIMEBOUND"
  | "TIMEBOUND_TOO_FAR"
  | "RULE_REJECTED"
  | "UNSAFE_TO_SIGN"
  | "UPSTREAM_UNAVAILABLE"
  | "INVALID_CONFIG"
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
