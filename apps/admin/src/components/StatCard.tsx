import React from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  color?: "default" | "green" | "amber" | "red";
}

const colorMap = {
  default: "text-white",
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
};

export function StatCard({ label, value, color = "default" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${colorMap[color]}`}>
        {value}
      </div>
    </div>
  );
}
