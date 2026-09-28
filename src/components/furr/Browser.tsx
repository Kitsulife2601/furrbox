// FurrBrowser: address bar, history, reload, open-in-new-tab. Many sites refuse to be framed
// (X-Frame-Options), so "Im neuen Tab öffnen" is always available.
import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Home, RotateCw } from "lucide-react";
import type { WindowPayload } from "@/store/desktop";
import { Btn } from "./ui";

const HOME = "https://www.wikipedia.org/";

function normalizeUrl(raw: string) {
  const value = raw.trim();
  if (!value) return HOME;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

export function Browser({ payload }: { payload?: WindowPayload }) {
  const [stack, setStack] = useState<string[]>([payload?.url ? normalizeUrl(payload.url) : HOME]);
  const [index, setIndex] = useState(0);
  const [address, setAddress] = useState(stack[0]);
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const url = stack[index];

  function navigate(next: string) {
    const target = normalizeUrl(next);
    const nextStack = [...stack.slice(0, index + 1), target];
    setStack(nextStack);
    setIndex(nextStack.length - 1);
    setAddress(target);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    navigate(address);
  }

  function step(delta: number) {
    const next = Math.min(Math.max(index + delta, 0), stack.length - 1);
    setIndex(next);
    setAddress(stack[next]);
  }

  return (
    <div className="flex h-full flex-col bg-bg/50">
      <div className="flex items-center gap-1 border-b border-border bg-elevated/60 px-2 py-1.5">
        <Btn variant="ghost" className="px-2" aria-label="Zurück" disabled={index === 0} onClick={() => step(-1)}>
          <ArrowLeft className="size-4" />
        </Btn>
        <Btn variant="ghost" className="px-2" aria-label="Vor" disabled={index >= stack.length - 1} onClick={() => step(1)}>
          <ArrowRight className="size-4" />
        </Btn>
        <Btn variant="ghost" className="px-2" aria-label="Neu laden" onClick={() => setReloadKey((k) => k + 1)}>
          <RotateCw className="size-4" />
        </Btn>
        <Btn variant="ghost" className="px-2" aria-label="Startseite" onClick={() => navigate(HOME)}>
          <Home className="size-4" />
        </Btn>
        <form onSubmit={submit} className="min-w-0 flex-1">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="h-8 w-full rounded-full bg-bg px-3 text-[13px] outline-none"
            aria-label="Adresse"
          />
        </form>
        <Btn variant="ghost" className="px-2" aria-label="Im neuen Tab öffnen" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
          <ExternalLink className="size-4" />
        </Btn>
      </div>
      <iframe
        key={`${url}-${reloadKey}`}
        ref={frameRef}
        src={url}
        title="FurrBrowser"
        className="min-h-0 w-full flex-1 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
      <p className="border-t border-border px-3 py-1 text-[11px] text-subtle">
        Bleibt die Seite leer, erlaubt sie keine Einbettung – nutze „Im neuen Tab öffnen“.
      </p>
    </div>
  );
}
