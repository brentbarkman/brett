import { describe, it, expect } from "vitest";
import { app } from "../app.js";

describe("Config routes", () => {
  it("GET /config returns public config", async () => {
    const res = await app.request("/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
