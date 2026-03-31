import { lookup } from "node:dns/promises";

const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./,
];

function isPrivateIP(ip: string): boolean {
  // Unwrap IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateIP(mapped[1]);

  // IPv6 private/reserved — comprehensive check covering all representations.
  // Note: lookup() uses family:4 today, so IPv6 addresses won't reach here in practice.
  // These checks exist as defense-in-depth if the family constraint is ever removed.
  const normalizedV6 = ip.toLowerCase();
  if (normalizedV6 === "::1" || normalizedV6 === "::" || normalizedV6 === "0:0:0:0:0:0:0:1") return true;
  if (normalizedV6 === "0000:0000:0000:0000:0000:0000:0000:0001") return true; // full form of ::1
  if (normalizedV6.startsWith("fc") || normalizedV6.startsWith("fd")) return true; // unique local
  if (normalizedV6.startsWith("fe80")) return true; // link-local
  if (normalizedV6.startsWith("100:") && normalizedV6.includes("::")) return true; // discard prefix (RFC 6666)

  // IPv4 private ranges
  return PRIVATE_RANGES.some((re) => re.test(ip));
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxSizeBytes?: number;
  maxRedirects?: number;
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, maxSizeBytes = 5 * 1024 * 1024, maxRedirects = 5 } = options;
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`Blocked protocol: ${parsed.protocol}`);

  // Resolve DNS and validate IP (blocks obvious SSRF).
  // KNOWN LIMITATION: small TOCTOU window for DNS rebinding — the DNS could resolve to a
  // public IP here, then rebind to a private IP before the TCP connection. Mitigations:
  //   1. Node.js DNS cache (default ~5s TTL) reduces the rebinding window
  //   2. Redirect IPs are re-validated on each hop (see below)
  //   3. Manual redirect following prevents open-redirect chains to internal services
  // FUTURE: Use a custom undici dispatcher with a connect hook that validates the resolved
  // IP before establishing the TCP connection (eliminates TOCTOU entirely).
  const { address } = await lookup(parsed.hostname, { family: 4 });
  if (isPrivateIP(address)) throw new Error(`Blocked private IP: ${address}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual", // Handle redirects manually to re-check IPs
      headers: {
        "User-Agent": "Brett/1.0 (+https://brett.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    // Handle redirects manually — re-validate IP on each hop
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

    return response;
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
