import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getVersion, VERSION } from "../src/version.js";

describe("version module", () => {
  it("should export the correct version string", () => {
    expect(VERSION).toBe("0.1.0");
  });

  it("should return the version via getVersion function", () => {
    expect(getVersion()).toBe("0.1.0");
  });

  it("should match the version in package.json", () => {
    const pkgJsonPath = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
