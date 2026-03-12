import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth.js";
import { users } from "./routes/users.js";

export const app = new Hono();

// CORS — allow desktop dev server and Electron production
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = ["http://localhost:5173", "app://.", "file://"];
      // Electron file:// sends null origin
      if (!origin || allowed.includes(origin)) return origin ?? "*";
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/api/auth", authRouter);
app.route("/users", users);
