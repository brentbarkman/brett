import { lookup } from "node:dns/promises";

const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./,
];

function isPrivateIP(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;
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

  // Resolve DNS and validate IP (blocks obvious SSRF)
  // Note: small TOCTOU window for DNS rebinding — acceptable for v1.
  // A future enhancement can use a custom undici dispatcher for IP pinning.
  const { address } = await lookup(parsed.hostname);
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
