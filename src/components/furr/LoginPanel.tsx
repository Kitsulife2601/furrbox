import { useState } from "react";
import { authClient } from "@/lib/auth/client";

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.84a.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.25a18.3 18.3 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.92 1.53.07.07 0 0 0-.03.03C.44 9.05-.32 13.58.05 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.07 0a.07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.88.9a.08.08 0 0 0-.04.1c.36.7.78 1.36 1.23 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6-3.03.08.08 0 0 0 .04-.06c.44-5.18-.73-9.67-3.1-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42s.95-2.42 2.15-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

export function LoginPanel({ onBack }: { onBack?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signInWithDiscord() {
    setBusy(true);
    setError("");
    const result = await authClient.signIn.social({ provider: "discord", callbackURL: "/" });
    // On success the browser is already on its way to Discord.
    if (result.error) {
      setBusy(false);
      setError(
        result.error.status === 404 || /not found|provider/i.test(result.error.message ?? "")
          ? "Discord-Login ist auf diesem Server noch nicht eingerichtet."
          : result.error.message || "Anmeldung fehlgeschlagen.",
      );
    }
  }

  return (
    <div className="mica w-[min(400px,calc(100vw-2rem))] rounded-xl p-6 text-fg">
      <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-accent">FurrBox</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Anmelden</h1>
      <p className="mt-2 text-[13px] text-muted">
        Melde dich mit deinem Discord-Konto an. Staff-Rollen auf dem Fish-Server schalten die Team-Tools frei.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => void signInWithDiscord()}
        className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#5865F2] text-[14px] font-semibold text-white hover:bg-[#4752C4] disabled:opacity-60"
      >
        <DiscordIcon />
        {busy ? "Weiterleitung zu Discord…" : "Mit Discord anmelden"}
      </button>
      {error && <p className="mt-3 rounded-md bg-danger/15 px-3 py-2 text-[13px] text-fg">{error}</p>}

      {onBack && (
        <div className="mt-4 flex justify-end text-[12px] text-muted">
          <button type="button" className="underline-offset-4 hover:underline" onClick={onBack}>
            Sperrbildschirm
          </button>
        </div>
      )}
    </div>
  );
}
