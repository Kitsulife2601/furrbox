/**
 * „Neu in dieser Version“ – Changelog-Kacheln aus updates.json.
 * Einmal pro Version anzeigen (localStorage), stilistisch wie Votekick/MOTION.
 * Darstellung: Titel + kurze Bullet-Punkte (scannbar).
 */
import { useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";
import UPDATES from "@/lib/furr/updates.json";
import { MOTION } from "@/lib/furr/motion";
import { shortPoint, type UpdateEntry } from "./UpdatePopup";

const SEEN_KEY = "furrbox-whatsnew-seen";

function currentEntry(): UpdateEntry | null {
  const list = UPDATES as UpdateEntry[];
  return list.find((u) => u.version) ?? list[0] ?? null;
}

function seenVersion(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function markSeen(version: string) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* ignore */
  }
}

export function WhatsNewDialog() {
  const entry = useMemo(() => currentEntry(), []);
  const versionKey = entry?.version || entry?.date || "";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!entry || !versionKey) return;
    if (seenVersion() === versionKey) return;
    // Kurz nach Boot, damit Lock/Boot nicht überdeckt werden.
    const t = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(t);
  }, [entry, versionKey]);

  if (!open || !entry) return null;

  const close = () => {
    markSeen(versionKey);
    setOpen(false);
  };

  const items = entry.items.filter((i) => i && i !== entry.title);
  const shown = items.slice(0, 8);
  const more = items.length - shown.length;

  return (
    <div
      className="fixed inset-0 z-[115] grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={close}
    >
      <div
        className="mica furr-flyout-in w-[min(480px,100%)] overflow-hidden rounded-2xl border border-border/70 shadow-2xl"
        style={{ animationDuration: `${MOTION.popMs}ms`, animationTimingFunction: MOTION.easePop }}
        role="dialog"
        aria-labelledby="whatsnew-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/18 text-accent">
            <Sparkles className="size-5" strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Neu in dieser Version</p>
            <h2 id="whatsnew-title" className="text-[17px] font-semibold tracking-tight">
              {entry.title}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {entry.version ? `Version ${entry.version}` : entry.date}
              {entry.date ? ` · ${entry.date}` : ""}
            </p>
          </div>
          <button type="button" aria-label="Schließen" onClick={close} className="rounded-md p-1.5 hover:bg-fg/10">
            <X className="size-4" />
          </button>
        </header>
        <ul className="grid max-h-[min(360px,50vh)] gap-2 overflow-auto p-4">
          {shown.map((item, i) => (
            <li
              key={i}
              className="furr-vr-pop flex gap-2.5 rounded-xl border border-border/70 bg-elevated/40 px-3.5 py-3 text-[13px] leading-snug"
              style={{ animationDelay: `${Math.min(i, 6) * MOTION.noteGapMs}ms` }}
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span>{shortPoint(item, 140)}</span>
            </li>
          ))}
          {more > 0 && (
            <li className="px-1 text-[12px] text-subtle">+{more} weitere Punkte unter Einstellungen → System → Updates</li>
          )}
        </ul>
        <footer className="flex justify-end border-t border-border/50 px-4 py-3">
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg transition-transform duration-[180ms] ease-out active:scale-[0.98]"
          >
            Verstanden
          </button>
        </footer>
      </div>
    </div>
  );
}
