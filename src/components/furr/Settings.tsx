// FurrSettings: personalization, account (name/password/sign-out), chat retention, device monitor.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { getChatSettings, updateChatSettings } from "@/lib/furr/api/chat";
import { goOffline, updateMyProfile } from "@/lib/furr/api/session";
import { ME_KEY, errorMessage, useMe } from "@/lib/furr/client";
import { formatSize } from "@/lib/furr/paths";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WALLPAPER_LAYOUT,
  useDesktop,
  wallpaperStyle,
  type ThemeId,
  type WallpaperFit,
  type WallpaperId,
} from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { updateBridge, useUpdateState, type UpdateState } from "@/components/desktop/UpdatePopup";
import { Btn, ErrorText, Field, TextInput } from "./ui";

const ACCENTS = ["#4CC2FF", "#60A5FA", "#34D399", "#F472B6", "#FBBF24", "#F8FAFC"];
const WALLS: { id: WallpaperId; label: string }[] = [
  { id: "bloom", label: "Bloom" },
  { id: "dusk", label: "Dämmerung" },
  { id: "mist", label: "Nebel" },
  { id: "plain", label: "Einfarbig" },
];

const FITS: { id: WallpaperFit; label: string }[] = [
  { id: "fill", label: "Füllen" },
  { id: "fit", label: "Anpassen" },
  { id: "stretch", label: "Strecken" },
  { id: "center", label: "Zentrieren" },
  { id: "tile", label: "Kacheln" },
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
  const [busy, setBusy] = useState(false);

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
              {busy ? "Bild wird vorbereitet…" : "Bilddatei hochladen"}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setError("");
                  setBusy(true);
                  try {
                    s.setWallpaperUrl(await wallpaperDataUrl(file));
                  } catch {
                    setError("Das Bild konnte nicht gelesen werden.");
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
            {s.wallpaperUrl && <Btn onClick={() => s.setWallpaperUrl("")}>Zurücksetzen</Btn>}
          </div>
          <ErrorText>{error}</ErrorText>
          {s.wallpaperUrl && <WallpaperAdjust />}
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
    </div>
  );
}

/** Live preview + fit / focus point / darkening for a custom wallpaper image. */
function WallpaperAdjust() {
  const url = useDesktop((st) => st.wallpaperUrl);
  const layout = useDesktop((st) => st.wallpaperLayout) ?? DEFAULT_WALLPAPER_LAYOUT;
  const setLayout = useDesktop((st) => st.setWallpaperLayout);
  const canMove = layout.fit !== "stretch";

  function focusAt(e: React.PointerEvent<HTMLDivElement>) {
    if (!canMove) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.round(Math.min(Math.max(v, 0), 100));
    setLayout({ x: clamp(((e.clientX - rect.left) / rect.width) * 100), y: clamp(((e.clientY - rect.top) / rect.height) * 100) });
  }

  return (
    <div className="mt-2 grid gap-3 rounded-md bg-elevated/50 p-3">
      <p className="text-[13px] font-medium">Bild anpassen</p>
      <div
        className={cn("relative aspect-video w-full overflow-hidden rounded-md border border-border", canMove && "cursor-crosshair")}
        style={wallpaperStyle(url, layout)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          focusAt(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && focusAt(e)}
      >
        {canMove && (
          <span
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${layout.x}%`, top: `${layout.y}%` }}
          />
        )}
      </div>
      <p className="text-[11px] text-muted">
        {canMove ? "Klicke oder ziehe in der Vorschau, um den sichtbaren Bildausschnitt festzulegen." : "Beim Strecken wird das ganze Bild verzerrt angezeigt."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {FITS.map((f) => (
          <Btn key={f.id} variant={layout.fit === f.id ? "primary" : "default"} onClick={() => setLayout({ fit: f.id })}>
            {f.label}
          </Btn>
        ))}
      </div>
      <label className="grid gap-1 text-[12px]">
        <span className="flex justify-between">
          Waagerecht <span className="text-muted">{layout.x}%</span>
        </span>
        <input type="range" min={0} max={100} value={layout.x} disabled={!canMove} onChange={(e) => setLayout({ x: Number(e.target.value) })} />
      </label>
      <label className="grid gap-1 text-[12px]">
        <span className="flex justify-between">
          Senkrecht <span className="text-muted">{layout.y}%</span>
        </span>
        <input type="range" min={0} max={100} value={layout.y} disabled={!canMove} onChange={(e) => setLayout({ y: Number(e.target.value) })} />
      </label>
      <label className="grid gap-1 text-[12px]">
        <span className="flex justify-between">
          Abdunkeln <span className="text-muted">{layout.dim}%</span>
        </span>
        <input type="range" min={0} max={80} value={layout.dim} onChange={(e) => setLayout({ dim: Number(e.target.value) })} />
      </label>
      <div>
        <Btn variant="ghost" onClick={() => setLayout(DEFAULT_WALLPAPER_LAYOUT)}>
          Anpassung zurücksetzen
        </Btn>
      </div>
    </div>
  );
}

// Wallpapers live in browser storage (a few MB), so any image is scaled to screen size and
// re-encoded until it fits instead of rejecting large files.
const WALLPAPER_MAX_CHARS = 1_800_000;

async function wallpaperDataUrl(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxW = Math.min(2560, Math.round(window.screen.width * (window.devicePixelRatio || 1)) || 2560);
  let scale = Math.min(1, maxW / bitmap.width);
  let quality = 0.88;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/webp", quality);
    if (url.length <= WALLPAPER_MAX_CHARS) {
      bitmap.close();
      return url;
    }
    if (quality > 0.7) quality -= 0.08;
    else scale *= 0.8;
  }
  bitmap.close();
  throw new Error("too large");
}

function Account() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
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

  return (
    <div className="grid max-w-md gap-4">
      {me.data && (
        <div className="rounded-md bg-elevated/50 p-3 text-[13px]">
          <p className="font-medium">
            {me.data.displayName} <span className="text-muted">@{me.data.username}</span>
          </p>
          <p className="text-muted">
            {me.data.roleLabel}
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
  const update = useUpdateState();
  const rows: [string, string][] = [
    ["Version", update ? `FurrBox Desktop ${update.version}` : "FurrBox Web 2.0"],
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
      {update && <UpdateSection state={update} />}
    </div>
  );
}

const UPDATE_TEXT: Record<UpdateState["status"], string> = {
  idle: "Noch nicht geprüft.",
  unsupported: "Automatische Updates gibt es nur in der installierten Version (Setup), nicht in der portablen.",
  checking: "Suche nach Updates…",
  current: "FurrBox ist auf dem neuesten Stand.",
  downloading: "Update wird heruntergeladen…",
  ready: "Update ist bereit zum Installieren.",
  error: "Update-Prüfung fehlgeschlagen.",
};

function UpdateSection({ state }: { state: UpdateState }) {
  const [busy, setBusy] = useState(false);
  const detail =
    state.status === "downloading" && state.newVersion
      ? `Version ${state.newVersion} wird heruntergeladen (${state.percent ?? 0} %).`
      : state.status === "ready" && state.newVersion
        ? `Version ${state.newVersion} ist bereit.`
        : UPDATE_TEXT[state.status];
  return (
    <div className="mt-6 grid gap-2 rounded-md bg-elevated/50 p-3 text-[13px]">
      <p className="font-medium">Updates</p>
      <p className="text-muted">{detail}</p>
      {state.status === "error" && state.error && <ErrorText>{state.error}</ErrorText>}
      <div className="flex gap-2">
        {state.status === "ready" ? (
          <Btn variant="primary" onClick={() => void updateBridge()?.install()}>
            Jetzt neu starten und installieren
          </Btn>
        ) : (
          <Btn
            disabled={busy || state.status === "unsupported" || state.status === "checking" || state.status === "downloading"}
            onClick={async () => {
              setBusy(true);
              await updateBridge()?.check().catch(() => undefined);
              setBusy(false);
            }}
          >
            Nach Updates suchen
          </Btn>
        )}
      </div>
      <p className="text-[11px] text-subtle">Updates kommen automatisch aus den GitHub-Releases von FurrBox.</p>
    </div>
  );
}
