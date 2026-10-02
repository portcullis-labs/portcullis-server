import { describe, expect, it } from "vitest";
import { getVersion, VERSION } from "../src/version.js";

describe("version module", () => {
  it("should export the correct version string", () => {
    expect(VERSION).toBe("0.1.0");
  });

  it("should return the version via getVersion function", () => {
    expect(getVersion()).toBe("0.1.0");
  });
});
