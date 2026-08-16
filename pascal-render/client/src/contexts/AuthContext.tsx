import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../config/api";

export interface AuthUser {
  userId: string;
  email: string;
  role: "operator" | "client";
  orgId: string | null;
}

interface AuthContextValue {
  user: AuthUser | undefined;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .authMe<AuthUser>()
      .then(setUser)
      .catch(() => setUser(undefined))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<AuthUser> {
    const loggedInUser = await api.authLogin<AuthUser>(email, password);
    setUser(loggedInUser);
    return loggedInUser;
  }

  async function logout() {
    await api.authLogout();
    setUser(undefined);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider.");
  return ctx;
}

export { ApiError };
