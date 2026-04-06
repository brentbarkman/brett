import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken } from "../lib/encryption.js";

// 32-byte hex key for AES-256
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token-encryption", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }
  });

  it("encrypts and decrypts a token round-trip", () => {
    const plaintext = "ya29.a0AfH6SMBx_some_google_oauth_token";
    const encrypted = encryptToken(plaintext);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plaintext = "same-token";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    // Both should decrypt to the same value
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it("output format is iv:ciphertext:tag (three hex segments)", () => {
    const encrypted = encryptToken("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    // Each part should be valid hex
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
    // IV is 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(32);
  });

  it("handles empty string", () => {
    const encrypted = encryptToken("");
    expect(decryptToken(encrypted)).toBe("");
  });

  it("handles unicode content", () => {
    const plaintext = "日本語テスト 🔑";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptToken("secret");
    const parts = encrypted.split(":");
    // Completely replace the ciphertext — AES-GCM auth tag will reject
    const tamperedCiphertext = "a".repeat(parts[1].length);
    const tampered = parts[0] + ":" + tamperedCiphertext + ":" + parts[2];
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("rejects tampered auth tag", () => {
    const encrypted = encryptToken("secret");
    const parts = encrypted.split(":");
    const tampered = parts[0] + ":" + parts[1] + ":" + "0".repeat(32);
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws when encryption key is missing", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("test")).toThrow("TOKEN_ENCRYPTION_KEY");
  });
});
