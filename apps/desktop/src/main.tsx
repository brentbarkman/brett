import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard } from "./auth/AuthGuard";
import { LoginPage } from "./auth/LoginPage";

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
          <MemoryRouter initialEntries={["/today"]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthGuard>
    </AuthProvider>
  </React.StrictMode>
);
