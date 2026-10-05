// Power menu: lock, sign out, restart, shut down – with FurrBox's own shutdown animation (the paw
// goes to sleep: toes fade out one by one, the ring unwinds, the screen fades to night).
// Shutting down closes the desktop app (window.close() ends Electron); in a normal browser tab,
// which may not close itself, a "FurrBox wurde heruntergefahren" screen remains.
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Lock, LogOut, Power, RotateCw } from "lucide-react";
import { signOut } from "@/lib/auth/client";
import { goOffline } from "@/lib/furr/api/session";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";

type PowerMode = "shutdown" | "restart" | "signout";

const usePower = create<{ mode: PowerMode | null; done: boolean; start: (m: PowerMode) => void; finish: () => void }>((set) => ({
  mode: null,
  done: false,
  start: (mode) => set({ mode, done: false }),
  finish: () => set({ done: true }),
}));

const ANIMATION_MS = 3400;

/** Power button in the start menu with the small Windows-style menu above it. */
export function PowerButton() {
  const [open, setOpen] = useState(false);
  const lock = useDesktop((s) => s.lock);
  const start = usePower((s) => s.start);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const items: { label: string; icon: typeof Power; run: () => void }[] = [
    { label: "Sperren", icon: Lock, run: lock },
    { label: "Abmelden", icon: LogOut, run: () => start("signout") },
    { label: "Neu starten", icon: RotateCw, run: () => start("restart") },
    { label: "Herunterfahren", icon: Power, run: () => start("shutdown") },
  ];

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="mica furr-flyout-in absolute bottom-12 right-0 z-10 w-48 overflow-hidden rounded-lg py-1 text-[13px] win-shadow">
          {items.map(({ label, icon: Icon, run }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setOpen(false);
                run();
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-fg/8"
            >
              <Icon className="size-4 text-muted" /> {label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label="Ein/Aus"
        title="Ein/Aus"
        onClick={() => setOpen((o) => !o)}
        className={cn("grid size-10 place-items-center rounded-md hover:bg-fg/8", open && "bg-fg/10")}
      >
        <Power className="size-4" />
      </button>
    </div>
  );
}

/** Full-screen shutdown / restart / sign-out animation (mounted once on the desktop). */
export function PowerOverlay() {
  const mode = usePower((s) => s.mode);
  const done = usePower((s) => s.done);
  const finish = usePower((s) => s.finish);

  useEffect(() => {
    if (!mode) return;
    const t = window.setTimeout(async () => {
      await goOffline().catch(() => undefined);
      if (mode === "restart") {
        window.location.reload();
        return;
      }
      if (mode === "signout") {
        await signOut("/").catch(() => window.location.reload());
        return;
      }
      finish();
      // Closes the FurrBox desktop app; ignored by normal browser tabs.
      window.setTimeout(() => window.close(), 700);
    }, ANIMATION_MS);
    return () => window.clearTimeout(t);
  }, [mode, finish]);

  if (!mode) return null;
  const text = mode === "restart" ? "FurrBox startet neu" : mode === "signout" ? "Du wirst abgemeldet" : "FurrBox fährt herunter";
  const sub = mode === "restart" ? "Gleich geht es weiter…" : mode === "signout" ? "Bis zum nächsten Mal!" : "Bis bald! 🐾";

  return (
    <div className="furr-power fixed inset-0 z-[10000] grid cursor-wait place-items-center overflow-hidden bg-[#06070b] text-white">
      <div className="furr-power-glow" aria-hidden />
      <div className="furr-power-stars" aria-hidden />
      {done ? (
        <div className="furr-power-done grid place-items-center gap-3 text-center">
          <Power className="size-8 text-white/40" />
          <p className="text-[15px] text-white/70">FurrBox wurde heruntergefahren.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md border border-white/15 px-4 py-2 text-[13px] text-white/80 hover:bg-white/10"
          >
            Wieder starten
          </button>
        </div>
      ) : (
        <div className="relative grid place-items-center gap-5">
          <div className={cn("furr-power-logo", mode === "restart" && "furr-power-restart")} aria-hidden>
            <svg className="furr-power-ring" viewBox="0 0 150 150">
              <defs>
                <linearGradient id="furr-power-rg" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--os-accent, #4cc2ff)" />
                  <stop offset="1" stopColor="#a78bfa" stopOpacity=".25" />
                </linearGradient>
              </defs>
              <circle cx="75" cy="75" r="70" />
            </svg>
            <svg className="furr-power-paw" viewBox="0 0 100 100">
              <g transform="rotate(-20 20 42)">
                <ellipse className="t1" cx="20" cy="42" rx="9" ry="12" />
              </g>
              <g transform="rotate(-6 38 24)">
                <ellipse className="t2" cx="38" cy="24" rx="10" ry="13" />
              </g>
              <g transform="rotate(6 62 24)">
                <ellipse className="t3" cx="62" cy="24" rx="10" ry="13" />
              </g>
              <g transform="rotate(20 80 42)">
                <ellipse className="t4" cx="80" cy="42" rx="9" ry="12" />
              </g>
              <path className="pad" d="M50 48c-13 0-26 13-28 26-2 11 6 17 15 15 5-1 9-3 13-3s8 2 13 3c9 2 17-4 15-15-2-13-15-26-28-26z" />
            </svg>
            {mode !== "restart" && (
              <span className="furr-power-zzz">
                <i>z</i>
                <i>z</i>
                <i>z</i>
              </span>
            )}
          </div>
          <p className="furr-power-text text-[20px] font-semibold tracking-wide">{text}</p>
          <p className="furr-power-text text-[13px] text-white/55" style={{ animationDelay: "0.25s" }}>
            {sub}
          </p>
        </div>
      )}
    </div>
  );
}
