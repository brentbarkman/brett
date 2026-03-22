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

  const { address } = await lookup(parsed.hostname);
  if (isPrivateIP(address)) throw new Error(`Blocked private IP: ${address}`);

  // Pin resolved IP to prevent DNS rebinding
  const pinnedUrl = new URL(url);
  pinnedUrl.hostname = address;
  const hostHeader = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(pinnedUrl.href, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        Host: hostHeader,
        "User-Agent": "Brett/1.0 (+https://brett.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (response.status >= 300 && response.status < 400 && maxRedirects > 0) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect with no Location header");
      return safeFetch(new URL(location, url).href, { ...options, maxRedirects: maxRedirects - 1 });
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new Error(`Response too large: ${contentLength} bytes`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
