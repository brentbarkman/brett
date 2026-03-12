import { Hono } from "hono";
import { auth } from "../lib/auth.js";

const authRouter = new Hono();

// Mount better-auth handler — handles all /api/auth/* routes
authRouter.on(["POST", "GET"], "/*", (c) => auth.handler(c.req.raw));

export { authRouter };
