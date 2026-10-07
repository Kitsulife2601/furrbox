// Keyboard shortcuts of the FurrBox desktop and the overview shown in FurrSettings → Tastenkürzel.
// Windows keeps Win+… and Alt+Tab for itself, so the window shortcuts use Strg+Alt.
import { useEffect } from "react";
import { useDesktop } from "@/store/desktop";

const TASKBAR_PX = 48;

type Shortcut = { keys: string; what: string; where?: string };

/** Everything listed here works – the first group is handled by useDesktopShortcuts below. */
export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Fenster",
    items: [
      { keys: "Strg + Alt + ←", what: "Fenster an die linke Hälfte andocken" },
      { keys: "Strg + Alt + →", what: "Fenster an die rechte Hälfte andocken" },
      { keys: "Strg + Alt + ↑", what: "Fenster maximieren / wieder verkleinern" },
      { keys: "Strg + Alt + ↓", what: "Fenster minimieren" },
      { keys: "Strg + Alt + W", what: "Fenster schließen" },
      { keys: "Strg + Alt + D", what: "Desktop anzeigen / Fenster zurückholen" },
    ],
  },
  {
    title: "Desktop",
    items: [
      { keys: "Strg + K", what: "Befehls-Suche öffnen (Team, Fälle, Watchlist, Befehle)" },
      { keys: "Strg + Alt + S", what: "Suche nach Apps und Dateien öffnen" },
      { keys: "Strg + Alt + L", what: "FurrBox sperren" },
      { keys: "Esc", what: "Menü, Startmenü oder Suche schließen" },
      { keys: "Entf", what: "Markierte Datei auf dem Desktop oder in FurrFS löschen" },
    ],
  },
  {
    title: "In Apps",
    items: [
      { keys: "Strg + S", what: "Textdatei speichern", where: "Editor und Datei-Ansicht" },
      { keys: "Enter", what: "Nachricht senden (Umschalt + Enter = neue Zeile)", where: "FurrChat" },
      { keys: "Strg + V", what: "Bild oder Datei aus der Zwischenablage anhängen", where: "FurrChat" },
    ],
  },
  {
    title: "Nur in der Desktop-App",
    items: [
      { keys: "F11", what: "Vollbild ein / aus" },
      { keys: "Strg + Umschalt + C", what: "Beweis-Clip speichern (geht auch, wenn FurrBox im Hintergrund ist)" },
      { keys: "Strg + Umschalt + M", what: "Clip-Anfang / Clip-Ende markieren" },
      { keys: "Strg + Umschalt + Q", what: "FurrBox beenden" },
    ],
  },
];

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.("input, textarea, select, [contenteditable='true']"));
}

/** Mounted once on the desktop: window shortcuts with Strg+Alt. */
export function useDesktopShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
      // AltGr is reported as Strg+Alt on German keyboards – never steal characters while typing.
      if (typing(e.target) || e.getModifierState?.("AltGraph")) return;
      const s = useDesktop.getState();
      if (s.locked) return;
      const id = s.focusedId;
      const width = window.innerWidth;
      const height = window.innerHeight - TASKBAR_PX;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (key === "d") return run(() => s.toggleShowDesktop());
      if (key === "l") return run(() => s.lock());
      if (key === "s") return run(() => s.toggleSearch());
      if (!id) return;
      if (key === "ArrowLeft") return run(() => s.snapWindow(id, { x: 0, y: 0, w: Math.floor(width / 2), h: height }));
      if (key === "ArrowRight") return run(() => s.snapWindow(id, { x: Math.floor(width / 2), y: 0, w: Math.ceil(width / 2), h: height }));
      if (key === "ArrowUp") return run(() => s.toggleMaximize(id));
      if (key === "ArrowDown") return run(() => s.minimizeWindow(id));
      if (key === "w") return run(() => s.closeWindow(id));
    };
    // Not a shortcut, but the same "once per desktop" place: keep windows on screen after a resize.
    let timer: number | null = null;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => useDesktop.getState().refitWindows(), 150);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, []);
}

/** The overview for FurrSettings. */
export function ShortcutList() {
  return (
    <div className="grid gap-5">
      <p className="text-[12px] text-muted">
        Die Fenster-Kürzel nutzen Strg + Alt, weil Windows die Windows-Taste und Alt + Tab für sich behält.
      </p>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="grid gap-1.5">
          <h3 className="text-[13px] font-semibold">{group.title}</h3>
          <div className="grid gap-1">
            {group.items.map((item) => (
              <div key={item.keys + item.what} className="flex items-center gap-3 rounded-lg bg-elevated/30 px-3 py-2">
                <kbd className="w-44 shrink-0 rounded-md border border-border bg-bg/70 px-2 py-1 text-center font-mono text-[11px]">{item.keys}</kbd>
                <span className="min-w-0 flex-1 text-[13px]">
                  {item.what}
                  {item.where && <span className="text-subtle"> · {item.where}</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
