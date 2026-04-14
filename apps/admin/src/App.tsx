import React from "react";
import { Routes, Route } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { UsersPage } from "./pages/UsersPage";
import { ScoutsPage } from "./pages/ScoutsPage";
import { AIUsagePage } from "./pages/AIUsagePage";
import { MemoryPage } from "./pages/MemoryPage";

export function App() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="scouts" element={<ScoutsPage />} />
        <Route path="ai-usage" element={<AIUsagePage />} />
        <Route path="memory" element={<MemoryPage />} />
      </Route>
    </Routes>
  );
}
