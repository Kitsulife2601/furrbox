// Gate after the Discord login: not on the Fish server / not whitelisted, or the whitelist
// login step (FurrBox name + password, then replacing the owner's start password).
import { useState, type CSSProperties, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { signOut } from "@/lib/auth/client";
import { changeWhitelistPassword, whitelistLogin } from "@/lib/furr/api/whitelist";
import { ME_KEY, errorMessage } from "@/lib/furr/client";
import type { Me } from "@/lib/furr/types";

type Props = { me: Me; onRetry: () => void; style?: CSSProperties; wallpaper: string };

const input =
  "h-10 w-full rounded-md border border-border bg-bg/70 px-3 text-[13px] text-fg outline-none focus:border-accent";

export function NoAccess({ me, onRetry, style, wallpaper }: Props) {
  const login = me.accessReason === "needs_password" || me.accessReason === "must_change_password";
  return (
    <div className={`grid h-dvh place-items-center bg-cover bg-center p-4 wallpaper-${wallpaper}`} style={style}>
      <div className="mica w-[min(440px,calc(100vw-2rem))] rounded-xl p-6 text-fg">
        {me.accessReason === "needs_password" ? (
          <PasswordLogin me={me} />
        ) : me.accessReason === "must_change_password" ? (
          <ChangePassword me={me} />
        ) : (
          <Blocked me={me} />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => void signOut("/")} className="flex h-9 items-center gap-2 rounded-md px-3 text-[13px] hover:bg-fg/6">
            <LogOut className="size-4" /> Abmelden
          </button>
          {!login && (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-fg"
            >
              <RefreshCw className="size-4" /> Erneut prüfen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ icon, title }: { icon: "alert" | "key"; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`grid size-10 place-items-center rounded-full ${icon === "alert" ? "bg-danger/20 text-danger" : "bg-accent/20 text-accent"}`}
      >
        {icon === "alert" ? <ShieldAlert className="size-5" /> : <KeyRound className="size-5" />}
      </span>
      <div>
        <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-accent">FurrBox</p>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>
    </div>
  );
}

function Blocked({ me }: { me: Me }) {
  const [copied, setCopied] = useState(false);
  const notInGuild = me.accessReason === "not_in_guild";
  const text = notInGuild
    ? `Hallo ${me.displayName}! FurrBox ist nur für Mitglieder des Fish-Discord-Servers. Tritt dem Server bei und klicke dann auf „Erneut prüfen“.`
    : me.accessReason === "no_credentials"
      ? `Hallo ${me.displayName}! Du bist freigeschaltet, aber der Owner hat dir noch keinen Nutzernamen und kein Passwort gegeben. Frag ihn danach.`
      : `Hallo ${me.displayName}! Du bist mit Discord angemeldet, aber noch nicht auf der FurrBox-Whitelist. Schick dem Owner deine Discord-ID, damit er dir einen Zugang anlegt.`;
  return (
    <>
      <Header icon="alert" title={notInGuild ? "Nicht auf dem Fish-Server" : "Noch nicht freigeschaltet"} />
      <p className="mt-3 text-[13px] text-muted">{text}</p>
      {!notInGuild && me.discordId && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(me.discordId ?? "").then(() => setCopied(true));
          }}
          className="mt-4 flex w-full items-center justify-between rounded-md bg-bg/60 px-3 py-2 text-left hover:bg-fg/6"
        >
          <span>
            <span className="block text-[11px] text-muted">Deine Discord-ID</span>
            <span className="font-mono text-[14px]">{me.discordId}</span>
          </span>
          <span className="flex items-center gap-1 text-[12px] text-accent">
            <Copy className="size-3.5" /> {copied ? "Kopiert" : "Kopieren"}
          </span>
        </button>
      )}
    </>
  );
}

/** Step 2 after Discord: FurrBox name + password from the owner. */
function PasswordLogin({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await whitelistLogin({ data: { username, password } });
      queryClient.setQueryData(ME_KEY, next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Header icon="key" title="FurrBox-Login" />
      <p className="mt-3 text-[13px] text-muted">
        Hallo {me.displayName}! Discord ist verbunden. Melde dich jetzt mit dem Nutzernamen und Passwort an, die du vom Owner
        bekommen hast.
      </p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-[12px]">
          Nutzername
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className={input} required autoFocus />
        </label>
        <label className="grid gap-1 text-[12px]">
          Passwort
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={input} required />
        </label>
        {error && <p className="rounded-md bg-danger/15 px-3 py-2 text-[12px]">{error}</p>}
        <button type="submit" disabled={busy} className="h-10 rounded-md bg-accent text-[13px] font-semibold text-accent-fg disabled:opacity-60">
          {busy ? "Prüfe…" : "Anmelden"}
        </button>
      </div>
    </form>
  );
}

/** First login with the owner's start password: choose an own password. */
function ChangePassword({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setError("Die beiden neuen Passwörter stimmen nicht überein.");
    setBusy(true);
    setError("");
    try {
      const updated = await changeWhitelistPassword({ data: { currentPassword: current, newPassword: next } });
      queryClient.setQueryData(ME_KEY, updated);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Header icon="key" title="Eigenes Passwort festlegen" />
      <p className="mt-3 text-[13px] text-muted">
        Willkommen, {me.whitelistUsername ?? me.displayName}! Du nutzt noch das Start-Passwort vom Owner. Leg jetzt ein eigenes
        Passwort fest (mindestens 8 Zeichen).
      </p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-[12px]">
          Start-Passwort
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className={input} required autoFocus />
        </label>
        <label className="grid gap-1 text-[12px]">
          Neues Passwort
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} className={input} required />
        </label>
        <label className="grid gap-1 text-[12px]">
          Neues Passwort wiederholen
          <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" minLength={8} className={input} required />
        </label>
        {error && <p className="rounded-md bg-danger/15 px-3 py-2 text-[12px]">{error}</p>}
        <button type="submit" disabled={busy} className="h-10 rounded-md bg-accent text-[13px] font-semibold text-accent-fg disabled:opacity-60">
          {busy ? "Speichere…" : "Passwort speichern & loslegen"}
        </button>
      </div>
    </form>
  );
}
