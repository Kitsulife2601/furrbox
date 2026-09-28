// FurrSettings: personalization, account (name/password/sign-out), chat retention, device monitor.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient, signOut } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { getChatSettings, updateChatSettings } from "@/lib/furr/api/chat";
import { goOffline, updateMyProfile } from "@/lib/furr/api/session";
import { ME_KEY, errorMessage, useMe } from "@/lib/furr/client";
import { formatSize } from "@/lib/furr/paths";
import { cn } from "@/lib/utils";
import { useDesktop, type ThemeId, type WallpaperId } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { Btn, ErrorText, Field, TextInput } from "./ui";

const ACCENTS = ["#4CC2FF", "#60A5FA", "#34D399", "#F472B6", "#FBBF24", "#F8FAFC"];
const WALLS: { id: WallpaperId; label: string }[] = [
  { id: "bloom", label: "Bloom" },
  { id: "dusk", label: "Dämmerung" },
  { id: "mist", label: "Nebel" },
  { id: "plain", label: "Einfarbig" },
];

type Section = "personal" | "account" | "chat" | "system";

export function Settings() {
  const me = useMe();
  const [section, setSection] = useState<Section>("personal");
  const sections: [Section, string][] = [
    ["personal", "Personalisierung"],
    ["account", "Konto"],
    ...(me.data?.permissions.canConfigureChat ? ([["chat", "FurrChat"]] as [Section, string][]) : []),
    ["system", "System"],
  ];
  return (
    <div className="flex h-full bg-bg/40">
      <aside className="w-40 shrink-0 border-r border-border p-2 text-[13px]">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn("block w-full rounded-sm px-2 py-1.5 text-left hover:bg-fg/6", section === id && "bg-fg/10 font-medium")}
          >
            {label}
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-auto p-5">
        {section === "personal" && <Personal />}
        {section === "account" && <Account />}
        {section === "chat" && <ChatRetention />}
        {section === "system" && <SystemInfo />}
      </div>
    </div>
  );
}

function Personal() {
  const s = useDesktop();
  const [url, setUrl] = useState(s.wallpaperUrl.startsWith("data:") ? "" : s.wallpaperUrl);
  const [error, setError] = useState("");

  return (
    <div className="grid max-w-xl gap-5">
      <div>
        <p className="text-[13px] font-medium">Modus</p>
        <div className="mt-2 flex gap-2">
          {(["dark", "light"] as ThemeId[]).map((t) => (
            <Btn key={t} variant={s.theme === t ? "primary" : "default"} onClick={() => s.setTheme(t)}>
              {t === "dark" ? "Dunkel" : "Hell"}
            </Btn>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[13px] font-medium">Hintergrund</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WALLS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => s.setWallpaper(w.id)}
              className={cn("overflow-hidden rounded-md text-left", !s.wallpaperUrl && s.wallpaper === w.id && "ring-2 ring-accent")}
            >
              <div className={`h-14 wallpaper-${w.id}`} />
              <span className="block bg-elevated px-2 py-1 text-[12px]">{w.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2">
          <Field label="Eigenes Hintergrundbild (URL)">
            <div className="flex gap-2">
              <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              <Btn onClick={() => s.setWallpaperUrl(url)}>Übernehmen</Btn>
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md bg-elevated px-3 text-[13px] hover:bg-fg/10">
              Bilddatei hochladen
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > 1.5 * 1024 * 1024) return setError("Bild ist zu groß (max. 1,5 MB).");
                  setError("");
                  const reader = new FileReader();
                  reader.onload = () => s.setWallpaperUrl(String(reader.result ?? ""));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {s.wallpaperUrl && <Btn onClick={() => s.setWallpaperUrl("")}>Zurücksetzen</Btn>}
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
      <div>
        <p className="text-[13px] font-medium">Akzentfarbe</p>
        <div className="mt-2 flex gap-2">
          {ACCENTS.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              onClick={() => s.setAccent(hex)}
              className={cn("size-8 rounded-full", s.accent === hex && "ring-2 ring-fg ring-offset-2 ring-offset-surface")}
              style={{ background: hex }}
            />
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={s.bootSound} onChange={(e) => s.setBootSound(e.target.checked)} />
        Startsound beim Entsperren abspielen
      </label>
    </div>
  );
}

function Account() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const gateSession = typeof document !== "undefined" && hasGateSessionMarker();

  useEffect(() => {
    if (me.data) setName(me.data.displayName);
  }, [me.data]);

  async function saveName() {
    setError("");
    try {
      await updateMyProfile({ data: { displayName: name } });
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      setMsg("Anzeigename gespeichert.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function changePassword() {
    setError("");
    setMsg("");
    const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: false });
    if (res.error) return setError(res.error.message || "Passwort konnte nicht geändert werden.");
    setCurrent("");
    setNext("");
    setMsg("Passwort geändert.");
  }

  return (
    <div className="grid max-w-md gap-4">
      {me.data && (
        <div className="rounded-md bg-elevated/50 p-3 text-[13px]">
          <p className="font-medium">
            {me.data.displayName} <span className="text-muted">@{me.data.username}</span>
          </p>
          <p className="text-muted">
            {me.data.email} · {me.data.roleLabel}
            {me.data.discordId ? ` · Discord ${me.data.discordId}` : ""}
          </p>
        </div>
      )}
      <Field label="Anzeigename">
        <div className="flex gap-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          <Btn onClick={() => void saveName()}>Speichern</Btn>
        </div>
      </Field>
      <p className="text-[13px] font-medium">Passwort ändern</p>
      <Field label="Aktuelles Passwort">
        <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label="Neues Passwort" hint="Nur für E-Mail/Passwort-Konten, mindestens 8 Zeichen">
        <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <Btn disabled={!current || next.length < 8} onClick={() => void changePassword()}>
        Passwort ändern
      </Btn>
      {msg && <p className="text-[12px] text-emerald-300">{msg}</p>}
      <ErrorText>{error}</ErrorText>
      {!gateSession && (
        <Btn
          variant="danger"
          onClick={async () => {
            await goOffline().catch(() => undefined);
            try {
              await signOut("/");
            } catch (e) {
              useNotifications.getState().notify({ version: "FurrBox", title: "Abmelden fehlgeschlagen", description: errorMessage(e) });
            }
          }}
        >
          Abmelden
        </Btn>
      )}
    </div>
  );
}

function ChatRetention() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["furr", "chat-settings"], queryFn: () => getChatSettings() });
  const [days, setDays] = useState(7);
  const [error, setError] = useState("");
  useEffect(() => {
    if (settings.data) setDays(settings.data.retentionDays);
  }, [settings.data]);
  return (
    <div className="grid max-w-sm gap-3">
      <Field label="Auto-Löschung von Chatnachrichten nach (Tagen)" hint="1–365 Tage, gilt für Team- und Privatchats">
        <TextInput type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </Field>
      <Btn
        variant="primary"
        onClick={async () => {
          setError("");
          try {
            await updateChatSettings({ data: days });
            await queryClient.invalidateQueries({ queryKey: ["furr", "chat-settings"] });
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        Speichern
      </Btn>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Device monitor (the FurrBox hardware monitor showed host stats; a web app sees the viewer's device). */
function SystemInfo() {
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setStorage({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => undefined);
  }, []);
  const nav = typeof navigator === "undefined" ? null : (navigator as Navigator & { deviceMemory?: number });
  const rows: [string, string][] = [
    ["Version", "FurrBox Web 2.0"],
    ["CPU-Kerne", String(nav?.hardwareConcurrency ?? "?")],
    ["Arbeitsspeicher", nav?.deviceMemory ? `≈ ${nav.deviceMemory} GB` : "unbekannt"],
    ["Browser-Speicher", storage ? `${formatSize(storage.usage)} von ${formatSize(storage.quota)}` : "unbekannt"],
    ["Bildschirm", typeof window === "undefined" ? "" : `${window.screen.width} × ${window.screen.height}`],
    ["Sprache", nav?.language ?? ""],
    ["Online", nav?.onLine ? "ja" : "nein"],
  ];
  return (
    <div className="max-w-md">
      <p className="text-[13px] font-medium">Gerätemonitor</p>
      <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
