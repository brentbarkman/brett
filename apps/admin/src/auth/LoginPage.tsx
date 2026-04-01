import React, { useState } from "react";
import { authClient } from "./auth-client";

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isDev = import.meta.env.DEV;

  // Dev-only email/password state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handlePasskey() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) throw new Error(String(res.error.message) || "Passkey sign-in failed");
    } catch (err: any) {
      setError(err.message || "Passkey sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);
    try {
      await authClient.signIn.social({ provider: "google" });
    } catch (err: any) {
      setError(err.message || "Google sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res?.error) throw new Error(res.error.message || "Sign in failed");
    } catch (err: any) {
      setError(err.message || "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-black">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/10 bg-black/40 p-8 backdrop-blur-2xl">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Brett Admin</h1>
          <p className="mt-1 text-sm text-white/50">Sign in with your admin account</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handlePasskey}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-400 disabled:opacity-30"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
              <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
            </svg>
            {submitting ? "Signing in..." : "Sign in with Passkey"}
          </button>

          <button
            onClick={handleGoogle}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>
        </div>

        {isDev && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 border-t border-white/10" />
              <span className="font-mono text-xs uppercase tracking-wider text-white/40">dev only</span>
              <div className="h-px flex-1 border-t border-white/10" />
            </div>

            <form onSubmit={handleEmailPassword} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:border-blue-500/30 focus:outline-none"
                placeholder="Email"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:border-blue-500/30 focus:outline-none"
                placeholder="Password"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors disabled:opacity-30"
              >
                Sign In (Dev)
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
