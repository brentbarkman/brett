import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth.js";
import { authIOS } from "./routes/auth-ios.js";
import { users } from "./routes/users.js";
import { things } from "./routes/things.js";
import { lists } from "./routes/lists.js";
import { attachments } from "./routes/attachments.js";
import { links } from "./routes/links.js";
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
import { knowledgeGraph } from "./routes/knowledge-graph.js";
import { weather } from "./routes/weather.js";
import { importRoutes } from "./routes/import.js";
import { download } from "./routes/download.js";
import { config } from "./routes/config.js";
import { wellKnown } from "./routes/well-known.js";
import { scouts } from "./routes/scouts.js";
import { devices } from "./routes/devices.js";
import { sync } from "./routes/sync.js";
import { feedback } from "./routes/feedback.js";
import { newsletterWebhook, newsletterSenders } from "./routes/newsletters.js";
import { internalScoutsRouter } from "./routes/internal-scouts.js";
import searchRouter from "./routes/search.js";
import suggestionsRouter from "./routes/suggestions.js";
import adminEmbeddings from "./routes/admin-embeddings.js";
import { storageProxy } from "./routes/storage-proxy.js";
import { releaseProxy } from "./routes/release-proxy.js";
import { startCronJobs } from "./jobs/cron.js";
import { startMemoryConsolidation } from "./jobs/memory-consolidation.js";
import { setEmbedProcessor, getProvider } from "@brett/ai";
import type { AIProviderName } from "@brett/types";
import { getEmbeddingProvider } from "./lib/embedding-provider.js";
import { decryptToken } from "./lib/encryption.js";
import { prisma, initPrisma } from "./lib/prisma.js";

export const app = new Hono();

// #9: CORS — only allow localhost origins in local dev, Electron in all envs
const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Non-browser clients (iOS, curl, React Native) send no Origin header.
      // For those, return null — CORS only matters to browsers, and they
      // always send an Origin. Returning "*" with credentials: true was
      // spec-invalid and still leaked a permissive header to downstream
      // caches/proxies. Bearer-auth clients work regardless.
      if (!origin) return null;
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

// Internal routes (no auth — secret-gated)
app.route("/internal/scouts", internalScoutsRouter);

// Public routes (no auth)
app.route("/download", download);
app.route("/config", config);
app.route("/public", storageProxy);
app.route("/releases", releaseProxy);
// Apple / Google / web platform well-known endpoints. Apple fetches the
// AASA file from here directly to verify associated domains for passkeys.
app.route("/.well-known", wellKnown);

// Routes
// Native-mobile Google sign-in: iOS client posts an ID token minted by
// GoogleSignIn-iOS; server verifies + exchanges for a Brett session.
// Must be mounted BEFORE authRouter because authRouter has a `/*` catch-all
// that forwards to better-auth, which would otherwise swallow this path.
app.route("/api/auth/ios", authIOS);
app.route("/api/auth", authRouter);
app.route("/users", users);
app.route("/things", things);
app.route("/lists", lists);
app.route("/things", attachments);
app.route("/things", links);
app.route("/things", extract);
app.route("/calendar", calendar);
app.route("/calendar/accounts", calendarAccounts);
app.route("/ai", aiConfig);
app.route("/ai/usage", aiUsage);
app.route("/brett/omnibar", brettOmnibar);
app.route("/brett/chat", brettChat);
app.route("/brett", brettIntelligence);
app.route("/brett/memory", brettMemory);
app.route("/api/graph", knowledgeGraph);
app.route("/weather", weather);
app.route("/import", importRoutes);
app.route("/events", sse);
app.route("/webhooks", webhooks);
app.route("/webhooks", newsletterWebhook);
app.route("/granola/auth", granolaAuth);
app.route("/scouts", scouts);
app.route("/devices", devices);
app.route("/sync", sync);
app.route("/feedback", feedback);
app.route("/newsletters/senders", newsletterSenders);
app.route("/api", searchRouter);
app.route("/api", suggestionsRouter);
app.route("/admin/embeddings", adminEmbeddings);

// Initialize embedding pipeline (no-op if EMBEDDING_API_KEY is not set)
const embeddingProvider = getEmbeddingProvider();
if (embeddingProvider) {
  setEmbedProcessor(async (job) => {
    const { embedEntity } = await import("@brett/ai");

    // Resolve AI chat provider for entity fact extraction (best-effort, non-blocking)
    let aiProvider;
    let aiProviderName: AIProviderName | undefined;
    if (["item", "meeting_note"].includes(job.entityType)) {
      try {
        const config = await prisma.userAIConfig.findFirst({
          where: { userId: job.userId, isActive: true, isValid: true },
        });
        if (config) {
          const apiKey = decryptToken(config.encryptedKey);
          aiProviderName = config.provider as AIProviderName;
          aiProvider = getProvider(aiProviderName, apiKey);
        }
      } catch {
        // No AI config — skip fact extraction, embedding still proceeds
      }
    }

    await embedEntity({
      entityType: job.entityType,
      entityId: job.entityId,
      userId: job.userId,
      provider: embeddingProvider,
      prisma,
      skipAutoLink: job.skipAutoLink,
      aiProvider,
      aiProviderName,
    });
  });
}

startCronJobs();
startMemoryConsolidation();

// Tune HNSW ef_search for better vector recall
initPrisma().catch((err: unknown) => console.error("[startup] HNSW tuning failed:", err));

// Reconcile embeddings on startup — catches items missed during restarts.
// Delayed 30s to let the server warm up and avoid competing with initial requests.
if (embeddingProvider) {
  setTimeout(async () => {
    try {
      const { runEmbeddingBackfill } = await import("./lib/embedding-backfill.js");
      const result = await runEmbeddingBackfill();
      if (result.processed > 0) {
        console.log(`[startup] Embedding reconciliation: ${result.processed} entities backfilled`);
      }
    } catch (err) {
      console.error("[startup] Embedding reconciliation failed:", err);
    }
  }, 30_000);
}
