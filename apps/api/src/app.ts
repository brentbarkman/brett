import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth.js";
import { users } from "./routes/users.js";
import { things } from "./routes/things.js";
import { lists } from "./routes/lists.js";
import { attachments } from "./routes/attachments.js";
import { links } from "./routes/links.js";

export const app = new Hono();

// #9: CORS — only allow localhost origins in local dev, Electron in all envs
const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (origin === "app://.") return origin;
      if (isLocal && origin.match(/^http:\/\/localhost:\d+$/)) return origin;
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/auth", authRouter);
app.route("/users", users);
app.route("/things", things);
app.route("/lists", lists);
app.route("/things", attachments);
app.route("/things", links);
