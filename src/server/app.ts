import { Hono } from "hono";

export function createServerApp() {
  const app = new Hono();

  // CORS middleware: set Access-Control-Allow-Origin: * on all responses and handle OPTIONS preflight
  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      return c.body(null, 204);
    }
    await next();
    c.header("Access-Control-Allow-Origin", "*");
  });

  return app;
}
