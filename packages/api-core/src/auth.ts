import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";

export interface AuthOptions {
  trustedOrigins: string[] | ((request?: Request) => (string | null | undefined)[]);
  enableEmailPassword?: boolean;
  enableDeleteUser?: boolean;
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: options.enableEmailPassword ?? true,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          fieldName: "role",
          input: false,
        },
      },
      deleteUser: {
        enabled: options.enableDeleteUser ?? true,
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    plugins: [bearer()],
    trustedOrigins: options.trustedOrigins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
