import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAccountType } from "../useAccountType";

vi.mock("../../auth/auth-client", () => ({
  authClient: {
    listAccounts: vi.fn(),
  },
}));

import { authClient } from "../../auth/auth-client";
const mockListAccounts = vi.mocked(authClient.listAccounts);

describe("useAccountType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects Google account", async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ providerId: "google", accountId: "123" }],
    } as any);

    const { result } = renderHook(() => useAccountType());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isGoogle).toBe(true);
    expect(result.current.isEmailPassword).toBe(false);
  });

  it("detects email/password account", async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ providerId: "credential", accountId: "456" }],
    } as any);

    const { result } = renderHook(() => useAccountType());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isGoogle).toBe(false);
    expect(result.current.isEmailPassword).toBe(true);
  });

  it("detects both accounts linked", async () => {
    mockListAccounts.mockResolvedValue({
      data: [
        { providerId: "google", accountId: "123" },
        { providerId: "credential", accountId: "456" },
      ],
    } as any);

    const { result } = renderHook(() => useAccountType());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isGoogle).toBe(true);
    expect(result.current.isEmailPassword).toBe(true);
  });

  it("handles empty accounts list", async () => {
    mockListAccounts.mockResolvedValue({ data: [] } as any);

    const { result } = renderHook(() => useAccountType());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isGoogle).toBe(false);
    expect(result.current.isEmailPassword).toBe(false);
  });

  it("handles API error gracefully", async () => {
    mockListAccounts.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAccountType());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isGoogle).toBe(false);
    expect(result.current.isEmailPassword).toBe(false);
    expect(result.current.error).toBe("Could not load account information");
  });

  it("has no error on success", async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ providerId: "google", accountId: "123" }],
    } as any);

    const { result } = renderHook(() => useAccountType());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
