import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";

const STORAGE_KEY = "mct_user";
const AuthContext = createContext(null);

function loadUser() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadUser);

  const login = useCallback(async (email, password) => {
    const u = await api.login(email, password);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
    return u;
  }, []);

  const loginWithGoogle = useCallback(async (idToken) => {
    const u = await api.loginWithGoogle(idToken);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    // Sign out of Google session so the account picker shows on next login.
    window.google?.accounts?.id?.disableAutoSelect?.();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, login, loginWithGoogle, logout }), [user, login, loginWithGoogle, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const homePathFor = (user) => {
  if (user?.role === "superadmin") return "/superadmin";
  if (user?.role === "admin") return "/admin";
  if (user?.role === "counsellor") return "/app";
  return "/login";
};

// superadmin can pass through admin-guarded routes in addition to their own.
export function ProtectedRoute({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (role) {
    const canAccess =
      user.role === role ||
      (role === "admin" && user.role === "superadmin");
    if (!canAccess) return <Navigate to={homePathFor(user)} replace />;
  }
  return children;
}
