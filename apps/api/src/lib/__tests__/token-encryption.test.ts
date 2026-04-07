import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "../encryption";

describe("token-encryption", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("encrypts and decrypts a token round-trip", () => {
    const token = "ya29.a0AfH6SMA_test_access_token_value";
    const encrypted = encryptToken(token);
    expect(encrypted).not.toBe(token);
    expect(encrypted).toContain(":");
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(token);
  });

  it("produces different ciphertexts for same input (random IV)", () => {
    const token = "same_token";
    const a = encryptToken(token);
    const b = encryptToken(token);
    expect(a).not.toBe(b);
  });

  it("throws on tampered auth tag", () => {
    const encrypted = encryptToken("test");
    const parts = encrypted.split(":");
    // Zero out the auth tag — AES-GCM always rejects this
    parts[2] = "0".repeat(32);
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });

  it("throws if key is missing", () => {
    const origKey = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("test")).toThrow("TOKEN_ENCRYPTION_KEY");
    process.env.TOKEN_ENCRYPTION_KEY = origKey;
  });
});
