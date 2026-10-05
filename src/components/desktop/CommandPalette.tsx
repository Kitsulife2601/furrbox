/**
 * Ctrl+K Command-Palette (VRCX-Vorbild, eigene FurrBox-Optik).
 * Suche: Staff/User, Fälle, Watchlist, Commands (Duty, Settings).
 * Debounce ~180 ms; ≥1 Zeichen Namen, ≥2 Notizen. Index nur bei geöffneter Palette.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileWarning,
  Eye,
  Search,
  Settings,
  ShieldCheck,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { listEvidenceCases } from "@/lib/furr/api/evidence";
import { listPresence } from "@/lib/furr/api/presence";
import { listWatchlist } from "@/lib/furr/api/watchlist";
import { MOTION } from "@/lib/furr/motion";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { DUTY_LABEL, useDuty } from "@/components/furr/useDuty";

type Cat = "cmd" | "staff" | "case" | "watch";

type Hit = {
  id: string;
  cat: Cat;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  run: () => void;
  /** Für Notiz-Suche (Watchlist) – braucht ≥2 Zeichen */
  noteHay?: string;
};

const CAT_LABEL: Record<Cat, string> = {
  cmd: "Befehle",
  staff: "Staff / User",
  case: "Fälle",
  watch: "Watchlist",
};

const CAT_ORDER: Cat[] = ["cmd", "staff", "case", "watch"];

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeMenus = useDesktop((s) => s.closeMenus);
  const openApp = useDesktop((s) => s.openApp);
  const setTray = useDesktop((s) => s.setTray);
  const duty = useDuty();
  const debounced = useDebounced(q, 180);
  const needle = debounced.trim().toLowerCase();

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setSel(0);
  }, []);

  // Globaler Shortcut: Ctrl/Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (o) {
            setQ("");
            setSel(0);
            return false;
          }
          closeMenus();
          return true;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMenus]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // Index nur bei geöffneter Palette
  const staffQ = useQuery({
    queryKey: ["furr", "presence", "palette"],
    queryFn: () => listPresence({ data: "team" }),
    enabled: open && duty.allowed,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const casesQ = useQuery({
    queryKey: ["furr", "evidence", "palette"],
    queryFn: () => listEvidenceCases(),
    enabled: open && duty.allowed,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const watchQ = useQuery({
    queryKey: ["furr", "watchlist", "palette"],
    queryFn: () => listWatchlist(),
    enabled: open && duty.allowed,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const commands: Hit[] = useMemo(() => {
    const list: Hit[] = [
      {
        id: "cmd-settings",
        cat: "cmd",
        title: "Einstellungen öffnen",
        subtitle: "Personalisierung, System, Töne",
        icon: Settings,
        run: () => openApp("settings"),
      },
    ];
    if (duty.allowed) {
      list.unshift(
        {
          id: "cmd-duty-toggle",
          cat: "cmd",
          title: duty.status === "off" ? "Anwesend schalten" : "Nicht anwesend schalten",
          subtitle: `Aktuell: ${DUTY_LABEL[duty.status]}`,
          icon: UserCheck,
          run: () => void duty.toggle(),
        },
        {
          id: "cmd-duty-away",
          cat: "cmd",
          title: "Kurz weg (Away)",
          subtitle: "Team sieht dich als kurz abwesend",
          icon: UserCheck,
          run: () => void duty.setStatus("away"),
        },
        {
          id: "cmd-staff-tray",
          cat: "cmd",
          title: "Staff-Tray öffnen",
          subtitle: "Duty, Chatbox, Tools",
          icon: ShieldCheck,
          run: () => setTray("staff"),
        },
        {
          id: "cmd-moddash",
          cat: "cmd",
          title: "Mod-Dashboard öffnen",
          subtitle: "Alerts · Duty · Instanz",
          icon: ShieldCheck,
          run: () => openApp("moddash"),
        },
        {
          id: "cmd-evidence",
          cat: "cmd",
          title: "Evidence öffnen",
          icon: FileWarning,
          run: () => openApp("evidence"),
        },
      );
    }
    return list;
  }, [duty, openApp, setTray]);

  const hits = useMemo(() => {
    const out: Hit[] = [];
    const nameOk = needle.length >= 1;
    const noteOk = needle.length >= 2;

    const matchCmd = (h: Hit) => {
      if (!needle) return true;
      const hay = `${h.title} ${h.subtitle ?? ""}`.toLowerCase();
      return hay.includes(needle);
    };
    for (const c of commands) if (matchCmd(c)) out.push(c);

    if (duty.allowed && nameOk) {
      for (const u of staffQ.data ?? []) {
        const name = (u.displayName || u.username || "").toLowerCase();
        const nick = (u.nickname || "").toLowerCase();
        const disc = (u.discordUsername || "").toLowerCase();
        if (!name.includes(needle) && !nick.includes(needle) && !disc.includes(needle)) continue;
        out.push({
          id: `staff-${u.id}`,
          cat: "staff",
          title: u.displayName || u.username,
          subtitle: [u.roleLabel, u.isAppOnline ? "App online" : u.isDiscordOnline ? "Discord" : "offline"]
            .filter(Boolean)
            .join(" · "),
          icon: Users,
          run: () => openApp("presence"),
        });
      }
      for (const c of casesQ.data ?? []) {
        const hay = `${c.caseId} ${c.platform}`.toLowerCase();
        if (!hay.includes(needle)) continue;
        out.push({
          id: `case-${c.path}`,
          cat: "case",
          title: c.caseId,
          subtitle: `${c.platform} · ${c.fileCount} Dateien`,
          icon: FileWarning,
          run: () => openApp("evidence"),
        });
      }
    }

    if (duty.allowed && (nameOk || noteOk)) {
      for (const w of watchQ.data ?? []) {
        const name = (w.displayName || w.usrId).toLowerCase();
        const note = (w.note || "").toLowerCase();
        const nameHit = nameOk && name.includes(needle);
        const noteHit = noteOk && note.includes(needle);
        if (!nameHit && !noteHit) continue;
        out.push({
          id: `watch-${w.usrId}`,
          cat: "watch",
          title: w.displayName || w.usrId,
          subtitle: w.note || w.usrId,
          icon: Eye,
          noteHay: w.note,
          run: () => openApp("evidence"),
        });
      }
    }

    return out.slice(0, 40);
  }, [needle, commands, duty.allowed, staffQ.data, casesQ.data, watchQ.data, openApp]);

  useEffect(() => setSel(0), [hits.length, needle]);

  const runHit = (h: Hit) => {
    close();
    h.run();
  };

  if (!open) return null;

  const grouped = CAT_ORDER.map((cat) => ({
    cat,
    items: hits.filter((h) => h.cat === cat),
  })).filter((g) => g.items.length > 0);

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-start bg-black/45 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={close}
      role="presentation"
    >
      <div
        className="mica furr-flyout-in w-[min(560px,calc(100%-1.5rem))] overflow-hidden rounded-2xl border border-border/70 shadow-2xl"
        style={{ animationDuration: `${MOTION.enterMs}ms` }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Befehlspalette"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Search className="size-4 shrink-0 text-subtle" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((i) => Math.min(i + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const h = hits[sel];
                if (h) runHit(h);
              }
            }}
            placeholder="Staff, Fälle, Watchlist, Befehle…"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
            aria-autocomplete="list"
          />
          <kbd className="rounded bg-fg/8 px-1.5 py-0.5 text-[10px] font-medium text-muted">Esc</kbd>
        </div>
        <div className="max-h-[min(420px,55vh)] overflow-auto p-2">
          {!hits.length && (
            <p className="px-3 py-6 text-center text-[13px] text-muted">
              {needle ? "Keine Treffer." : "Tippe, um zu suchen – oder wähle einen Befehl."}
            </p>
          )}
          {grouped.map((g) => (
            <div key={g.cat} className="mb-2">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{CAT_LABEL[g.cat]}</p>
              <ul>
                {g.items.map((h) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const Icon = h.icon;
                  const active = idx === sel;
                  return (
                    <li key={h.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setSel(idx)}
                        onClick={() => runHit(h)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-[180ms] ease-out",
                          active ? "bg-accent/18 text-fg" : "hover:bg-fg/8",
                        )}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-elevated/80 text-accent">
                          <Icon className="size-4" strokeWidth={1.7} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{h.title}</span>
                          {h.subtitle && <span className="block truncate text-[11px] text-muted">{h.subtitle}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="border-t border-border/50 px-4 py-2 text-[11px] text-subtle">
          ↑↓ wählen · Enter öffnen · Ctrl+K schließen
        </p>
      </div>
    </div>
  );
}
