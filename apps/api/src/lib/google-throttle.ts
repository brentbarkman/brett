/**
 * Token-bucket rate limiter for outbound Google API calls.
 *
 * Await+queue model: callers `await googleThrottle()` before making a request.
 * Requests are queued and drained at a controlled rate to avoid triggering
 * Google's automated-query detection (which is IP-based, not per-API-key).
 *
 * Config: 10 requests/second sustained, burst of 5.
 */

const MAX_TOKENS = 5;
const REFILL_RATE = 10; // tokens per second
const REFILL_INTERVAL_MS = 1000 / REFILL_RATE; // 100ms per token

let tokens = MAX_TOKENS;
let lastRefill = Date.now();

type Waiter = () => void;
const queue: Waiter[] = [];
let draining = false;

function refill(): void {
  const now = Date.now();
  const elapsed = now - lastRefill;
  const newTokens = Math.floor(elapsed / REFILL_INTERVAL_MS);
  if (newTokens > 0) {
    tokens = Math.min(MAX_TOKENS, tokens + newTokens);
    lastRefill += newTokens * REFILL_INTERVAL_MS;
  }
}

function drain(): void {
  if (draining) return;
  draining = true;

  const tick = () => {
    refill();
    while (tokens > 0 && queue.length > 0) {
      tokens--;
      const resolve = queue.shift()!;
      resolve();
    }
    if (queue.length > 0) {
      setTimeout(tick, REFILL_INTERVAL_MS);
    } else {
      draining = false;
    }
  };

  tick();
}

/**
 * Await this before every outbound Google API call.
 * Resolves immediately if tokens are available, otherwise queues.
 */
export function googleThrottle(): Promise<void> {
  refill();
  if (tokens > 0) {
    tokens--;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(resolve);
    drain();
  });
}
