import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./auth.js";
import { prisma } from "../lib/prisma.js";
import { decryptToken } from "../lib/encryption.js";
import { createRelinkTask } from "../lib/connection-health.js";
import { getProvider } from "@brett/ai";
import type { AIProvider } from "@brett/ai";
import type { AIProviderName } from "@brett/types";

export type AIEnv = AuthEnv & {
  Variables: AuthEnv["Variables"] & {
    aiProvider: AIProvider;
    aiProviderName: AIProviderName;
  };
};

export const aiMiddleware = createMiddleware<AIEnv>(async (c, next) => {
  const user = c.get("user");
  const config = await prisma.userAIConfig.findFirst({
    where: { userId: user.id, isActive: true, isValid: true },
  });
  if (!config) {
    return c.json(
      {
        error: "ai_not_configured",
        message: "Configure an AI provider in Settings",
      },
      403
    );
  }
  try {
    const apiKey = decryptToken(config.encryptedKey);
    const provider = getProvider(config.provider as AIProviderName, apiKey);
    c.set("aiProvider", provider);
    c.set("aiProviderName", config.provider as AIProviderName);
  } catch {
    await prisma.userAIConfig.update({
      where: { id: config.id },
      data: { isValid: false },
    });
    await createRelinkTask(
      user.id, "ai", config.id,
      `Your ${config.provider} API key is no longer valid. Go to Settings → AI Provider to enter a new key.`,
    ).catch((e) => console.error("[ai-middleware] Failed to create re-link task:", e));
    return c.json(
      {
        error: "ai_key_invalid",
        message: "Your API key is no longer valid",
      },
      403
    );
  }
  return next();
});
