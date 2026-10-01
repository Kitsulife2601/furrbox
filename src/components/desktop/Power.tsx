// Power menu like Windows: lock, sign out, restart, shut down – with a shutdown animation.
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

const ANIMATION_MS = 2600;

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
        <div className="mica absolute bottom-12 right-0 z-10 w-48 overflow-hidden rounded-lg py-1 text-[13px] win-shadow">
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
  const text = mode === "restart" ? "Neustart wird ausgeführt" : mode === "signout" ? "Abmelden" : "Wird heruntergefahren";

  return (
    <div className="furr-power fixed inset-0 z-[10000] grid cursor-wait place-items-center bg-[#06070b] text-white">
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
        <div className="grid place-items-center gap-6">
          <div className="furr-spinner" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
          <p className="text-[20px] font-light tracking-wide">{text}</p>
        </div>
      )}
    </div>
  );
}
