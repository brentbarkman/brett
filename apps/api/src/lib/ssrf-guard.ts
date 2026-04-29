import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./,
];

function isPrivateIP(ip: string): boolean {
  // Unwrap IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateIP(mapped[1]);

  // IPv6 private/reserved — comprehensive check covering all representations.
  // Note: the guarded lookup below uses family:4 today, so IPv6 addresses
  // won't reach here in practice. These checks exist as defense-in-depth
  // if the family constraint is ever removed.
  const normalizedV6 = ip.toLowerCase();
  if (normalizedV6 === "::1" || normalizedV6 === "::" || normalizedV6 === "0:0:0:0:0:0:0:1") return true;
  if (normalizedV6 === "0000:0000:0000:0000:0000:0000:0000:0001") return true; // full form of ::1
  if (normalizedV6.startsWith("fc") || normalizedV6.startsWith("fd")) return true; // unique local
  if (normalizedV6.startsWith("fe80")) return true; // link-local
  if (normalizedV6.startsWith("100:") && normalizedV6.includes("::")) return true; // discard prefix (RFC 6666)

  // IPv4 private ranges
  return PRIVATE_RANGES.some((re) => re.test(ip));
}

/**
 * Exported for unit testing the IP classifier independently of the fetch
 * pipeline. Callers should not use this directly for SSRF decisions —
 * always go through `safeFetch`, which performs the check at connect time.
 */
export const _isPrivateIPForTesting = isPrivateIP;

/**
 * DNS lookup that validates the resolved IP BEFORE returning it to the
 * connection layer. When this is wired into undici's `Agent.connect.lookup`,
 * undici uses the returned literal IP for the TCP handshake — no second DNS
 * resolution happens, closing the DNS-rebinding TOCTOU window that a
 * separate "resolve, check, then fetch by hostname" sequence leaves open.
 *
 * Two callback shapes, dispatched on `options.all`:
 *  - `all !== true` (classic Node `net.LookupFunction`): `cb(err, address, family)`
 *  - `all === true` (undici 7 `connect.lookup`): `cb(err, [{address, family}, ...])`
 *
 * Returning the wrong shape yields `ERR_INVALID_IP_ADDRESS` and silently
 * breaks every outbound fetch. Pinned by tests in `ssrf-guard.test.ts`.
 */
const guardedLookup: LookupFunction = (
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void => {
  // Force IPv4 regardless of caller hints/family so `isPrivateIP`'s IPv4
  // table is authoritative — prevents an attacker who can influence
  // `hints`/`family` from coaxing undici onto an IPv6 path where our
  // checks are weaker.
  const wantAll = (options as { all?: boolean })?.all === true;

  dnsLookup(hostname, { family: 4, all: wantAll })
    .then((result) => {
      if (wantAll) {
        const addresses = result as LookupAddress[];
        const safe = addresses.filter((a) => !isPrivateIP(a.address));
        if (safe.length === 0) {
          const err = new Error(
            `Blocked private IP(s): ${addresses.map((a) => a.address).join(", ") || "none"}`
          ) as NodeJS.ErrnoException;
          err.code = "EBLOCKED_PRIVATE_IP";
          callback(err, []);
          return;
        }
        callback(null, safe);
        return;
      }

      const { address, family } = result as LookupAddress;
      if (isPrivateIP(address)) {
        const err = new Error(`Blocked private IP: ${address}`) as NodeJS.ErrnoException;
        err.code = "EBLOCKED_PRIVATE_IP";
        callback(err, "", 0);
        return;
      }
      callback(null, address, family);
    })
    .catch((err) => {
      if (wantAll) {
        callback(err as NodeJS.ErrnoException, []);
      } else {
        callback(err as NodeJS.ErrnoException, "", 0);
      }
    });
};

/**
 * Shared undici dispatcher that runs every outgoing TCP connect through
 * the guarded lookup above. Singleton — the Agent pools connections and
 * recreating it per request would defeat that.
 */
const ssrfAgent = new Agent({
  connect: {
    lookup: guardedLookup,
  },
});

/**
 * Exported for unit testing the lookup-callback contract. Undici 7's connect
 * path calls `lookup(hostname, { all: true }, cb)` and expects `cb(null, [
 * {address, family}, ...])`. Earlier undici / classic Node use `cb(null,
 * addressString, family)`. Returning the wrong shape yields
 * `ERR_INVALID_IP_ADDRESS` and silently breaks every outbound fetch in
 * production. Tests cover both call shapes — do not delete.
 *
 * Not for production use — go through `safeFetch`.
 */
export const _guardedLookupForTesting = guardedLookup;

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxSizeBytes?: number;
  maxRedirects?: number;
  /** Extra request headers. Overrides defaults (e.g. `User-Agent`) on case-insensitive match. */
  headers?: Record<string, string>;
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, maxSizeBytes = 5 * 1024 * 1024, maxRedirects = 5, headers: extraHeaders } = options;
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`Blocked protocol: ${parsed.protocol}`);

  // Note: we no longer do a separate pre-flight DNS resolve + IP check.
  // The guarded lookup wired into `ssrfAgent` validates the IP at TCP
  // connect time, so there's no TOCTOU window for DNS rebinding — the IP
  // the check sees is the IP undici connects to.

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Merge default headers with caller overrides. Case-insensitive: if the caller
  // passes "user-agent", strip the default "User-Agent" so there's a single value.
  const mergedHeaders: Record<string, string> = {
    "User-Agent": "Brett/1.0 (+https://brett.app)",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (extraHeaders) {
    const extraKeysLower = new Set(Object.keys(extraHeaders).map(k => k.toLowerCase()));
    for (const key of Object.keys(mergedHeaders)) {
      if (extraKeysLower.has(key.toLowerCase())) delete mergedHeaders[key];
    }
    Object.assign(mergedHeaders, extraHeaders);
  }

  try {
    const response = await undiciFetch(url, {
      signal: controller.signal,
      redirect: "manual", // Handle redirects manually to re-check IPs
      dispatcher: ssrfAgent,
      headers: mergedHeaders,
    });

    // Handle redirects manually — re-validate IP on each hop by routing
    // the recursive call through the same guarded agent.
    if (response.status >= 300 && response.status < 400 && maxRedirects > 0) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect with no Location header");
      const redirectUrl = new URL(location, url).href;
      clearTimeout(timeout); // Clear this timeout, recursive call sets its own
      return safeFetch(redirectUrl, { ...options, maxRedirects: maxRedirects - 1 });
    }

    if (maxRedirects <= 0 && response.status >= 300 && response.status < 400) {
      throw new Error("Too many redirects");
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new Error(`Response too large: ${contentLength} bytes (max ${maxSizeBytes})`);
    }

    // undici's Response is structurally compatible with the global Response
    // type (both implement the Fetch API). Cast to the global type so
    // callers' `response.json()` / `response.text()` typecheck unchanged.
    return response as unknown as Response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel();
      throw new Error(`Response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function readBinaryWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel();
      throw new Error(`Response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
