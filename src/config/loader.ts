import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { PortcullisError } from "../errors.js";
import { configSchema, type PortcullisConfig } from "./schema.js";

/**
 * Parses and validates a YAML configuration string against the Portcullis config schema.
 */
export function loadConfigFromYaml(yamlString: string): PortcullisConfig {
  if (typeof yamlString !== "string" || yamlString.trim() === "") {
    throw new PortcullisError("INVALID_CONFIG", "Configuration content is empty or invalid string");
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = parse(yamlString);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new PortcullisError("INVALID_CONFIG", `Failed to parse YAML configuration: ${errorMsg}`);
  }

  if (typeof parsedRaw !== "object" || parsedRaw === null || Array.isArray(parsedRaw)) {
    throw new PortcullisError("INVALID_CONFIG", "YAML configuration must be a mapping/object");
  }

  const result = configSchema.safeParse(parsedRaw);
  if (!result.success) {
    const issueMessages = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new PortcullisError(
      "INVALID_CONFIG",
      `Configuration validation failed: ${issueMessages}`,
    );
  }

  return result.data;
}

/**
 * Reads a YAML file from disk, parses and validates it against the Portcullis config schema.
 */
export function loadConfigFile(filePath: string): PortcullisConfig {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new PortcullisError(
      "INVALID_CONFIG",
      `Unable to read configuration file at "${filePath}": ${errorMsg}`,
    );
  }

  return loadConfigFromYaml(content);
}
