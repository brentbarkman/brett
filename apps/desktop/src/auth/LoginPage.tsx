import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { VideoBackground, VideoBackgroundHandle } from "./VideoBackground";

const LOGIN_VIDEOS = [
  "/videos/login-bg-1.mp4",
  "/videos/login-bg-2.mp4",
  "/videos/login-bg-3.mp4",
  "/videos/login-bg-4.mp4",
  "/videos/login-bg-5.mp4",
  "/videos/login-bg-6.mp4",
  "/videos/login-bg-7.mp4",
  "/videos/login-bg-8.mp4",
  "/videos/login-bg-9.mp4",
];

export function LoginPage() {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const videoBgRef = useRef<VideoBackgroundHandle>(null);

  // Focus email on mount, name when switching to sign-up
  useEffect(() => {
    if (isSignUp) {
      // Wait for the max-height transition to open before focusing
      const timer = setTimeout(() => nameRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    } else {
      emailRef.current?.focus();
    }
  }, [isSignUp]);

  function validate(): string | null {
    if (isSignUp && !name.trim()) return "Name is required";
    if (!email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return "Please enter a valid email address";
    if (!password) return "Password is required";
    if (password.length < 8)
      return "Password must be at least 8 characters";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      if (isSignUp) {
        await signUpWithEmail(email, password, name || email.split("@")[0]);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: any) {
      const msg = err.message || "Authentication failed";
      if (!isSignUp && /invalid.*(email|password)/i.test(msg)) {
        setError("NO_ACCOUNT");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || "Google sign-in failed");
    }
  }

  return (
    <div
      className="relative flex h-screen items-center justify-center overflow-hidden bg-black"
      onClick={() => videoBgRef.current?.skip()}
    >
      <VideoBackground ref={videoBgRef} videos={LOGIN_VIDEOS} />

      <style>{`
        @keyframes cardEntrance {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>

      <div
        className="relative z-10 w-full max-w-sm space-y-6 rounded-xl border border-white/10 bg-black/40 p-8 backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          animation: "cardEntrance 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Brett
          </h1>
          <p className="mt-1 text-sm text-white/60">
            {isSignUp ? "Create your account" : "Sign in to continue"}
          </p>
        </div>

        <button
          onClick={handleGoogle}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 border-t border-white/10" />
          <span className="font-mono text-xs uppercase tracking-wider text-white/40">
            or
          </span>
          <div className="h-px flex-1 border-t border-white/10" />
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div
            className="overflow-hidden transition-all duration-300 ease-out"
            style={{
              maxHeight: isSignUp ? "80px" : "0px",
              opacity: isSignUp ? 1 : 0,
            }}
          >
            <div>
              <label
                htmlFor="name"
                className="block font-mono text-xs uppercase tracking-wider text-white/40"
              >
                Name
              </label>
              <input
                ref={nameRef}
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:border-blue-500/30 focus:outline-none"
                placeholder="Your name"
                tabIndex={isSignUp ? 0 : -1}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="email"
              className="block font-mono text-xs uppercase tracking-wider text-white/40"
            >
              Email
            </label>
            <input
              ref={emailRef}
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:border-blue-500/30 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block font-mono text-xs uppercase tracking-wider text-white/40"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:border-blue-500/30 focus:outline-none"
              placeholder="Min 8 characters"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error === "NO_ACCOUNT" ? (
                <p>
                  No account found.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(true);
                      setError(null);
                    }}
                    className="font-medium text-blue-400 hover:text-blue-300"
                  >
                    Create one?
                  </button>
                </p>
              ) : (
                <p>{error}</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Loading..."
              : isSignUp
                ? "Create Account"
                : "Sign In"}
          </button>
        </form>

        <p className="text-center text-sm text-white/40">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
            }}
            className="text-blue-400 hover:text-blue-300"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}
