// Dummy auth: login hits the API, the returned user is cached in localStorage.
// No tokens/security — this is a training MVP.
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

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Unknown/corrupt roles go to /login — defaulting them to /app made ProtectedRoute
// bounce them back to homePathFor in an infinite redirect loop.
export const homePathFor = (user) =>
  user?.role === "admin" ? "/admin" : user?.role === "counsellor" ? "/app" : "/login";

// Guards a route by auth + role. Redirects to /login or the user's own home.
export function ProtectedRoute({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (role && user.role !== role) return <Navigate to={homePathFor(user)} replace />;
  return children;
}
