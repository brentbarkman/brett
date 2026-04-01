import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "../auth/auth-client";

export function usePasskeys() {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const res = await authClient.passkey.listUserPasskeys();
      if (res.error) throw new Error(String(res.error.message));
      return res.data ?? [];
    },
  });
}

export function useRegisterPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await authClient.passkey.addPasskey();
      if (res?.error) throw new Error(String(res.error.message));
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    },
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authClient.passkey.deletePasskey({ id });
      if (res?.error) throw new Error(String(res.error.message));
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    },
  });
}
