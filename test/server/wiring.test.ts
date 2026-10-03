import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/server/index.js";

describe("server CLI argument parsing and wiring", () => {
  it("parses default CLI args", () => {
    const parsed = parseCliArgs([]);
    expect(parsed.configPath).toBe("./portcullis.yaml");
    expect(parsed.skipIssuerCheck).toBe(false);
    expect(parsed.portOverride).toBeUndefined();
  });

  it("parses custom config path, port, and skipIssuerCheck flags", () => {
    const parsed = parseCliArgs([
      "--config",
      "/custom/path.yaml",
      "--skip-issuer-check",
      "--port",
      "9000",
    ]);
    expect(parsed.configPath).toBe("/custom/path.yaml");
    expect(parsed.skipIssuerCheck).toBe(true);
    expect(parsed.portOverride).toBe(9000);
  });

  it("throws on missing config argument value", () => {
    expect(() => parseCliArgs(["--config"])).toThrow("Missing value for --config");
  });

  it("throws on invalid port argument value", () => {
    expect(() => parseCliArgs(["--port", "invalid"])).toThrow("Invalid port number");
    expect(() => parseCliArgs(["--port", "70000"])).toThrow("Invalid port number");
  });
});
