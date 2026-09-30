// Shown to signed-in users who are neither Discord staff nor on the FurrWhitelist.
import { useState, type CSSProperties } from "react";
import { Copy, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { signOut } from "@/lib/auth/client";
import type { Me } from "@/lib/furr/types";

export function NoAccess({ me, onRetry, style, wallpaper }: { me: Me; onRetry: () => void; style?: CSSProperties; wallpaper: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`grid h-dvh place-items-center bg-cover bg-center p-4 wallpaper-${wallpaper}`} style={style}>
      <div className="mica w-[min(440px,calc(100vw-2rem))] rounded-xl p-6 text-fg">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-danger/20 text-danger">
            <ShieldAlert className="size-5" />
          </span>
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-accent">FurrBox</p>
            <h1 className="text-lg font-semibold tracking-tight">Noch nicht freigeschaltet</h1>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Hallo {me.displayName}! Du bist mit Discord angemeldet, aber noch nicht auf der FurrBox-Whitelist. Schick dem Owner
          deine Discord-ID, damit er dich freischaltet.
        </p>
        {me.discordId && (
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
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => void signOut("/")} className="flex h-9 items-center gap-2 rounded-md px-3 text-[13px] hover:bg-fg/6">
            <LogOut className="size-4" /> Abmelden
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-fg"
          >
            <RefreshCw className="size-4" /> Erneut prüfen
          </button>
        </div>
      </div>
    </div>
  );
}
