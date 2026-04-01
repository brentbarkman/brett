import React from "react";
import { useAdminUsers, useUpdateUserRole, useLockUser, useUnlockUser, useDeleteUser } from "../api/users";
import { DataTable } from "../components/DataTable";
import { Lock, Unlock, Trash2 } from "lucide-react";

export function UsersPage() {
  const { data, isLoading } = useAdminUsers();
  const updateRole = useUpdateUserRole();
  const lockUser = useLockUser();
  const unlockUser = useUnlockUser();
  const deleteUser = useDeleteUser();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Users</h1>
      <DataTable
        loading={isLoading}
        data={data?.users ?? []}
        emptyMessage="No users"
        columns={[
          {
            key: "email",
            header: "Email",
            render: (u: any) => (
              <span className={u.banned ? "text-white/40 line-through" : "text-white/90"}>
                {u.email}
              </span>
            ),
          },
          { key: "name", header: "Name" },
          {
            key: "status",
            header: "Status",
            render: (u: any) => {
              if (u.banned) {
                return (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400" title={u.banReason || undefined}>
                    locked
                  </span>
                );
              }
              return (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  u.role === "admin" ? "bg-blue-500/20 text-blue-400" : "bg-green-500/20 text-green-400"
                }`}>
                  {u.role}
                </span>
              );
            },
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
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {/* Role toggle */}
                <button
                  onClick={() => {
                    const newRole = u.role === "admin" ? "user" : "admin";
                    const action = newRole === "admin" ? "promote to admin" : "demote to user";
                    if (!confirm(`${action} ${u.email}?`)) return;
                    updateRole.mutate({ userId: u.id, role: newRole });
                  }}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors px-1.5 py-1"
                  title={u.role === "admin" ? "Demote" : "Promote"}
                >
                  {u.role === "admin" ? "Demote" : "Promote"}
                </button>

                {/* Lock / Unlock */}
                {u.role !== "admin" && (
                  u.banned ? (
                    <button
                      onClick={() => {
                        if (!confirm(`Unlock ${u.email}?`)) return;
                        unlockUser.mutate(u.id);
                      }}
                      className="p-1 text-white/30 hover:text-green-400 transition-colors"
                      title="Unlock"
                    >
                      <Unlock size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const reason = prompt(`Lock ${u.email}? Enter a reason (optional):`);
                        if (reason === null) return; // cancelled
                        lockUser.mutate({ userId: u.id, reason: reason || undefined });
                      }}
                      className="p-1 text-white/30 hover:text-amber-400 transition-colors"
                      title="Lock"
                    >
                      <Lock size={14} />
                    </button>
                  )
                )}

                {/* Delete */}
                {u.role !== "admin" && (
                  <button
                    onClick={() => {
                      if (!confirm(`Permanently delete ${u.email} and ALL their data? This cannot be undone.`)) return;
                      deleteUser.mutate(u.id);
                    }}
                    className="p-1 text-white/30 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
