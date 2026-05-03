import { describe, it, expect } from "vitest";
import { isGoogleAuthFailure } from "../google-calendar";

describe("isGoogleAuthFailure", () => {
  it("returns false for null/undefined/non-objects", () => {
    expect(isGoogleAuthFailure(null)).toBe(false);
    expect(isGoogleAuthFailure(undefined)).toBe(false);
    expect(isGoogleAuthFailure("invalid_grant")).toBe(false);
    expect(isGoogleAuthFailure(401)).toBe(false);
  });

  it("returns true for HTTP 401 (numeric code)", () => {
    expect(isGoogleAuthFailure({ code: 401, message: "Unauthorized" })).toBe(true);
  });

  it("returns true for HTTP 403 (numeric code)", () => {
    expect(isGoogleAuthFailure({ code: 403, message: "Forbidden" })).toBe(true);
  });

  it("returns true for HTTP 401 in response.status", () => {
    expect(isGoogleAuthFailure({ response: { status: 401 } })).toBe(true);
  });

  it("returns true for HTTP 403 in response.status", () => {
    expect(isGoogleAuthFailure({ response: { status: 403 } })).toBe(true);
  });

  it("returns true for invalid_grant on the error property (GaxiosError shape)", () => {
    const gaxios = {
      code: "400",
      message: "invalid_grant",
      error: "invalid_grant",
      response: { status: 400, data: { error: "invalid_grant" } },
    };
    expect(isGoogleAuthFailure(gaxios)).toBe(true);
  });

  it("returns true for invalid_grant only in response.data.error", () => {
    expect(
      isGoogleAuthFailure({
        code: "400",
        response: { status: 400, data: { error: "invalid_grant" } },
      }),
    ).toBe(true);
  });

  it("returns true for invalid_grant only in message", () => {
    expect(isGoogleAuthFailure({ message: "invalid_grant" })).toBe(true);
  });

  it("returns true for unauthorized_client", () => {
    expect(
      isGoogleAuthFailure({
        response: { status: 400, data: { error: "unauthorized_client" } },
      }),
    ).toBe(true);
  });

  it("returns false for HTTP 410 (syncToken expired — different recovery path)", () => {
    expect(isGoogleAuthFailure({ code: 410, message: "Gone" })).toBe(false);
  });

  it("returns false for HTTP 500", () => {
    expect(isGoogleAuthFailure({ code: 500, message: "Internal Server Error" })).toBe(false);
  });

  it("returns false for arbitrary error messages that mention invalid_grant elsewhere", () => {
    // Avoid false positives — only direct error matches, not substring noise
    expect(
      isGoogleAuthFailure({ message: "Wrapped: see invalid_grant in cause" }),
    ).toBe(false);
  });

  it("returns false for HTTP 400 without an OAuth error code", () => {
    expect(
      isGoogleAuthFailure({ code: 400, message: "Bad Request", response: { status: 400 } }),
    ).toBe(false);
  });
});
