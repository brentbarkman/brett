import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth.js";
import { users } from "./routes/users.js";
import { things } from "./routes/things.js";
import { lists } from "./routes/lists.js";
import { attachments } from "./routes/attachments.js";
import { links } from "./routes/links.js";
import { brett } from "./routes/brett.js";
import calendar from "./routes/calendar.js";
import calendarAccounts from "./routes/calendar-accounts.js";
import sse from "./routes/sse.js";
import webhooks from "./routes/webhooks.js";
import granolaAuth from "./routes/granola-auth.js";
import extract from "./routes/extract.js";
import { aiConfig } from "./routes/ai-config.js";
import { aiUsage } from "./routes/ai-usage.js";
import { brettOmnibar } from "./routes/brett-omnibar.js";
import { brettChat } from "./routes/brett-chat.js";
import { brettIntelligence } from "./routes/brett-intelligence.js";
import { brettMemory } from "./routes/brett-memory.js";
import { weather } from "./routes/weather.js";
import { importRoutes } from "./routes/import.js";
import { download } from "./routes/download.js";
import { config } from "./routes/config.js";
import { scouts } from "./routes/scouts.js";
import { startCronJobs } from "./jobs/cron.js";

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
    allowHeaders: ["Content-Type", "Authorization", "X-Filename"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Public routes (no auth)
app.route("/download", download);
app.route("/config", config);

// Routes
app.route("/api/auth", authRouter);
app.route("/users", users);
app.route("/things", things);
app.route("/lists", lists);
app.route("/things", attachments);
app.route("/things", links);
app.route("/things", brett);
app.route("/things", extract);
app.route("/calendar", calendar);
app.route("/calendar/accounts", calendarAccounts);
app.route("/ai", aiConfig);
app.route("/ai/usage", aiUsage);
app.route("/brett/omnibar", brettOmnibar);
app.route("/brett/chat", brettChat);
app.route("/brett", brettIntelligence);
app.route("/brett/memory", brettMemory);
app.route("/weather", weather);
app.route("/import", importRoutes);
app.route("/events", sse);
app.route("/webhooks", webhooks);
app.route("/granola/auth", granolaAuth);
app.route("/scouts", scouts);

startCronJobs();
