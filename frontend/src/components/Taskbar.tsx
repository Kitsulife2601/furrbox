"use client";

import { Bell, CalendarDays, FileText, Files, FolderSearch, Gavel, Globe, Image, LogOut, MessageCircle, MonitorCog, Radar, Search, Settings, Terminal, UserPlus, Wifi, WifiOff, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { FurrChatPanel } from "@/components/FurrChatPanel";
import type { ChatMessage } from "@/lib/chat";
import { ENABLE_PRESENCE_TOOL } from "@/lib/config";
import { useFurrBoxStore, type FurrFile, type WindowKey } from "@/store/furrbox-store";
import { useWindowStore, type FurrWindowKind } from "@/store/useWindowStore";

const apps: { id: FurrWindowKind; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "furrfs", label: "FurrFS", icon: Files },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "settings", label: "Settings", icon: MonitorCog },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "evidence", label: "Evidence", icon: Gavel },
  ...(ENABLE_PRESENCE_TOOL ? [{ id: "presence" as const, label: "Presence", icon: Radar }] : [])
];

const developerDiscordId = "1312104318006071328";
const documentMimeHints = ["text/", "application/pdf", "application/json"];

function isDeveloperSession(user: { discordId?: string | null; sessionRole?: string; username?: string; displayName?: string } | null) {
  return Boolean(user && (user.discordId === developerDiscordId || user.sessionRole === "Super_Admin" || user.username === "Kitsulife" || user.displayName === "Kitsulife"));
}

type SearchHit = {
  id: string;
  label: string;
  detail: string;
  category: "Apps" | "Dokumente" | "Bilder" | "Systemeinstellungen";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  action: () => void;
};

function fileDisplayName(file: FurrFile) {
  return file.displayName || file.originalName || file.name;
}

function isImage(file: FurrFile) {
  return file.mimeType.startsWith("image/");
}

function isDocument(file: FurrFile) {
  return documentMimeHints.some((hint) => file.mimeType.startsWith(hint) || file.mimeType === hint);
}

function cleanChatRoleName(roleName: string) {
  const role = roleName.toLowerCase();
  if (role.includes("dev")) return "Entwickler";
  if (role.includes("owner")) return "Owner";
  if (role.includes("moderator")) return "Moderator";
  if (role.includes("supporter")) return "Supporter";
  return "Member";
}

function chatRoleBadgeClass(roleName: string) {
  const role = roleName.toLowerCase();
  if (role.includes("dev")) return "border-pink-400/50 bg-pink-500/15 text-pink-100";
  if (role.includes("owner")) return "border-amber-300/50 bg-amber-400/15 text-amber-100";
  if (role.includes("moderator")) return "border-violet-400/50 bg-violet-500/15 text-violet-100";
  if (role.includes("supporter")) return "border-cyan-300/50 bg-cyan-500/15 text-cyan-100";
  return "border-slate-500/35 bg-slate-700/20 text-slate-300";
}

export function Taskbar() {
  const { activeWindow, connected, files, socket, startOpen, user, logout, patchUi } = useFurrBoxStore();
  const windows = useWindowStore((state) => state.windows);
  const openWindow = useWindowStore((state) => state.openWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const createWindow = useWindowStore((state) => state.createWindow);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPreview, setChatPreview] = useState<ChatMessage | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatPreviewTimer = useRef<number | null>(null);
  const deferredSearch = useDeferredValue(searchQuery.trim().toLowerCase());
  const time = useMemo(() => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), []);
  const canManageAccounts = ENABLE_PRESENCE_TOOL && isDeveloperSession(user);
  const startMenuApps = useMemo(
    () => (canManageAccounts ? [...apps, { id: "accounts" as const, label: "Accounts", icon: UserPlus }] : apps),
    [canManageAccounts]
  );
  const dockApps = useMemo(() => {
    const accountsIsRunning = canManageAccounts && windows.accounts?.isOpen;
    const browserIsRunning = Object.values(windows).some((win) => win.kind === "browser" && win.isOpen);
    const presenceIsRunning = windows.presence?.isOpen;
    return [
      ...apps.filter((app) => {
        if (app.id === "browser") return browserIsRunning;
        if (app.id === "presence") return presenceIsRunning;
        return windows[app.id]?.isOpen;
      }),
      ...(accountsIsRunning ? [{ id: "accounts" as const, label: "Accounts", icon: UserPlus }] : [])
    ];
  }, [canManageAccounts, windows]);
  const viewerWindows = useMemo(
    () =>
      Object.values(windows)
        .filter((win) => win.kind === "viewer" && win.isOpen)
        .sort((a, b) => a.zIndex - b.zIndex),
    [windows]
  );

  function launch(id: FurrWindowKind) {
    if (id === "browser") {
      const existingBrowser = Object.values(useWindowStore.getState().windows)
        .filter((win) => win.kind === "browser")
        .sort((a, b) => b.zIndex - a.zIndex)[0];
      if (existingBrowser) openWindow(existingBrowser.id);
      else createWindow({ kind: "browser", title: "FurrBrowser", url: "https://example.com", x: 180, y: 90, width: 920, height: 640 });
      return;
    }
    if (windows[id]?.isMinimized) restoreWindow(id);
    else openWindow(id);
    patchUi({ activeWindow: id as WindowKey, startOpen: false });
  }

  function openViewer(file: FurrFile) {
    createWindow({
      kind: "viewer",
      title: fileDisplayName(file),
      url: file.url,
      x: 260,
      y: 110,
      width: isImage(file) ? 860 : 760,
      height: isImage(file) ? 600 : 560
    });
    setSearchOpen(false);
    setSearchQuery("");
    patchUi({ startOpen: false }, false);
  }

  const searchHits = useMemo<SearchHit[]>(() => {
    const appHits: SearchHit[] = startMenuApps.map((app) => ({
      id: `app-${app.id}`,
      label: app.label,
      detail: "App starten",
      category: "Apps",
      icon: app.icon,
      action: () => launch(app.id)
    }));

    const fileHits: SearchHit[] = files
      .filter((file) => isImage(file) || isDocument(file) || file.virtualPath?.toLowerCase().includes("moderation_beweise"))
      .slice(0, 80)
      .map((file) => ({
        id: `file-${file.id}`,
        label: fileDisplayName(file),
        detail: file.virtualPath || (file.scope === "public" ? "Public" : "Meine Dateien"),
        category: isImage(file) ? "Bilder" : "Dokumente",
        icon: isImage(file) ? Image : FileText,
        action: () => openViewer(file)
      }));

    const settingHits: SearchHit[] = [
      { id: "settings-display", label: "Anzeigeeinstellungen", detail: "FurrSettings öffnen", category: "Systemeinstellungen", icon: Settings, action: () => launch("settings") },
      { id: "settings-sync", label: "Secure Sync", detail: connected ? "Online" : "Reconnect", category: "Systemeinstellungen", icon: connected ? Wifi : WifiOff, action: () => setInfoOpen(true) },
      { id: "settings-task", label: "Info-Center", detail: "Benachrichtigungen und Schnellregler", category: "Systemeinstellungen", icon: Bell, action: () => setInfoOpen(true) }
    ];

    const allHits = [...appHits, ...fileHits, ...settingHits];
    if (!deferredSearch) return allHits.slice(0, 12);
    return allHits
      .filter((hit) => `${hit.label} ${hit.detail} ${hit.category}`.toLowerCase().includes(deferredSearch))
      .slice(0, 18);
  }, [connected, deferredSearch, files, startMenuApps]);

  const groupedHits = useMemo(
    () =>
      searchHits.reduce<Record<SearchHit["category"], SearchHit[]>>(
        (groups, hit) => {
          groups[hit.category].push(hit);
          return groups;
        },
        { Apps: [], Dokumente: [], Bilder: [], Systemeinstellungen: [] }
      ),
    [searchHits]
  );

  const recentFiles = useMemo(
    () =>
      [...files]
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
        .slice(0, 4),
    [files]
  );

  useEffect(() => {
    if (chatOpen) {
      setUnreadChatCount(0);
      setChatPreview(null);
      if (chatPreviewTimer.current) {
        window.clearTimeout(chatPreviewTimer.current);
        chatPreviewTimer.current = null;
      }
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!socket) return;
    const onChatMessage = (message: ChatMessage) => {
      if (message.senderId === user?.id || chatOpen) return;
      setChatPreview(message);
      setUnreadChatCount((count) => Math.min(99, count + 1));
      if (chatPreviewTimer.current) window.clearTimeout(chatPreviewTimer.current);
      chatPreviewTimer.current = window.setTimeout(() => {
        setChatPreview(null);
        chatPreviewTimer.current = null;
      }, 4_800);
    };
    socket.on("chat:message", onChatMessage);
    return () => {
      socket.off("chat:message", onChatMessage);
      if (chatPreviewTimer.current) {
        window.clearTimeout(chatPreviewTimer.current);
        chatPreviewTimer.current = null;
      }
    };
  }, [chatOpen, socket, user?.id]);

  function openChatFromPreview() {
    setChatOpen(true);
    setChatPreview(null);
    setUnreadChatCount(0);
    if (chatPreviewTimer.current) {
      window.clearTimeout(chatPreviewTimer.current);
      chatPreviewTimer.current = null;
    }
  }

  return (
    <>
      {startOpen && (
        <div className="absolute bottom-24 left-1/2 z-40 h-[460px] w-[560px] -translate-x-1/2 animate-task-pop rounded-[22px] border border-purple-500/25 bg-slate-950/70 p-5 shadow-[0_0_55px_rgba(139,92,246,0.34),0_0_22px_rgba(0,240,255,0.12)] backdrop-blur-2xl">
          <div className="mb-4 flex h-10 items-center gap-2 rounded-xl border border-cyan-300/15 bg-slate-900/70 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <Search size={17} className="text-[#00f0ff]" />
            <input className="w-full bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500" placeholder="Search apps, files, settings" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {startMenuApps.map((app) => {
              const Icon = app.icon;
              return (
                <button
                  key={app.id}
                  className="rounded-2xl border border-white/5 p-4 text-center transition hover:border-[#ff007f]/35 hover:bg-[#ff007f]/10 hover:shadow-[0_0_22px_rgba(255,0,127,0.22)]"
                  onClick={() => launch(app.id)}
                >
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-slate-900/80 text-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.22)]">
                    <Icon size={22} />
                  </span>
                  <span className="mt-2 block text-[12px] font-semibold text-slate-100">{app.label}</span>
                </button>
              );
            })}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-16 items-center justify-between rounded-b-[22px] border-t border-purple-500/20 bg-slate-900/55 px-5">
            <span className="text-[13px] font-semibold text-cyan-100">{user?.displayName || "Private local session"}</span>
            <button className="grid h-9 w-9 place-items-center rounded-xl text-slate-300 hover:bg-[#ff007f]/15 hover:text-pink-100" aria-label="Sign out" onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      )}

      {searchOpen ? (
        <div className="absolute bottom-24 left-[calc(50%-490px)] z-40 w-[430px] animate-task-pop overflow-hidden rounded-[20px] border border-cyan-300/25 bg-slate-950/80 shadow-[0_0_42px_rgba(0,240,255,0.2),0_0_28px_rgba(139,92,246,0.22)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-cyan-300/15 px-4 py-3">
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.18em] text-cyan-100">Deep Search</p>
              <p className="text-[11px] text-slate-500">Apps, Dokumente, Bilder und Systemeinstellungen</p>
            </div>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-pink-500/15 hover:text-pink-100" onClick={() => setSearchOpen(false)} aria-label="Suche schließen">
              <X size={15} />
            </button>
          </div>
          <div className="scroll-soft max-h-[420px] overflow-auto p-3">
            {(["Apps", "Dokumente", "Bilder", "Systemeinstellungen"] as const).map((category) =>
              groupedHits[category].length ? (
                <section key={category} className="mb-3 last:mb-0">
                  <h3 className="mb-1 px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{category}</h3>
                  <div className="grid gap-1">
                    {groupedHits[category].map((hit) => {
                      const Icon = hit.icon;
                      return (
                        <button
                          key={hit.id}
                          className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/45 px-3 py-2 text-left transition hover:border-cyan-300/35 hover:bg-cyan-500/10"
                          onClick={hit.action}
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-slate-950/70 text-[#00f0ff]">
                            <Icon size={17} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-slate-100">{hit.label}</span>
                            <span className="block truncate text-[11px] text-slate-500">{hit.detail}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null
            )}
            {!searchHits.length ? <div className="rounded-xl border border-white/5 bg-slate-900/45 p-4 text-[13px] text-slate-500">Keine Treffer gefunden.</div> : null}
          </div>
        </div>
      ) : null}

      {infoOpen ? (
        <div className="absolute bottom-24 right-[calc(50%-490px)] z-40 w-[380px] animate-task-pop overflow-hidden rounded-[22px] border border-purple-500/25 bg-slate-950/80 shadow-[0_0_48px_rgba(139,92,246,0.32),0_0_22px_rgba(0,240,255,0.14)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-purple-500/20 px-4 py-3">
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.18em] text-purple-100">Info-Center</p>
              <p className="text-[11px] text-slate-500">Benachrichtigungen und Schnellregler</p>
            </div>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-pink-500/15 hover:text-pink-100" onClick={() => setInfoOpen(false)} aria-label="Info-Center schließen">
              <X size={15} />
            </button>
          </div>
          <div className="grid gap-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              <button className={`rounded-xl border p-3 text-left ${connected ? "border-cyan-300/30 bg-cyan-500/10 text-cyan-100" : "border-pink-400/25 bg-pink-500/10 text-pink-100"}`}>
                {connected ? <Wifi size={18} /> : <WifiOff size={18} />}
                <span className="mt-2 block text-[12px] font-bold">{connected ? "Secure Sync" : "Reconnect"}</span>
                <span className="text-[10px] text-slate-500">{connected ? "Online" : "Nicht verbunden"}</span>
              </button>
              <button className="rounded-xl border border-purple-400/25 bg-purple-500/10 p-3 text-left text-purple-100" onClick={() => launch("settings")}>
                <Settings size={18} />
                <span className="mt-2 block text-[12px] font-bold">Settings</span>
                <span className="text-[10px] text-slate-500">Systempanel</span>
              </button>
            </div>
            <section className="rounded-xl border border-white/5 bg-slate-900/45 p-3">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-cyan-100">
                <Bell size={14} /> Status
              </div>
              <p className="text-[12px] text-slate-400">{connected ? "Alle FurrBox-Sync-Dienste sind verbunden." : "FurrBox versucht, den Sync-Server erneut zu erreichen."}</p>
            </section>
            <section className="rounded-xl border border-white/5 bg-slate-900/45 p-3">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-purple-100">
                <FolderSearch size={14} /> Letzte Dateien
              </div>
              {recentFiles.length ? (
                <div className="grid gap-1">
                  {recentFiles.map((file) => (
                    <button key={file.id} className="truncate rounded-lg px-2 py-1 text-left text-[12px] text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-100" onClick={() => openViewer(file)}>
                      {fileDisplayName(file)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-slate-500">Noch keine Dateien im Verlauf.</p>
              )}
            </section>
          </div>
        </div>
      ) : null}

      <FurrChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />

      {chatPreview ? (
        <button
          className="absolute bottom-24 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 animate-task-pop overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-950/88 p-4 text-left text-slate-100 shadow-[0_0_34px_rgba(0,240,255,0.26),0_18px_45px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition hover:border-pink-400/45 hover:bg-slate-950/95"
          onClick={openChatFromPreview}
          aria-label="Neue Chat-Nachricht öffnen"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-300/35 bg-cyan-400/10 text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.28)]">
              <MessageCircle size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="truncate text-[13px] font-black text-cyan-100">{chatPreview.senderName}</span>
                {chatPreview.senderRoleName ? (
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${chatRoleBadgeClass(chatPreview.senderRoleName)}`}>
                    {cleanChatRoleName(chatPreview.senderRoleName)}
                  </span>
                ) : null}
                <span className="shrink-0 rounded-md border border-purple-400/25 bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-purple-100">
                  {chatPreview.channel === "private" ? "Privat" : "Team"}
                </span>
              </span>
              <span className="mt-1 block line-clamp-2 text-[12px] leading-5 text-slate-300">{chatPreview.content}</span>
            </span>
          </div>
        </button>
      ) : null}

      <footer className="absolute bottom-3 left-1/2 z-50 flex h-16 w-[min(980px,calc(100vw-32px))] -translate-x-1/2 items-center justify-between rounded-2xl border border-purple-500/30 bg-slate-900/60 px-5 shadow-[0_0_30px_rgba(139,92,246,0.35),0_0_16px_rgba(0,240,255,0.12)] backdrop-blur-2xl" data-furr-context="taskbar">
        <div className="relative w-56">
          <div className={`flex h-10 items-center gap-2 rounded-xl border bg-slate-950/55 px-3 transition ${searchOpen ? "border-cyan-300/40 shadow-[0_0_18px_rgba(0,240,255,0.18)]" : "border-white/5"}`}>
            <Search size={16} className="text-[#00f0ff]" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="Suchen"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
            />
          </div>
        </div>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          <button
            className="grid h-11 w-11 place-items-center rounded-xl border border-cyan-300/25 bg-slate-950/70 text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.25)] transition hover:border-[#ff007f]/55 hover:text-[#ff007f] hover:shadow-[0_0_22px_rgba(255,0,127,0.35)]"
            aria-label="Start"
            onClick={() => patchUi({ startOpen: !startOpen })}
          >
            <span className="grid h-5 w-5 grid-cols-2 gap-0.5">
              <span className="rounded-[3px] bg-sky-500" />
              <span className="rounded-[3px] bg-sky-500" />
              <span className="rounded-[3px] bg-sky-500" />
              <span className="rounded-[3px] bg-sky-500" />
            </span>
          </button>
          {dockApps.map((app) => {
            const Icon = app.icon;
            const selected =
              app.id === "browser"
                ? Object.values(windows).some((win) => win.kind === "browser" && win.isOpen && !win.isMinimized)
                : windows[app.id]?.isOpen && !windows[app.id]?.isMinimized;
            return (
              <button
                key={app.id}
                className={`relative grid h-11 w-11 place-items-center rounded-xl border transition ${selected ? "border-[#ff007f]/55 bg-[#ff007f]/15 text-pink-100 shadow-[0_0_20px_rgba(255,0,127,0.34)] after:absolute after:-bottom-2 after:h-1 after:w-5 after:rounded-full after:bg-[#ff007f] after:shadow-[0_0_12px_rgba(255,0,127,0.95)]" : "border-white/5 text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-[#00f0ff]"}`}
                aria-label={app.label}
                onClick={() => launch(app.id)}
              >
                <Icon size={21} />
              </button>
            );
          })}
          {viewerWindows.map((win) => {
            const selected = !win.isMinimized;
            return (
              <button
                key={win.id}
                className={`relative grid h-11 w-11 place-items-center rounded-xl border transition ${selected ? "border-[#ff007f]/55 bg-[#ff007f]/15 text-pink-100 shadow-[0_0_20px_rgba(255,0,127,0.34)] after:absolute after:-bottom-2 after:h-1 after:w-5 after:rounded-full after:bg-[#ff007f] after:shadow-[0_0_12px_rgba(255,0,127,0.95)]" : "border-white/5 text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-[#00f0ff]"}`}
                aria-label={win.title}
                title={win.title}
                onClick={() => {
                  if (win.isMinimized) restoreWindow(win.id);
                  else openWindow(win.id);
                }}
              >
                <FileText size={20} />
              </button>
            );
          })}
          <button
            className={`relative grid h-11 w-11 place-items-center rounded-xl border transition ${chatOpen ? "border-cyan-300/55 bg-cyan-500/15 text-cyan-100 shadow-[0_0_20px_rgba(0,240,255,0.34)] after:absolute after:-bottom-2 after:h-1 after:w-5 after:rounded-full after:bg-[#00f0ff] after:shadow-[0_0_12px_rgba(0,240,255,0.95)]" : "border-white/5 text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-[#00f0ff]"}`}
            aria-label="FurrChat"
            title="FurrChat"
            onClick={() => {
              setChatOpen((open) => !open);
              setUnreadChatCount(0);
              setChatPreview(null);
            }}
          >
            <MessageCircle size={21} />
            {unreadChatCount > 0 && !chatOpen ? (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border border-slate-950 bg-[#ff007f] px-1 text-[10px] font-black leading-none text-white shadow-[0_0_14px_rgba(255,0,127,0.85)]">
                {unreadChatCount > 9 ? "9+" : unreadChatCount}
              </span>
            ) : null}
          </button>
        </div>

        <button className="flex w-48 items-center justify-end gap-3 rounded-xl px-2 py-1 text-slate-200 transition hover:bg-cyan-500/10" onClick={() => setInfoOpen((open) => !open)} aria-label="Info-Center öffnen">
          <div
            className={`grid h-9 w-9 place-items-center rounded-xl border bg-slate-950/55 transition ${
              connected
                ? "border-cyan-300/25 text-[#00f0ff] shadow-[0_0_14px_rgba(0,240,255,0.26)]"
                : "border-pink-400/25 text-[#ff007f] shadow-[0_0_14px_rgba(255,0,127,0.24)]"
            }`}
            title={connected ? "Secure sync online" : "Reconnecting"}
            aria-label={connected ? "Secure sync online" : "Reconnecting"}
          >
            {connected ? <Wifi size={17} className="drop-shadow-[0_0_7px_rgba(0,240,255,0.8)]" /> : <WifiOff size={17} className="drop-shadow-[0_0_7px_rgba(255,0,127,0.8)]" />}
          </div>
          <CalendarDays size={15} className="text-slate-400" />
          <div className="text-right text-[12px] font-semibold leading-tight">
            <div>{time}</div>
            <div>{new Date().toLocaleDateString()}</div>
          </div>
        </button>
      </footer>
    </>
  );
}
