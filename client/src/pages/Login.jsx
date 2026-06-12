import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, homePathFor } from "../lib/auth.jsx";
import Button from "../ui/Button";
import Input from "../ui/Input";

// Decorative soundwave bars referencing the voice-practice feature.
const BARS = [22, 40, 64, 88, 56, 100, 72, 44, 80, 52, 92, 36, 60, 84, 48, 28, 68, 96, 40, 24];

function Soundwave() {
  return (
    <svg
      viewBox="0 0 320 120"
      fill="none"
      className="h-32 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {BARS.map((h, i) => {
        const x = 6 + i * 15.6;
        const barH = (h / 100) * 96;
        const y = 60 - barH / 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width="6"
            height={barH}
            rx="3"
            fill="white"
            opacity={0.35 + (h / 100) * 0.55}
          />
        );
      })}
    </svg>
  );
}

// Inline Google "G" logo SVG (no icon library dependency).
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function Login() {
  const { login, signUp, signInWithGoogle, user } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Already signed in — straight to the workspace instead of showing the form.
  if (user) return <Navigate to={homePathFor(user)} replace />;

  function switchMode(next) {
    setMode(next);
    setError("");
    setSignupSuccess(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUp(email, password, name);
        setSignupSuccess(true);
      } else {
        const u = await login(email, password);
        navigate(homePathFor(u));
      }
    } catch (err) {
      setError(err?.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // Redirect handled by OAuth flow; page will reload via detectSessionInUrl.
    } catch (err) {
      setError(err?.message || "Google sign-in failed. Please try again.");
      setGoogleLoading(false);
    }
  }

  const isSignUp = mode === "signup";

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Left brand panel (lg only) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-600 p-12 text-white lg:flex">
        {/* Soft ambient glows */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-brand-50/10 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-base font-bold shadow-sm ring-1 ring-white/20 backdrop-blur">
            M
          </div>
          <span className="text-sm font-semibold tracking-tight text-white/90">Masai</span>
        </div>

        <div className="relative">
          <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight">
            Masai Mock Counselling Trainer
          </h1>
          <p className="mt-4 max-w-sm text-lg text-white/70">
            Practice the call. Master the close.
          </p>

          <div className="mt-12 rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur">
            <Soundwave />
            <p className="mt-4 text-sm text-white/70">
              Rehearse live, voice-driven counselling calls against realistic student personas — then
              review your rubric report.
            </p>
          </div>
        </div>

        <div className="relative text-xs text-white/50">
          Sales counselling, perfected through practice.
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile brand mark */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-base font-bold text-white shadow-sm">
              M
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-ink">Masai</div>
              <div className="text-xs text-muted">Counselling Trainer</div>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {isSignUp
              ? "Use your @masaischool.com email to get started."
              : "Sign in to continue to your training workspace."}
          </p>

          {signupSuccess ? (
            <div
              role="alert"
              className="mt-8 rounded-xl border border-success/30 bg-success/5 px-4 py-4 text-sm text-success"
            >
              <p className="font-semibold">Check your inbox!</p>
              <p className="mt-1 text-success/80">
                We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
                account, then come back here to sign in.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {isSignUp && (
                <Input
                  id="name"
                  label="Full name"
                  type="text"
                  autoComplete="name"
                  placeholder="Priya Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              )}
              <Input
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@masaischool.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                id="password"
                label="Password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger"
                >
                  {error}
                </div>
              )}

              <Button type="submit" disabled={loading} className="w-full">
                {loading
                  ? isSignUp
                    ? "Creating account…"
                    : "Signing in…"
                  : isSignUp
                  ? "Create account"
                  : "Sign in"}
              </Button>
            </form>
          )}

          {/* Google sign-in divider + button */}
          {!signupSuccess && (
            <div className="mt-6">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted">or</span>
                <div className="h-px flex-1 bg-line" />
              </div>

              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading}
                className="mt-4 inline-flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:opacity-50 disabled:pointer-events-none"
              >
                <GoogleG />
                {googleLoading ? "Redirecting…" : "Continue with Google"}
              </button>
            </div>
          )}

          {/* Toggle between sign-in and sign-up */}
          <p className="mt-8 text-center text-sm text-muted">
            {isSignUp ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="font-medium text-brand-600 hover:underline focus-visible:outline-none"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to Masai Counselling Trainer?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="font-medium text-brand-600 hover:underline focus-visible:outline-none"
                >
                  Create account
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
