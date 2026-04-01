import React from "react";
import { SettingsLayout } from "./SettingsLayout";

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  return (
    <main className="flex-1 min-w-0 h-full">
      <SettingsLayout onBack={onBack} />
    </main>
  );
}
