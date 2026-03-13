import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth.js";
import { users } from "./routes/users.js";
import { things } from "./routes/things.js";
import { lists } from "./routes/lists.js";

export const app = new Hono();

// #9: CORS — only allow localhost origin in local dev
const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");
const allowedOrigins = isLocal
  ? ["http://localhost:5173", "app://."]
  : ["app://."];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
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
