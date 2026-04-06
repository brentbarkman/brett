// Polyfill crypto for Node 18 (better-auth needs it globally)
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import { beforeEach } from "vitest";
import { clearAllRateLimits } from "../middleware/rate-limit.js";

// Test setup — set env vars before anything imports
process.env.DATABASE_URL = "postgresql://brett:brett_dev@localhost:5432/brett_test";
process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
process.env.BETTER_AUTH_URL = "http://localhost:3001";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";

// Clear rate limits before each test to prevent cross-test 429s
beforeEach(() => {
  clearAllRateLimits();
});
