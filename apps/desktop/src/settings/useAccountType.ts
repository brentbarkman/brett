import { useEffect, useState } from "react";
import { authClient } from "../auth/auth-client";

interface Account {
  providerId: string;
}

interface AccountType {
  isGoogle: boolean;
  isEmailPassword: boolean;
  loading: boolean;
  error: string | null;
}

export function useAccountType(): AccountType {
  const [isGoogle, setIsGoogle] = useState(false);
  const [isEmailPassword, setIsEmailPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authClient
      .listAccounts()
      .then(({ data }) => {
        const accounts = (data ?? []) as Account[];
        setIsGoogle(accounts.some((a) => a.providerId === "google"));
        setIsEmailPassword(
          accounts.some((a) => a.providerId === "credential")
        );
      })
      .catch(() => {
        setError("Could not load account information");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { isGoogle, isEmailPassword, loading, error };
}
