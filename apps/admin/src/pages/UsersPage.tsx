import React from "react";
import { useAdminUsers, useUpdateUserRole } from "../api/users";
import { DataTable } from "../components/DataTable";

export function UsersPage() {
  const { data, isLoading } = useAdminUsers();
  const updateRole = useUpdateUserRole();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Users</h1>
      <DataTable
        loading={isLoading}
        data={data?.users ?? []}
        emptyMessage="No users"
        columns={[
          { key: "email", header: "Email", render: (u: any) => <span className="text-white/90">{u.email}</span> },
          { key: "name", header: "Name" },
          {
            key: "role",
            header: "Role",
            render: (u: any) => (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                u.role === "admin" ? "bg-blue-500/20 text-blue-400" : "bg-white/10 text-white/50"
              }`}>
                {u.role}
              </span>
            ),
          },
          { key: "itemCount", header: "Items" },
          { key: "scoutCount", header: "Scouts" },
          {
            key: "createdAt",
            header: "Joined",
            render: (u: any) => new Date(u.createdAt).toLocaleDateString(),
          },
          {
            key: "actions",
            header: "",
            render: (u: any) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const newRole = u.role === "admin" ? "user" : "admin";
                  updateRole.mutate({ userId: u.id, role: newRole });
                }}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                {u.role === "admin" ? "Demote" : "Promote"}
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
