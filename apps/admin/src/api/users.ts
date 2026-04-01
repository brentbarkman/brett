import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "./client";

interface UserListItem {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string;
  createdAt: string;
  itemCount: number;
  scoutCount: number;
}

interface UserListResponse {
  users: UserListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function useAdminUsers(page = 1) {
  return useQuery({
    queryKey: ["admin", "users", page],
    queryFn: () => adminFetch<UserListResponse>(`/admin/users?page=${page}`),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      adminFetch(`/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
