import type { Context } from "hono";
import { VERSION } from "../../version.js";

/**
 * Handles GET /health requests.
 */
export function handleHealth(c: Context) {
  return c.json({ ok: true, version: VERSION });
}
