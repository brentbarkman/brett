import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, Radar, Cpu, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

const links = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/users", icon: Users, label: "Users" },
  { to: "/scouts", icon: Radar, label: "Scouts" },
  { to: "/ai-usage", icon: Cpu, label: "AI Usage" },
];

export function Sidebar() {
  const { signOut } = useAuth();

  return (
    <div className="flex h-screen w-52 flex-col border-r border-white/[0.08] bg-black/30 backdrop-blur-xl">
      <div className="px-4 py-5">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/30">
          Brett Admin
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-blue-500/15 text-blue-400"
                  : "text-white/50 hover:bg-white/5 hover:text-white/70"
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/[0.08] p-2">
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/40 hover:bg-white/5 hover:text-white/60 transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
