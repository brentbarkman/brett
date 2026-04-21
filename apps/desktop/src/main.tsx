import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard } from "./auth/AuthGuard";
import { LoginPage } from "./auth/LoginPage";
import { AutoUpdateProvider } from "./hooks/useAutoUpdate";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGuard fallback={<LoginPage />}>
        <QueryClientProvider client={queryClient}>
          {/*
            unstable_useTransitions={false} disables React Router v7's default
            wrapping of its internal setState in React.startTransition. In
            React 19.2.0's packaged prod build (Electron, app:// protocol,
            Vite build — compiler off, minify off, reproduced locally via CDP)
            that transition silently never commits, so URL updates happen but
            the Routes tree never re-renders — clicks change the hash, view
            stays put. Bypassing the transition makes nav work again. This is
            a React 19 regression, not a React Router bug; revisit when a
            React 19.x patch ships. See PR #73 and #72 for the red-herring
            fixes (React Compiler disable, minify off) that didn't help.
          */}
          <HashRouter unstable_useTransitions={false}>
            <AutoUpdateProvider>
              <App />
            </AutoUpdateProvider>
          </HashRouter>
        </QueryClientProvider>
      </AuthGuard>
    </AuthProvider>
  </React.StrictMode>
);
