import { describe, it, expect } from "vitest";
import {
  validatePassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "../index";

describe("validatePassword", () => {
  it("accepts a password that meets all requirements", () => {
    expect(validatePassword("Abcd1efgh2")).toBeNull();
    expect(validatePassword("Secure123Pass")).toBeNull();
  });

  it("rejects passwords shorter than the minimum", () => {
    const shortPassword = "Abc1".padEnd(PASSWORD_MIN_LENGTH - 1, "x");
    const err = validatePassword(shortPassword);
    expect(err).not.toBeNull();
    expect(err).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("rejects passwords longer than the maximum", () => {
    const longPassword = "Abcd1" + "x".repeat(PASSWORD_MAX_LENGTH);
    const err = validatePassword(longPassword);
    expect(err).not.toBeNull();
    expect(err).toContain(String(PASSWORD_MAX_LENGTH));
  });

  it("rejects passwords without a lowercase letter", () => {
    expect(validatePassword("ABCDEFGHI1")).toBe("Password must contain a lowercase letter");
  });

  it("rejects passwords without an uppercase letter", () => {
    expect(validatePassword("abcdefghi1")).toBe("Password must contain an uppercase letter");
  });

  it("rejects passwords without a number", () => {
    expect(validatePassword("Abcdefghij")).toBe("Password must contain a number");
  });

  it("enforces checks in a defined priority order (length before complexity)", () => {
    // A 5-char password with no digit fails on length first, not on "missing number"
    expect(validatePassword("Aaaaa")).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("accepts unicode passwords that satisfy the ASCII complexity rules", () => {
    // The rules require ASCII lower+upper+digit; emoji in addition is fine.
    expect(validatePassword("Passw0rd🔒🌎🌈")).toBeNull();
  });
});
