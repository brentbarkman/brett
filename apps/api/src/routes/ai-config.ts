import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { resolveRelinkTask } from "../lib/connection-health.js";
import type { AIProviderName } from "@brett/types";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const VALID_PROVIDERS: AIProviderName[] = ["anthropic", "openai", "google"];

const aiConfig = new Hono<AuthEnv>();

// All routes require auth
aiConfig.use("*", authMiddleware);

/** Human-readable mask showing the saved key prefix (e.g. "sk-ant…xxxx"). */
function maskKey(keyPrefix: string | null): string {
  if (keyPrefix && keyPrefix.length > 0) {
    return `${keyPrefix}…xxxx`;
  }
  return "…xxxx";
}

/** Validate an API key by making a lightweight, non-billing API call */
async function validateApiKey(
  provider: AIProviderName,
  apiKey: string
): Promise<boolean> {
  switch (provider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey });
      await client.models.list({ limit: 1 });
      return true;
    }
    case "openai": {
      const client = new OpenAI({ apiKey });
      await client.models.list();
      return true;
    }
    case "google": {
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
      await model.countTokens("test");
      return true;
    }
    default:
      return false;
  }
}

// GET /ai/config — List user's configured providers (keys redacted)
aiConfig.get("/config", async (c) => {
  const user = c.get("user");
  const configs = await prisma.userAIConfig.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  return c.json({
    configs: configs.map((cfg) => ({
      id: cfg.id,
      provider: cfg.provider,
      isValid: cfg.isValid,
      isActive: cfg.isActive,
      maskedKey: maskKey(cfg.keyPrefix),
      createdAt: cfg.createdAt.toISOString(),
      updatedAt: cfg.updatedAt.toISOString(),
    })),
  });
});

// POST /ai/config — Add/update a provider key (validates before saving)
// Rate limited aggressively: validateApiKey() makes upstream calls to
// Anthropic/OpenAI/Google, so this is the brute-force surface for a leaked
// bearer token trying to enumerate valid third-party keys.
aiConfig.post("/config", rateLimiter(3), async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { provider, apiKey } = body as {
    provider: string;
    apiKey: string;
  };

  if (!provider || !apiKey) {
    return c.json({ error: "provider and apiKey are required" }, 400);
  }

  if (!VALID_PROVIDERS.includes(provider as AIProviderName)) {
    return c.json(
      { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}` },
      400
    );
  }

  const providerName = provider as AIProviderName;

  // Validate the key before saving
  try {
    await validateApiKey(providerName, apiKey);
  } catch {
    return c.json(
      { error: "invalid_api_key", message: "That API key didn't work. Double-check it and try again." },
      400
    );
  }

  const encryptedKey = encryptToken(apiKey);
  const keyPrefix = apiKey.trim().slice(0, 6);

  // Upsert the config and activate it (deactivate all others) in a transaction
  const config = await prisma.$transaction(async (tx) => {
    // Deactivate all existing configs for this user
    await tx.userAIConfig.updateMany({
      where: { userId: user.id },
      data: { isActive: false },
    });

    // Upsert the provider config
    return tx.userAIConfig.upsert({
      where: {
        userId_provider: { userId: user.id, provider: providerName },
      },
      create: {
        userId: user.id,
        provider: providerName,
        encryptedKey,
        keyPrefix,
        isValid: true,
        isActive: true,
      },
      update: {
        encryptedKey,
        keyPrefix,
        isValid: true,
        isActive: true,
      },
    });
  });

  // Resolve any existing re-link task for AI
  await resolveRelinkTask(user.id, "ai").catch((e) =>
    console.error("[ai-config] Failed to resolve re-link task:", e),
  );

  return c.json(
    {
      id: config.id,
      provider: config.provider,
      isValid: config.isValid,
      isActive: config.isActive,
      maskedKey: maskKey(config.keyPrefix),
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    },
    201
  );
});

// PUT /ai/config/:id/activate — Set a provider as active
aiConfig.put("/config/:id/activate", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Verify ownership
  const config = await prisma.userAIConfig.findFirst({
    where: { id, userId: user.id },
  });

  if (!config) {
    return c.json({ error: "Not found" }, 404);
  }

  // Deactivate all, activate this one
  await prisma.$transaction([
    prisma.userAIConfig.updateMany({
      where: { userId: user.id },
      data: { isActive: false },
    }),
    prisma.userAIConfig.update({
      where: { id },
      data: { isActive: true },
    }),
  ]);

  return c.json({ ok: true });
});

// DELETE /ai/config/:id — Remove a stored key
aiConfig.delete("/config/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Verify ownership
  const config = await prisma.userAIConfig.findFirst({
    where: { id, userId: user.id },
  });

  if (!config) {
    return c.json({ error: "Not found" }, 404);
  }

  await prisma.userAIConfig.delete({ where: { id } });

  // Resolve any existing re-link task — user is in a valid state now (no AI configured)
  await resolveRelinkTask(user.id, "ai").catch((e) =>
    console.error("[ai-config] Failed to resolve re-link task:", e),
  );

  return c.json({ ok: true });
});

export { aiConfig };
