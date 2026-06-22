"use client";

import { ArrowLeft, ArrowRight, Copy, ExternalLink, Image as ImageIcon, RefreshCw, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { useWindowStore, type FurrWindowState } from "@/store/useWindowStore";

declare global {
  interface Window {
    furrboxClipboard?: {
      writeText: (text: string) => Promise<boolean>;
      writeImageFromUrl: (url: string) => Promise<boolean>;
    };
  }
}

type BrowserContext = {
  open: boolean;
  x: number;
  y: number;
  linkUrl?: string;
  imageUrl?: string;
  hasSelection: boolean;
};

type FurrBrowserProps = {
  windowState: FurrWindowState;
};

function absoluteUrl(url: string, base: string) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function FurrBrowser({ windowState }: FurrBrowserProps) {
  const createWindow = useWindowStore((state) => state.createWindow);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [context, setContext] = useState<BrowserContext>({ open: false, x: 0, y: 0, hasSelection: false });
  const currentUrl = windowState.url || "https://example.com";

  const menuItems = useMemo(() => {
    const items: { label: string; icon: React.ReactNode; divider?: boolean; action: () => void }[] = [];
    if (context.linkUrl) {
      items.push({
        label: "Link in neuem Tab öffnen",
        icon: <ExternalLink size={15} />,
        action: () => createWindow({ kind: "browser", title: "FurrBrowser", url: context.linkUrl, x: windowState.x + 36, y: windowState.y + 36, width: windowState.width, height: windowState.height })
      });
      items.push({ label: "Linkadresse kopieren", icon: <Copy size={15} />, action: () => window.furrboxClipboard?.writeText(context.linkUrl || "") ?? navigator.clipboard?.writeText(context.linkUrl || "") });
    }
    if (context.imageUrl) {
      items.push({
        label: "Bild kopieren",
        icon: <ImageIcon size={15} />,
        divider: Boolean(context.linkUrl),
        action: () => window.furrboxClipboard?.writeImageFromUrl(context.imageUrl || "")
      });
      items.push({ label: "Bildadresse kopieren", icon: <Copy size={15} />, action: () => window.furrboxClipboard?.writeText(context.imageUrl || "") ?? navigator.clipboard?.writeText(context.imageUrl || "") });
    }
    if (context.hasSelection) {
      items.push({ label: "Kopieren", icon: <Copy size={15} />, divider: items.length > 0, action: () => document.execCommand("copy") });
    }
    if (items.length === 0) items.push({ label: "Neu laden", icon: <RefreshCw size={15} />, action: () => iframeRef.current?.contentWindow?.location.reload() });
    return items;
  }, [context, createWindow, windowState]);

  function inspectContext(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const iframe = iframeRef.current;
    let linkUrl: string | undefined;
    let imageUrl: string | undefined;
    let hasSelection = false;

    try {
      const doc = iframe?.contentDocument;
      if (doc) {
        const rect = iframe.getBoundingClientRect();
        const target = doc.elementFromPoint(event.clientX - rect.left, event.clientY - rect.top);
        const link = target?.closest?.("a") as HTMLAnchorElement | null;
        const image = target?.closest?.("img") as HTMLImageElement | null;
        linkUrl = link?.href ? absoluteUrl(link.href, currentUrl) : undefined;
        imageUrl = image?.src ? absoluteUrl(image.src, currentUrl) : undefined;
        hasSelection = Boolean(doc.getSelection()?.toString());
      }
    } catch {
      linkUrl = currentUrl;
    }

    setContext({ open: true, x: event.clientX, y: event.clientY, linkUrl, imageUrl, hasSelection });
  }

  return (
    <FurrWindow
      windowState={windowState}
      icon={<Search size={15} />}
      titleBarContent={
        <div className="ml-3 flex h-8 min-w-[360px] items-center gap-2 rounded-lg bg-white/70 px-3 text-[12px] text-slate-600">
          <span className="truncate">{currentUrl}</span>
        </div>
      }
    >
      <div className="flex h-full flex-col bg-slate-50" onContextMenu={inspectContext} onClick={() => setContext((state) => ({ ...state, open: false }))}>
        <div className="flex h-11 items-center gap-2 border-b border-slate-200/70 bg-white/78 px-3">
          <button className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></button>
          <button className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100"><ArrowRight size={16} /></button>
          <button className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100" onClick={() => iframeRef.current?.contentWindow?.location.reload()}><RefreshCw size={16} /></button>
          <input
            className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none"
            value={currentUrl}
            onChange={(event) => updateWindow(windowState.id, { url: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") updateWindow(windowState.id, { url: event.currentTarget.value });
            }}
          />
        </div>
        <iframe ref={iframeRef} className="h-full w-full flex-1 bg-white" src={currentUrl} sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />

        {context.open ? (
          <div className="fixed z-[10000] w-[252px] rounded-xl border border-white/50 bg-white/90 p-1.5 text-[13px] shadow-[0_18px_60px_rgba(15,23,42,0.24)] backdrop-blur-2xl" style={{ left: context.x, top: context.y }}>
            {menuItems.map((item) => (
              <div key={item.label} className={item.divider ? "mt-1 border-t border-gray-200/50 pt-1" : ""}>
                <button className="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-slate-800 hover:bg-slate-100" onClick={item.action}>
                  {item.icon}
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </FurrWindow>
  );
}
