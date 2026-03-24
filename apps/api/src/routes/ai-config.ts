import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import type { AIProviderName } from "@brett/types";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const VALID_PROVIDERS: AIProviderName[] = ["anthropic", "openai", "google"];

const aiConfig = new Hono<AuthEnv>();

// All routes require auth
aiConfig.use("*", authMiddleware);

/** Mask an encrypted key for display: show first 7 chars of the original key concept + "...xxxx" */
function maskKey(encryptedKey: string): string {
  // The encrypted key is in format "iv:encrypted:tag" — we can't recover the original.
  // Show first 7 chars of the encrypted blob as an identifier + mask.
  const display = encryptedKey.substring(0, 7);
  return `${display}...xxxx`;
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

  return c.json(
    configs.map((cfg) => ({
      id: cfg.id,
      provider: cfg.provider,
      isValid: cfg.isValid,
      isActive: cfg.isActive,
      maskedKey: maskKey(cfg.encryptedKey),
      createdAt: cfg.createdAt.toISOString(),
      updatedAt: cfg.updatedAt.toISOString(),
    }))
  );
});

// POST /ai/config — Add/update a provider key (validates before saving)
// Rate limited: max 5 per minute
aiConfig.post("/config", rateLimiter(5), async (c) => {
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
      { error: "invalid_api_key", message: "API key validation failed. Please check your key." },
      400
    );
  }

  const encryptedKey = encryptToken(apiKey);

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
        isValid: true,
        isActive: true,
      },
      update: {
        encryptedKey,
        isValid: true,
        isActive: true,
      },
    });
  });

  return c.json(
    {
      id: config.id,
      provider: config.provider,
      isValid: config.isValid,
      isActive: config.isActive,
      maskedKey: maskKey(config.encryptedKey),
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

  return c.json({ ok: true });
});

export { aiConfig };
