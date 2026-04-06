import { app } from "../app.js";

/** Sign up a fresh user and return their bearer token + user id */
export async function createTestUser(
  name = "Test User"
): Promise<{ token: string; userId: string }> {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123", name }),
  });

  const body = (await res.json()) as any;
  return { token: body.token, userId: body.user.id };
}

/** Shorthand for authenticated requests */
export function authRequest(
  path: string,
  token: string,
  init?: RequestInit
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}
