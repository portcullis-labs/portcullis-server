import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortcullisError } from "../../src/errors.js";
import { type DecisionLogEntry, DecisionLogger } from "../../src/log/logger.js";

describe("DecisionLogger", () => {
  const testLogPath = join(process.cwd(), "scratch/test-decision.log");

  beforeEach(() => {
    if (existsSync(testLogPath)) {
      rmSync(testLogPath, { force: true });
    }
  });

  afterEach(() => {
    if (existsSync(testLogPath)) {
      rmSync(testLogPath, { force: true });
    }
  });

  const sampleEntry: DecisionLogEntry = {
    timestamp: new Date().toISOString(),
    requestId: "req-12345",
    txHash: "0000000000000000000000000000000000000000000000000000000000000001",
    source: "GCAXSG5YHH7G5HDCXAWX4PJA2P2Y2RCL2V45E3N7276X5P7XNYO3B7M2",
    outcome: "success",
    rules: [
      { id: "per_tx_limit", outcome: "pass" },
      { id: "holding_cap", outcome: "pass" },
    ],
    durationMs: 15,
    xdr: "AAAAAG...",
  };

  it("writes valid JSON-lines record with all required fields (omits xdr when includeXdr is false)", () => {
    const logger = new DecisionLogger({
      path: testLogPath,
      includeXdr: false,
    });

    logger.log(sampleEntry);

    const content = readFileSync(testLogPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);

    const firstLine = lines[0];
    expect(firstLine).toBeDefined();
    if (firstLine) {
      const parsed = JSON.parse(firstLine);
      expect(parsed.requestId).toBe("req-12345");
      expect(parsed.txHash).toBe(sampleEntry.txHash);
      expect(parsed.source).toBe(sampleEntry.source);
      expect(parsed.outcome).toBe("success");
      expect(parsed.rules).toHaveLength(2);
      expect(parsed.durationMs).toBe(15);
      expect(parsed.xdr).toBeUndefined();
    }
  });

  it("includes xdr when includeXdr is true", () => {
    const logger = new DecisionLogger({
      path: testLogPath,
      includeXdr: true,
    });

    logger.log(sampleEntry);

    const content = readFileSync(testLogPath, "utf-8");
    const lines = content.trim().split("\n");
    const firstLine = lines[0];
    expect(firstLine).toBeDefined();
    if (firstLine) {
      const parsed = JSON.parse(firstLine);
      expect(parsed.xdr).toBe("AAAAAG...");
    }
  });

  it("appends multiple log entries", () => {
    const logger = new DecisionLogger({
      path: testLogPath,
      includeXdr: false,
    });

    logger.log(sampleEntry);
    logger.log({
      ...sampleEntry,
      requestId: "req-67890",
      outcome: "rejected",
      errorCode: "CAP_EXCEEDED",
    });

    const content = readFileSync(testLogPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);

    const secondLine = lines[1];
    expect(secondLine).toBeDefined();
    if (secondLine) {
      const parsed2 = JSON.parse(secondLine);
      expect(parsed2.requestId).toBe("req-67890");
      expect(parsed2.outcome).toBe("rejected");
      expect(parsed2.errorCode).toBe("CAP_EXCEEDED");
    }
  });

  it("fails closed with LOG_FAILURE when log path is unwritable", () => {
    const unwritablePath = "/dev/null/impossible_dir/decision.log";
    const logger = new DecisionLogger({
      path: unwritablePath,
      includeXdr: false,
    });

    expect(() => logger.log(sampleEntry)).toThrow(PortcullisError);

    try {
      logger.log(sampleEntry);
    } catch (err) {
      expect(err).toBeInstanceOf(PortcullisError);
      expect((err as PortcullisError).code).toBe("LOG_FAILURE");
    }
  });
});
