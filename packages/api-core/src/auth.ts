import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, validatePassword } from "@brett/utils";
// Use better-auth's default scrypt hasher — import statically to avoid top-level await issues
import { hashPassword as defaultHash, verifyPassword as defaultVerify } from "better-auth/crypto";

export interface AuthOptions {
  trustedOrigins: string[] | ((request?: Request) => (string | null | undefined)[]);
  enableEmailPassword?: boolean;
  enableDeleteUser?: boolean;
  enablePasskeys?: boolean;
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: options.enableEmailPassword ?? true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: {
        async hash(password: string): Promise<string> {
          const error = validatePassword(password);
          if (error) throw new Error(error);
          return defaultHash(password);
        },
        verify: defaultVerify,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          fieldName: "role",
          input: false,
        },
        banned: {
          type: "boolean",
          defaultValue: false,
          fieldName: "banned",
          input: false,
        },
        banReason: {
          type: "string",
          required: false,
          fieldName: "banReason",
          input: false,
        },
      },
      deleteUser: {
        enabled: options.enableDeleteUser ?? true,
      },
    },
    // SECURITY WARNING: Mobile OAuth callbacks MUST use Universal Links
    // (https://brett.app/auth/callback) with PKCE, NOT custom URL schemes
    // (brett://). See spec Addendum B, finding B3.
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      ...(process.env.APPLE_CLIENT_ID ? {
        apple: {
          clientId: process.env.APPLE_CLIENT_ID,
          clientSecret: process.env.APPLE_CLIENT_SECRET!,
        },
      } : {}),
    },
    plugins: [
      bearer(),
      ...(options.enablePasskeys ? [passkey()] : []),
    ],
    trustedOrigins: options.trustedOrigins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
