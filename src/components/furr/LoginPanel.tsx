import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, UserPlus } from "lucide-react";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

// Mirrors the key used by `@/lib/auth/client` so email sign-in also works inside the
// live-preview iframe (partitioned cookies), exactly like the provider popup flow.
const BEARER_KEY = "grok-auth.bearer-token";

function rememberBearer(headers: Headers | undefined) {
  const token = headers?.get("set-auth-token");
  if (!token || !window.location.hostname.endsWith(".grok-sandbox.com")) return;
  try {
    window.sessionStorage.setItem(BEARER_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

export function LoginPanel({ onBack }: { onBack?: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fetchOptions = {
      onSuccess: (ctx: { response: Response }) => rememberBearer(ctx.response.headers),
    };
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email: email.trim(), password }, fetchOptions)
        : await authClient.signUp.email({ email: email.trim(), password, name: name.trim() || email.split("@")[0] }, fetchOptions);
    setBusy(false);
    if (result.error) {
      setError(
        result.error.status === 401
          ? "E-Mail oder Passwort ist falsch."
          : result.error.message || "Anmeldung fehlgeschlagen.",
      );
      return;
    }
    await authClient.getSession({ query: { disableCookieCache: true } }).catch(() => undefined);
    await queryClient.invalidateQueries();
    window.location.reload();
  }

  return (
    <div className="mica w-[min(400px,calc(100vw-2rem))] rounded-xl p-6 text-fg">
      <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-accent">FurrBox</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">
        {mode === "signin" ? "Anmelden" : "Konto erstellen"}
      </h1>
      <form onSubmit={submit} className="mt-5 grid gap-3">
        {mode === "signup" && (
          <label className="grid gap-1 text-[13px]">
            Nutzername
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
              className="h-10 rounded-md border border-border bg-bg/70 px-3 outline-none focus:border-accent"
            />
          </label>
        )}
        <label className="grid gap-1 text-[13px]">
          E-Mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-10 rounded-md border border-border bg-bg/70 px-3 outline-none focus:border-accent"
          />
        </label>
        <label className="grid gap-1 text-[13px]">
          Passwort
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="h-10 rounded-md border border-border bg-bg/70 px-3 outline-none focus:border-accent"
          />
        </label>
        {error && <p className="rounded-md bg-danger/15 px-3 py-2 text-[13px] text-fg">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-1 flex h-10 items-center justify-center gap-2 rounded-md bg-accent text-[13px] font-semibold text-accent-fg disabled:opacity-60"
        >
          {mode === "signin" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}
          {busy ? "Bitte warten…" : mode === "signin" ? "Anmelden" : "Konto erstellen"}
        </button>
      </form>

      <div className="mt-4 grid gap-2">
        {GROK_PROVIDERS.map((p) => (
          <button
            key={p.providerId}
            type="button"
            onClick={() => void signIn(p.providerId, { callbackURL: "/" })}
            className="h-10 rounded-md border border-border text-[13px] hover:bg-fg/6"
          >
            Weiter mit {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-[12px] text-muted">
        <button
          type="button"
          className={cn("underline-offset-4 hover:underline")}
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError("");
          }}
        >
          {mode === "signin" ? "Noch kein Konto? Registrieren" : "Schon registriert? Anmelden"}
        </button>
        {onBack && (
          <button type="button" className="underline-offset-4 hover:underline" onClick={onBack}>
            Sperrbildschirm
          </button>
        )}
      </div>
    </div>
  );
}
