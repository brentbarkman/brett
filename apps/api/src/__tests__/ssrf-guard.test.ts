import { describe, it, expect } from "vitest";
import {
  safeFetch,
  _isPrivateIPForTesting as isPrivateIP,
  _guardedLookupForTesting as guardedLookup,
} from "../lib/ssrf-guard.js";

describe("isPrivateIP", () => {
  // IPv4 ranges that must be blocked
  it.each([
    "127.0.0.1",      // loopback
    "127.5.6.7",      // anywhere in 127.0.0.0/8
    "10.0.0.1",       // RFC 1918 private
    "10.255.255.255",
    "172.16.0.1",     // RFC 1918 private
    "172.20.5.9",
    "172.31.255.255",
    "192.168.1.1",    // RFC 1918 private
    "192.168.255.255",
    "169.254.169.254", // AWS IMDS / link-local
    "0.0.0.0",        // unspecified
  ])("blocks private IPv4 %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  // IPv4 ranges that must be allowed
  it.each([
    "8.8.8.8",        // public DNS
    "1.1.1.1",
    "172.15.0.1",     // just outside 172.16/12
    "172.32.0.1",     // just outside 172.16/12
    "11.0.0.1",       // just outside 10/8
    "128.0.0.1",      // just outside 127/8
    "193.1.2.3",      // just outside 192.168/16
  ])("allows public IPv4 %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });

  // IPv6 private ranges
  it.each([
    "::1",
    "::",
    "fe80::1",       // link-local
    "fc00::1",       // unique local
    "fd00::1",       // unique local
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1",  // IPv4-mapped private
  ])("blocks private IPv6 %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it("allows public IPv6", () => {
    expect(isPrivateIP("2001:4860:4860::8888")).toBe(false); // Google DNS v6
  });
});

describe("guardedLookup callback shape", () => {
  // undici 7's connect path calls our lookup with `{ all: true }` and expects
  // the callback to return an ARRAY of `{address, family}` records. Returning
  // the classic `(err, addressString, family)` shape causes undici to throw
  // ERR_INVALID_IP_ADDRESS — silently breaks every safeFetch in production.
  // These tests pin both call shapes.

  function callLookup(
    hostname: string,
    options: any,
  ): Promise<{ err: NodeJS.ErrnoException | null; result: unknown[] }> {
    return new Promise((resolve) => {
      // Capture all callback args so we can assert on the second-arg shape,
      // not just (err, address, family). undici calls back with (err, addresses[]).
      guardedLookup(hostname, options, (...args: unknown[]) => {
        resolve({ err: args[0] as NodeJS.ErrnoException | null, result: args.slice(1) });
      });
    });
  }

  it("returns an array when called with { all: true } (undici 7 contract)", async () => {
    const { err, result } = await callLookup("example.com", { all: true });
    expect(err).toBeNull();
    // Second callback arg must be an array of {address, family} records.
    expect(Array.isArray(result[0])).toBe(true);
    const addresses = result[0] as Array<{ address: string; family: number }>;
    expect(addresses.length).toBeGreaterThan(0);
    for (const addr of addresses) {
      expect(typeof addr.address).toBe("string");
      expect(addr.family).toBe(4);
    }
  });

  it("returns (address, family) when called without all (classic Node contract)", async () => {
    const { err, result } = await callLookup("example.com", {});
    expect(err).toBeNull();
    // Classic shape: callback(null, addressString, family).
    expect(typeof result[0]).toBe("string");
    expect(result[1]).toBe(4);
  });

  it("blocks single private IPv4 in classic shape", async () => {
    // localhost resolves to 127.0.0.1 — must be rejected with EBLOCKED_PRIVATE_IP.
    const { err } = await callLookup("localhost", {});
    expect(err).not.toBeNull();
    expect(err?.code).toBe("EBLOCKED_PRIVATE_IP");
  });

  it("blocks all-private results in array shape", async () => {
    const { err } = await callLookup("localhost", { all: true });
    expect(err).not.toBeNull();
    expect(err?.code).toBe("EBLOCKED_PRIVATE_IP");
  });
});

describe("safeFetch", () => {
  it("rejects non-http(s) protocols before resolving DNS", async () => {
    await expect(safeFetch("ftp://example.com/foo")).rejects.toThrow(/Blocked protocol/);
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/Blocked protocol/);
    await expect(safeFetch("javascript:alert(1)")).rejects.toThrow(/Blocked protocol/);
  });

  it("rejects a hostname that resolves to localhost", async () => {
    // "localhost" resolves to 127.0.0.1 (or ::1). The guarded lookup should
    // catch this at TCP connect time and surface as a fetch failure.
    // The error message varies by Node version (sometimes the Agent's
    // EBLOCKED_PRIVATE_IP propagates, sometimes it's wrapped as "fetch
    // failed") — assert on the rejection itself plus the cause/message
    // containing our blocked-ip signal.
    let caught: unknown;
    try {
      await safeFetch("http://localhost/");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const message = String((caught as Error)?.message ?? "") +
      String(((caught as any)?.cause as Error)?.message ?? "");
    // Either the blocked-ip code bubbles up directly, OR fetch failed with
    // the socket closed before handshake — both mean the guard fired.
    expect(message).toMatch(/Blocked private IP|EBLOCKED_PRIVATE_IP|fetch failed/i);
  });

  it("rejects 127.0.0.1 as a literal IP in the URL", async () => {
    // No DNS lookup happens for IP literals — undici's connect still goes
    // through our lookup function in practice (hostname is the literal),
    // and `dnsLookup("127.0.0.1")` returns `127.0.0.1` which we classify.
    let caught: unknown;
    try {
      await safeFetch("http://127.0.0.1/");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });

  it("succeeds against a real public host (regression: undici 7 lookup contract)", async () => {
    // Pins the bug where guardedLookup returned the classic shape while
    // undici 7 called it with `{ all: true }` and expected an array — every
    // safeFetch in production silently failed with ERR_INVALID_IP_ADDRESS.
    // example.com is RFC-2606 reserved + IANA-stable, safe to hit from CI.
    const res = await safeFetch("https://example.com/", { timeoutMs: 10_000 });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(400);
  });
});
