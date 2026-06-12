// Supabase-backed auth. Subscribes to onAuthStateChange and exposes the legacy
// user shape { id, name, email, role, avatarColor } so all consumers (layouts,
// ProtectedRoute, pages) are untouched.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "./supabase";

const AuthContext = createContext(null);

const MASAI_DOMAIN = "masaischool.com";

// Map a profiles row (snake_case DB) → legacy user shape (camelCase UI).
function profileToUser(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    avatarColor: profile.avatar_color || "#4F46E5",
  };
}

// Map a Supabase Auth error or DB error message to something user-friendly.
function friendlyError(err) {
  if (!err) return "An unexpected error occurred.";
  const msg = err.message || String(err);
  // DB trigger rejection for non-@masaischool.com domain.
  if (
    msg.toLowerCase().includes("masaischool.com") ||
    msg.toLowerCase().includes("restricted")
  ) {
    return "Signups are restricted to @masaischool.com accounts.";
  }
  if (msg.toLowerCase().includes("invalid login credentials")) {
    return "Invalid email or password.";
  }
  if (msg.toLowerCase().includes("email not confirmed")) {
    return "Please check your inbox and confirm your email before signing in.";
  }
  if (msg.toLowerCase().includes("user already registered")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  return msg;
}

export function AuthProvider({ children }) {
  // null  = not yet resolved; false = no session; object = logged-in user shape.
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch the profiles row for an auth.User and map it to the legacy shape.
  const fetchProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setUser(null);
      return null;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, role, avatar_color")
      .eq("id", authUser.id)
      .single();
    if (error || !data) {
      // Profile may not exist yet (trigger runs async after OAuth). Fall back to
      // a minimal shape derived from the auth user so the app doesn't hard-block.
      const fallback = {
        id: authUser.id,
        name:
          authUser.user_metadata?.name ||
          authUser.user_metadata?.full_name ||
          authUser.email?.split("@")[0] ||
          "User",
        email: authUser.email || "",
        role: "counsellor",
        avatarColor: "#4F46E5",
      };
      setUser(fallback);
      return fallback;
    }
    const u = profileToUser(data);
    setUser(u);
    return u;
  }, []);

  useEffect(() => {
    // Resolve the initial session first, then subscribe to changes.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchProfile(session.user).finally(() => setLoading(false));
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        if (session?.user) {
          fetchProfile(session.user);
        }
      } else if (event === "SIGNED_OUT") {
        setUser(null);
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        // Profile unchanged on token refresh; no re-fetch needed.
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // email+password sign-in.
  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyError(error));
    const u = await fetchProfile(data.user);
    return u;
  }, [fetchProfile]);

  // email+password sign-up. Validates domain client-side before hitting the DB
  // trigger so the user gets an immediate, friendly message.
  const signUp = useCallback(async (email, password, name) => {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain !== MASAI_DOMAIN) {
      throw new Error(`Signups are restricted to @${MASAI_DOMAIN} accounts.`);
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw new Error(friendlyError(error));
    return data;
  }, []);

  // Google OAuth — redirects back to /login where detectSessionInUrl picks up the token.
  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/login" },
    });
    if (error) throw new Error(friendlyError(error));
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, signUp, signInWithGoogle, logout }),
    [user, loading, login, signUp, signInWithGoogle, logout]
  );

  // Render nothing (blank) until the initial auth state is resolved, matching
  // the existing pattern of blocking the router until we know who is logged in.
  if (loading) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Unknown/corrupt roles go to /login — defaulting them to /app made ProtectedRoute
// bounce them back to homePathFor in an infinite redirect loop.
export const homePathFor = (user) => {
  if (user?.role === "superadmin") return "/superadmin";
  if (user?.role === "admin") return "/admin";
  if (user?.role === "counsellor") return "/app";
  return "/login";
};

// Guards a route by auth + role. Redirects to /login or the user's own home.
// `role` may be a string or an array of strings (any match passes).
// A superadmin passes any admin-guarded route in addition to their own.
export function ProtectedRoute({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    const allowed =
      roles.includes(user.role) ||
      (user.role === "superadmin" && roles.includes("admin"));
    if (!allowed) return <Navigate to={homePathFor(user)} replace />;
  }
  return children;
}
