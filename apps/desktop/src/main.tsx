import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard } from "./auth/AuthGuard";
import { LoginPage } from "./auth/LoginPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGuard fallback={<LoginPage />}>
        <App />
      </AuthGuard>
    </AuthProvider>
  </React.StrictMode>
);
