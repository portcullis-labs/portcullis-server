import process from "node:process";

export const VERSION = "0.1.0";

export function getVersion(): string {
  return VERSION;
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("version.js") || process.argv[1].endsWith("version.ts"))
) {
  console.log(`portcullis-server v${VERSION}`);
}
