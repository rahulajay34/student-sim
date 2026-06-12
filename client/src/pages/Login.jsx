import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, homePathFor } from "../lib/auth.jsx";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function Login() {
  const { loginWithGoogle, user } = useAuth();
  const navigate = useNavigate();
  const btnRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [googleReady, setGoogleReady] = useState(false);

  if (user) return <Navigate to={homePathFor(user)} replace />;

  async function handleGoogleCredential({ credential }) {
    setError("");
    setLoading(true);
    try {
      const u = await loginWithGoogle(credential);
      navigate(homePathFor(u));
    } catch (err) {
      setError(err?.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    function initGSI() {
      if (!window.google?.accounts?.id || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: "outline",
        size: "large",
        width: btnRef.current.offsetWidth || 400,
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
      });
      setGoogleReady(true);
    }

    if (window.google?.accounts?.id) {
      initGSI();
    } else {
      // GSI script is async — poll until it lands.
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          initGSI();
        }
      }, 80);
      return () => clearInterval(interval);
    }
  }, []);

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Left brand panel (lg only) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-600 p-12 text-white lg:flex">
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

          <h1 className="text-2xl font-bold tracking-tight text-ink">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">
            Sign in with your Google account to continue.
          </p>

          <div className="mt-8 space-y-4">
            {!GOOGLE_CLIENT_ID ? (
              /* Dev/setup fallback — shown when VITE_GOOGLE_CLIENT_ID is not yet set */
              <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
                <strong>Setup required:</strong> Add <code className="font-mono text-xs">VITE_GOOGLE_CLIENT_ID</code> to
                your <code className="font-mono text-xs">.env</code> file, then restart the dev server.
              </div>
            ) : (
              <>
                {/* Google renders its button into this div */}
                <div ref={btnRef} className="w-full" />

                {/* Fallback button shown while GSI loads */}
                {!googleReady && (
                  <button
                    type="button"
                    disabled
                    className="inline-flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm font-medium text-ink opacity-60"
                  >
                    <GoogleIcon />
                    Loading Google Sign-In…
                  </button>
                )}
              </>
            )}

            {loading && (
              <p className="text-center text-sm text-muted">Signing in…</p>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
              >
                {error}
              </div>
            )}
          </div>

          <p className="mt-8 text-center text-xs text-muted">
            Your name and email from Google are used to personalise your workspace.
          </p>
        </div>
      </div>
    </div>
  );
}
