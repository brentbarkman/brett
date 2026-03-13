import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";

const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [bearer()],
  trustedOrigins: isLocal
    ? (request) => {
        const origin = request?.headers.get("origin") ?? "";
        if (origin === "app://." || /^http:\/\/localhost:\d+$/.test(origin))
          return [origin];
        return [];
      }
    : [
        "app://.",
        process.env.BETTER_AUTH_URL!, // API's own origin (for desktop OAuth HTML page)
      ],
});
