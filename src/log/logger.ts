import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PortcullisError } from "../errors.js";

export interface RuleEvaluationLog {
  id: string;
  outcome: "pass" | "reject" | "pending" | "action_required";
  message?: string;
  code?: string;
}

export interface DecisionLogEntry {
  timestamp: string; // ISO 8601
  requestId: string;
  txHash: string;
  source: string;
  outcome: "success" | "revised" | "pending" | "action_required" | "rejected";
  rules: RuleEvaluationLog[];
  errorCode?: string;
  durationMs: number;
  xdr?: string;
}

export interface DecisionLoggerOptions {
  path: string;
  includeXdr: boolean;
}

export class DecisionLogger {
  constructor(private readonly options: DecisionLoggerOptions) {}

  log(entry: DecisionLogEntry): void {
    try {
      const dir = dirname(this.options.path);
      if (dir && dir !== ".") {
        mkdirSync(dir, { recursive: true });
      }

      const logRecord: DecisionLogEntry = {
        timestamp: entry.timestamp,
        requestId: entry.requestId,
        txHash: entry.txHash,
        source: entry.source,
        outcome: entry.outcome,
        rules: entry.rules,
        durationMs: entry.durationMs,
      };

      if (entry.errorCode !== undefined) {
        logRecord.errorCode = entry.errorCode;
      }

      if (this.options.includeXdr && entry.xdr !== undefined) {
        logRecord.xdr = entry.xdr;
      }

      const line = `${JSON.stringify(logRecord)}\n`;
      appendFileSync(this.options.path, line, "utf-8");
    } catch (err) {
      if (err instanceof PortcullisError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new PortcullisError("LOG_FAILURE", `Failed to write decision log: ${message}`);
    }
  }
}
