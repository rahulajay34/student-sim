import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homePathFor } from "../lib/auth.jsx";
import Button from "../ui/Button";
import Input from "../ui/Input";

const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin@masai.com", password: "admin123" },
  { label: "Priya — Counsellor", email: "priya@masai.com", password: "priya123" },
  { label: "Rohan — Counsellor", email: "rohan@masai.com", password: "rohan123" },
];

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

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = await login(email, password);
      navigate(homePathFor(u));
    } catch (err) {
      setError(err?.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(acc) {
    setEmail(acc.email);
    setPassword(acc.password);
    setError("");
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Left brand panel (lg only) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-600 p-12 text-white lg:flex">
        {/* Soft ambient glows */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-brand-50/10 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-base font-bold backdrop-blur">
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-base font-bold text-white">
              M
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-ink">Masai</div>
              <div className="text-xs text-muted">Counselling Trainer</div>
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-ink">Welcome back</h2>
          <p className="mt-1.5 text-sm text-muted">
            Sign in to continue to your training workspace.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <Input
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@masai.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
              >
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {/* Demo accounts */}
          <div className="mt-8">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-line" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Demo accounts
              </span>
              <div className="h-px flex-1 bg-line" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => fillDemo(acc)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
                  {acc.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Click a chip to pre-fill credentials, then press Sign in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
