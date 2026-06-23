"use client";

import { Bell, FileUp, Folder, Home, LogOut, MessageCircle, Send, Share, Shield, Smartphone, Users, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { listChatMessages, listFiles, listPresenceUsers, login, me, sendChatMessage, uploadFile } from "@/lib/api";
import { connectMobileSocket } from "@/lib/socket";
import type { FurrFile, PresenceUser } from "@/lib/types";
import { useMobileStore } from "@/store/mobile-store";

function roleLabel(roleName: string) {
  const role = roleName.toLowerCase();
  if (role.includes("dev")) return "Entwickler";
  if (role.includes("owner")) return "Owner";
  if (role.includes("moderator")) return "Moderator";
  if (role.includes("supporter")) return "Supporter";
  return "Member";
}

function roleClass(roleName: string) {
  const role = roleName.toLowerCase();
  if (role.includes("dev")) return "border-furrPink/50 bg-furrPink/15 text-pink-100";
  if (role.includes("owner")) return "border-amber-300/50 bg-amber-400/15 text-amber-100";
  if (role.includes("moderator")) return "border-furrViolet/50 bg-furrViolet/15 text-violet-100";
  if (role.includes("supporter")) return "border-furrCyan/50 bg-furrCyan/15 text-cyan-100";
  return "border-slate-500/40 bg-slate-700/20 text-slate-300";
}

function displayName(user: PresenceUser) {
  return user.nickname || user.discordUsername || user.displayName || user.username;
}

function fileName(file: FurrFile) {
  return file.displayName || file.originalName.split(/[\\/]/).pop() || file.originalName;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function LoginView() {
  const setSession = useMobileStore((state) => state.setSession);
  const [username, setUsername] = useState("Kitsulife");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const result = await login(username.trim(), password);
      setSession(result.token, result.user);
      connectMobileSocket(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mobile-grid-bg flex min-h-screen items-center justify-center px-4 py-8">
      <section className="w-full max-w-sm rounded-[28px] border border-furrCyan/20 bg-slate-950/78 p-5 shadow-panel backdrop-blur-2xl">
        <div className="mb-6">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-furrPink/35 bg-furrPink/10 text-furrPink shadow-neonPink">
            <Shield size={26} />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">FurrBox Mobile</h1>
          <p className="mt-1 text-sm text-slate-400">Sicherer Zugriff fuer Handy und Tablet.</p>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100/80">
            Nutzername
            <input className="h-12 rounded-2xl border border-furrCyan/20 bg-slate-900/80 px-4 text-sm text-white outline-none focus:border-furrCyan focus:shadow-neonCyan" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100/80">
            Passwort
            <input className="h-12 rounded-2xl border border-furrCyan/20 bg-slate-900/80 px-4 text-sm text-white outline-none focus:border-furrCyan focus:shadow-neonCyan" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
          </label>
          {error ? <p className="rounded-xl border border-furrPink/30 bg-furrPink/10 px-3 py-2 text-sm text-pink-100">{error}</p> : null}
          <button className="mt-2 h-12 rounded-2xl bg-gradient-to-r from-furrPink to-furrCyan text-sm font-black uppercase tracking-[0.12em] text-white shadow-neonPink disabled:opacity-50" disabled={busy} onClick={submit}>
            {busy ? "Verbinde..." : "Einloggen"}
          </button>
        </div>
      </section>
    </main>
  );
}

function isIosDevice() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function InstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = window.localStorage.getItem("furrbox-mobile-ios-install-dismissed") === "true";
    setVisible(isIosDevice() && !isStandaloneMode() && !dismissed);
  }, []);

  if (!visible) return null;

  return (
    <section className="mx-4 mt-4 rounded-[24px] border border-furrCyan/25 bg-slate-950/78 p-4 shadow-neonCyan backdrop-blur-2xl">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-furrCyan/30 bg-furrCyan/10 text-furrCyan">
          <Smartphone size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-white">Auf iPhone installieren</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            In Safari unten auf <Share className="inline align-[-2px] text-furrCyan" size={14} /> tippen und dann <span className="font-bold text-cyan-100">Zum Home-Bildschirm</span> waehlen.
          </p>
        </div>
        <button
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-white/5 hover:text-white"
          onClick={() => {
            window.localStorage.setItem("furrbox-mobile-ios-install-dismissed", "true");
            setVisible(false);
          }}
          aria-label="Installationshinweis schliessen"
        >
          <X size={15} />
        </button>
      </div>
    </section>
  );
}

function Header() {
  const { user, connected, logout } = useMobileStore();
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-white/5 bg-furrNight/86 px-4 pb-3 backdrop-blur-2xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-furrCyan">FurrBox Mobile</p>
          <h2 className="text-lg font-black text-white">{user?.displayName || user?.username}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`grid h-10 w-10 place-items-center rounded-2xl border ${connected ? "border-furrCyan/35 bg-furrCyan/10 text-furrCyan" : "border-furrPink/35 bg-furrPink/10 text-furrPink"}`}>
            {connected ? <Wifi size={19} /> : <WifiOff size={19} />}
          </span>
          <button className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-slate-900/60 text-slate-300" onClick={logout} aria-label="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

function HomeView() {
  const { files, presenceUsers, connected } = useMobileStore();
  const onlineTeam = presenceUsers.filter((user) => user.isExeOnline || user.isDiscordOnline).length;
  return (
    <div className="grid gap-4 p-4">
      <section className="rounded-[26px] border border-furrCyan/20 bg-slate-950/65 p-5 shadow-neonCyan backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-furrCyan">Secure Node</p>
            <h1 className="mt-2 text-3xl font-black text-white">{connected ? "Online" : "Reconnect"}</h1>
            <p className="mt-2 text-sm text-slate-400">Mobile Zugriff auf FurrFS, Chat und Teamstatus.</p>
          </div>
          <Bell className="text-furrPink" size={28} />
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <article className="rounded-3xl border border-white/5 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-500">Dateien</p>
          <p className="mt-1 text-2xl font-black text-white">{files.length}</p>
        </article>
        <article className="rounded-3xl border border-white/5 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-500">Team online</p>
          <p className="mt-1 text-2xl font-black text-furrCyan">{onlineTeam}</p>
        </article>
      </div>
    </div>
  );
}

function FilesView() {
  const { token, files, setFiles } = useMobileStore();
  const [scope, setScope] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);

  async function refresh(nextScope = scope) {
    if (!token) return;
    setFiles(await listFiles(token, nextScope));
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [scope]);

  async function handleUpload(fileList: FileList | null) {
    if (!token || !fileList?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(fileList)) await uploadFile(token, scope, file);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 p-4">
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/5 bg-slate-950/70 p-1">
        {(["private", "public"] as const).map((item) => (
          <button key={item} className={`h-10 rounded-xl text-sm font-black ${scope === item ? "bg-furrCyan/15 text-furrCyan shadow-neonCyan" : "text-slate-400"}`} onClick={() => setScope(item)}>
            {item === "private" ? "Privat" : "Public"}
          </button>
        ))}
      </div>
      <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-furrPink/40 bg-furrPink/10 text-sm font-black uppercase tracking-[0.12em] text-pink-100 shadow-neonPink">
        <FileUp size={18} />
        {busy ? "Upload..." : "Datei hochladen"}
        <input className="hidden" type="file" multiple onChange={(event) => handleUpload(event.target.files)} />
      </label>
      <div className="grid gap-2">
        {files.map((file) => (
          <article key={file.id} className="rounded-2xl border border-white/5 bg-slate-900/55 p-3">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-furrCyan/20 bg-furrCyan/10 text-furrCyan">
                <Folder size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{fileName(file)}</p>
                <p className="truncate text-xs text-slate-500">{file.virtualPath} · {formatSize(file.size)}</p>
              </div>
            </div>
          </article>
        ))}
        {!files.length ? <p className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 text-center text-sm text-slate-500">Keine Dateien gefunden.</p> : null}
      </div>
    </div>
  );
}

function ChatView() {
  const { token, user, chatMessages, setChatMessages, addChatMessage, presenceUsers } = useMobileStore();
  const [channel, setChannel] = useState<"team" | "private">("team");
  const [partnerId, setPartnerId] = useState("");
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const privateUsers = useMemo(() => presenceUsers.filter((entry) => !entry.id.startsWith("discord:") && entry.id !== user?.id), [presenceUsers, user?.id]);
  const activePartner = privateUsers.find((entry) => entry.id === partnerId) || privateUsers[0] || null;

  useEffect(() => {
    if (!token) return;
    if (channel === "private" && !activePartner?.id) {
      setChatMessages([]);
      return;
    }
    listChatMessages(token, channel, channel === "private" ? activePartner?.id : undefined).then(setChatMessages).catch(() => undefined);
  }, [activePartner?.id, channel, token, setChatMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chatMessages.length]);

  async function send() {
    if (!token || !draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    const message = await sendChatMessage(token, { channel, content, recipientId: channel === "private" ? activePartner?.id : undefined });
    addChatMessage(message);
  }

  return (
    <div className="flex h-[calc(100vh-148px)] flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-2">
        <button className={`h-10 rounded-2xl border text-sm font-black ${channel === "team" ? "border-furrCyan/40 bg-furrCyan/15 text-furrCyan" : "border-white/5 text-slate-400"}`} onClick={() => setChannel("team")}>
          Team
        </button>
        <button className={`h-10 rounded-2xl border text-sm font-black ${channel === "private" ? "border-furrPink/40 bg-furrPink/15 text-pink-100" : "border-white/5 text-slate-400"}`} onClick={() => setChannel("private")}>
          Privat
        </button>
      </div>
      {channel === "private" ? (
        <select className="h-11 rounded-2xl border border-furrViolet/30 bg-slate-950 px-3 text-sm text-white outline-none" value={activePartner?.id || ""} onChange={(event) => setPartnerId(event.target.value)}>
          {privateUsers.map((entry) => <option key={entry.id} value={entry.id}>{displayName(entry)} · {roleLabel(entry.roleName)}</option>)}
        </select>
      ) : null}
      <div ref={scrollRef} className="scroll-soft min-h-0 flex-1 space-y-2 overflow-auto rounded-3xl border border-white/5 bg-slate-950/50 p-3">
        {chatMessages.map((message) => {
          const own = message.senderId === user?.id;
          return (
            <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[84%] rounded-2xl border px-3 py-2 ${own ? "border-furrCyan/30 bg-furrCyan/10" : "border-furrViolet/30 bg-furrViolet/10"}`}>
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{own ? "Du" : message.senderName}</p>
                <p className="whitespace-pre-wrap break-words text-sm text-white">{message.content}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input className="h-12 min-w-0 flex-1 rounded-2xl border border-furrCyan/20 bg-slate-950/80 px-4 text-sm text-white outline-none focus:border-furrCyan" value={draft} placeholder="Nachricht..." onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} />
        <button className="grid h-12 w-12 place-items-center rounded-2xl border border-furrCyan/40 bg-furrCyan/10 text-furrCyan" onClick={send}>
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

function TeamView() {
  const users = useMobileStore((state) => state.presenceUsers);
  return (
    <div className="grid gap-2 p-4">
      {users.map((entry) => (
        <article key={entry.id} className="rounded-2xl border border-white/5 bg-slate-900/55 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-white">{displayName(entry)}</p>
              <p className="truncate text-xs text-slate-500">{entry.discordId || "Nicht verbunden"}</p>
            </div>
            <span className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${roleClass(entry.roleName)}`}>{roleLabel(entry.roleName)}</span>
          </div>
          <div className="mt-3 flex gap-2 text-[11px] font-black uppercase">
            <span className={entry.isExeOnline ? "text-furrCyan" : "text-slate-600"}>{entry.isExeOnline ? "● App" : "○ App"}</span>
            <span className={entry.isDiscordOnline ? "text-furrViolet" : "text-slate-600"}>{entry.isDiscordOnline ? "● Discord" : "○ Discord"}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function NavBar() {
  const tab = useMobileStore((state) => state.tab);
  const setTab = useMobileStore((state) => state.setTab);
  const items = [
    { id: "home" as const, label: "Home", icon: Home },
    { id: "files" as const, label: "Files", icon: Folder },
    { id: "chat" as const, label: "Chat", icon: MessageCircle },
    { id: "team" as const, label: "Team", icon: Users }
  ];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-furrNight/88 px-3 pt-2 backdrop-blur-2xl">
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button key={item.id} className={`grid justify-items-center gap-1 rounded-2xl py-2 text-[11px] font-black ${active ? "bg-furrCyan/12 text-furrCyan shadow-neonCyan" : "text-slate-500"}`} onClick={() => setTab(item.id)}>
              <Icon size={20} />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileShell() {
  const { token, user, tab, setSession, setFiles, setPresenceUsers } = useMobileStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) return;
    me(token)
      .then(({ user: nextUser }) => {
        setSession(token, nextUser);
        connectMobileSocket(token);
      })
      .catch(() => useMobileStore.getState().logout());
  }, [token, setSession]);

  useEffect(() => {
    if (!token) return;
    Promise.all([listFiles(token, "private"), listPresenceUsers(token, "team")])
      .then(([nextFiles, nextUsers]) => {
        setFiles(nextFiles);
        setPresenceUsers(nextUsers);
      })
      .catch(() => undefined);
  }, [token, setFiles, setPresenceUsers]);

  if (!hydrated) return <main className="mobile-grid-bg min-h-screen" />;
  if (!token || !user) return <LoginView />;

  return (
    <main className="mobile-grid-bg min-h-screen pb-24">
      <Header />
      <InstallHint />
      {tab === "home" ? <HomeView /> : null}
      {tab === "files" ? <FilesView /> : null}
      {tab === "chat" ? <ChatView /> : null}
      {tab === "team" ? <TeamView /> : null}
      <NavBar />
    </main>
  );
}
