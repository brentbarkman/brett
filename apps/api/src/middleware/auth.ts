import { createAuthMiddleware } from "@brett/api-core";
import type { AuthEnv as CoreAuthEnv } from "@brett/api-core";
import { auth } from "../lib/auth.js";

export type AuthEnv = CoreAuthEnv;
export const authMiddleware = createAuthMiddleware(auth);
