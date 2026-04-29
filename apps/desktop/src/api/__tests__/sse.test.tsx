/**
 * Regression test for useEventStream's reconnect-on-every-render bug.
 *
 * History: prior to fdf817e, `useEventStream` declared `connect` outside its
 * effect and listed it in the deps array. `connect` was a new function on
 * every parent render, so the effect tore down + re-ran on every render,
 * closing the EventSource and POSTing /events/ticket again. Under SSE burst
 * load (initial calendar sync firing dozens of invalidateQueries) this
 * spiraled into a reconnect loop that 429'd the server and exhausted the
 * browser socket pool.
 *
 * This test asserts the effect runs exactly once regardless of parent
 * re-renders, and regardless of how many SSE events the stream dispatches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEventStream } from "../sse";

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("../../auth/auth-client", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
}));

// Install a mock EventSource on globalThis. Track every instance so we can
// count constructions and dispatch synthetic events on demand.
class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
    // Fire onopen on next tick so the hook sees a successful connection
    queueMicrotask(() => {
      if (!this.closed && this.onopen) this.onopen();
    });
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  dispatch(type: string, data: unknown) {
    const arr = this.listeners.get(type) ?? [];
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of arr) fn(event);
  }

  close() {
    this.closed = true;
  }
}

// ── Test harness ─────────────────────────────────────────────────────────────
function createWrapperWithClient(): {
  Wrapper: (props: { children: React.ReactNode }) => React.ReactElement;
  qc: QueryClient;
} {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, qc };
}

function createWrapper() {
  return createWrapperWithClient().Wrapper;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Test component that forces a re-render each time `bump()` is called.
 * Exposes the setter via a ref so the test can trigger renders directly.
 */
function Harness({ bumpRef }: { bumpRef: React.MutableRefObject<(() => void) | null> }) {
  const [count, setCount] = useState(0);
  bumpRef.current = () => setCount((c) => c + 1);
  useEventStream();
  return <div data-testid="count">{count}</div>;
}

// ── Setup ────────────────────────────────────────────────────────────────────
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;

  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ticket: "abc123" }),
  });
  (globalThis as any).fetch = fetchSpy;
});

afterEach(() => {
  vi.clearAllMocks();
  setVisibility("visible");
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe("useEventStream", () => {
  it("connects exactly once on mount", async () => {
    const bumpRef = { current: null as (() => void) | null };
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Harness bumpRef={bumpRef} />
      </Wrapper>,
    );

    // Flush microtasks so the async connect() resolves
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/events/ticket"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("does NOT reconnect when the parent re-renders (100x)", async () => {
    const bumpRef = { current: null as (() => void) | null };
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Harness bumpRef={bumpRef} />
      </Wrapper>,
    );

    // Wait for initial connection
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);

    // Force 100 parent re-renders
    for (let i = 0; i < 100; i++) {
      await act(async () => {
        bumpRef.current?.();
      });
    }

    // Critical assertion: still exactly one connection.
    // The prior bug would produce 101 ticket POSTs + 101 EventSource instances.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("closes the EventSource when the document becomes hidden", async () => {
    const bumpRef = { current: null as (() => void) | null };
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Harness bumpRef={bumpRef} />
      </Wrapper>,
    );

    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0]!;
    expect(es.closed).toBe(false);

    await act(async () => { setVisibility("hidden"); });
    expect(es.closed).toBe(true);
    // No reconnect attempted while hidden.
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("re-opens and runs catch-up invalidation on becoming visible", async () => {
    const { Wrapper, qc } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const bumpRef = { current: null as (() => void) | null };
    render(
      <Wrapper>
        <Harness bumpRef={bumpRef} />
      </Wrapper>,
    );

    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(MockEventSource.instances).toHaveLength(1);

    invalidateSpy.mockClear();

    await act(async () => { setVisibility("hidden"); });
    await act(async () => { setVisibility("visible"); });
    // Wait for the async connect() to resolve and onopen to fire
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    // Second EventSource opened.
    expect(MockEventSource.instances).toHaveLength(2);

    // Catch-up invalidation covers everything SSE could have updated while
    // we were hidden — not just calendar.
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey),
    );
    expect(invalidatedKeys).toEqual(expect.arrayContaining([
      JSON.stringify(["things"]),
      JSON.stringify(["inbox"]),
      JSON.stringify(["lists"]),
      JSON.stringify(["calendar-events"]),
      JSON.stringify(["broken-connections"]),
    ]));
  });

  it("invalidates connection-state queries on connection.synced events", async () => {
    const { Wrapper, qc } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const bumpRef = { current: null as (() => void) | null };
    render(
      <Wrapper>
        <Harness bumpRef={bumpRef} />
      </Wrapper>,
    );

    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const es = MockEventSource.instances[0]!;

    invalidateSpy.mockClear();
    await act(async () => {
      es.dispatch("connection.synced", { type: "google-calendar", googleAccountId: "ga_1" });
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey),
    );
    expect(invalidatedKeys).toEqual(expect.arrayContaining([
      JSON.stringify(["calendar-accounts"]),
      JSON.stringify(["calendar-events"]),
      JSON.stringify(["granola"]),
      JSON.stringify(["things"]),
      JSON.stringify(["broken-connections"]),
    ]));
  });

  it("does NOT reconnect when many SSE events fire in quick succession", async () => {
    const bumpRef = { current: null as (() => void) | null };
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Harness bumpRef={bumpRef} />
      </Wrapper>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0]!;

    // Simulate calendar-sync initial-sync burst
    for (let i = 0; i < 100; i++) {
      await act(async () => {
        es.dispatch("calendar.event.created", { id: `evt-${i}` });
      });
    }

    // Event handlers call qc.invalidateQueries — under the old bug this
    // would cause parent re-renders that re-triggered connect().
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
