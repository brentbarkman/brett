import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";

const users = new Hono<AuthEnv>();

// GET /users/me — return the current authenticated user
users.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.image,
  });
});

export { users };
