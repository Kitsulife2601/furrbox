// FurrPresence: network monitor with team matrix / global registry, dual status and Discord logs.
import { useMemo, useState } from "react";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { useQuery } from "@tanstack/react-query";
import { listPresence, listPresenceLogs } from "@/lib/furr/api/presence";
import { getBridgeStatus } from "@/lib/furr/api/session";
import { errorMessage, timeAgo } from "@/lib/furr/client";
import type { PresenceUser } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { useSync } from "./useFurrSync";
import { Badge, Btn, Empty, TextInput } from "./ui";

export function dualLabel(u: Pick<PresenceUser, "isAppOnline" | "isDiscordOnline">) {
  if (u.isAppOnline && u.isDiscordOnline) return "Online (App & DC)";
  if (u.isAppOnline) return "Online (Nur App)";
  if (u.isDiscordOnline) return "Online (Nur Discord)";
  return "Offline";
}

function Dot({ on, className }: { on: boolean; className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full", on ? "bg-emerald-400" : "bg-fg/25", className)} />;
}

export function Presence() {
  const live5 = useLiveInterval(5_000);
  const live15 = useLiveInterval(15_000);
  const [view, setView] = useState<"team" | "global">("team");
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const connected = useSync((s) => s.connected);
  const users = useQuery({ queryKey: ["furr", "presence", view], queryFn: () => listPresence({ data: view }), refetchInterval: live5 });
  const bridge = useQuery({ queryKey: ["furr", "bridge"], queryFn: () => getBridgeStatus(), refetchInterval: live15 });

  const list = useMemo(
    () =>
      (users.data ?? []).filter((u) =>
        `${u.displayName} ${u.username} ${u.nickname ?? ""} ${u.discordId ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
      ),
    [users.data, filter],
  );
  const selected = list.find((u) => u.id === selectedId) ?? null;
  const appOnline = (users.data ?? []).filter((u) => u.isAppOnline).length;
  const dcOnline = (users.data ?? []).filter((u) => u.isDiscordOnline).length;

  return (
    <div className="flex h-full flex-col bg-bg/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
        <Btn variant={view === "team" ? "default" : "ghost"} onClick={() => setView("team")}>
          Team Matrix
        </Btn>
        <Btn variant={view === "global" ? "default" : "ghost"} onClick={() => setView("global")}>
          Global Registry
        </Btn>
        <TextInput placeholder="Suchen…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-40" />
        <div className="ml-auto flex flex-wrap items-center gap-3 text-muted">
          <span className="flex items-center gap-1.5">
            <Dot on={connected} /> FurrBox Sync
          </span>
          <span className="flex items-center gap-1.5">
            <Dot on={Boolean(bridge.data?.connected)} /> Discord Bot
            {bridge.data?.lastSeenAt ? ` (${timeAgo(bridge.data.lastSeenAt)})` : ""}
          </span>
          <span>
            App {appOnline} · DC {dcOnline} · Gesamt {users.data?.length ?? 0}
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {users.isError ? (
            <Empty>{errorMessage(users.error)}</Empty>
          ) : !users.data ? (
            <Empty>Lade Nodes…</Empty>
          ) : !list.length ? (
            <Empty>Keine Nutzer gefunden.</Empty>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Name / Nickname</th>
                  <th className="px-3 py-2 font-medium">Rolle</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Plattform</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Zuletzt</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    className={cn("cursor-pointer border-t border-border hover:bg-fg/5", selectedId === u.id && "bg-accent/15")}
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium">{u.nickname || u.displayName}</p>
                      <p className="text-muted">{u.hasAccount ? `@${u.username}` : "nur Discord"}</p>
                    </td>
                    <td className="px-3 py-2">{u.roleLabel}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Dot on={u.isAppOnline} /> APP
                        <Dot on={u.isDiscordOnline} className="ml-2" /> DC
                      </span>
                      <span className="text-muted">{dualLabel(u)}</span>
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">{u.platform ?? "—"}</td>
                    <td className="hidden px-3 py-2 text-muted md:table-cell">
                      {u.isAppOnline ? `seit ${timeAgo(u.connectedAt)}` : timeAgo(u.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {selected && <Detail user={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

function Detail({ user, onClose }: { user: PresenceUser; onClose: () => void }) {
  const logs = useQuery({
    queryKey: ["furr", "presence-logs", user.discordId],
    queryFn: () => listPresenceLogs({ data: user.discordId! }),
    enabled: Boolean(user.discordId),
  });
  return (
    <aside className="absolute inset-0 z-10 flex flex-col overflow-hidden border-l border-border bg-surface md:static md:w-80">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-[13px] font-semibold">{user.nickname || user.displayName}</p>
        <Btn variant="ghost" onClick={onClose}>
          Schließen
        </Btn>
      </div>
      <div className="grid gap-1 px-3 py-3 text-[12px]">
        <p>
          <span className="text-muted">Rolle:</span> {user.roleLabel}
        </p>
        <p>
          <span className="text-muted">Discord:</span> {user.discordUsername ?? "—"} ({user.discordId ?? "keine ID"}) ·{" "}
          {user.discordStatus}
        </p>
        <p>
          <span className="text-muted">App:</span> {user.isAppOnline ? `online auf ${user.platform}` : "offline"}
        </p>
        {user.email && (
          <p>
            <span className="text-muted">E-Mail:</span> {user.email}
          </p>
        )}
        <div className="mt-1">
          <Badge tone={user.isAppOnline || user.isDiscordOnline ? "good" : "muted"}>{dualLabel(user)}</Badge>
        </div>
      </div>
      <p className="border-t border-border px-3 pt-3 text-[12px] font-medium">Discord Reports</p>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {!user.discordId ? (
          <Empty>Keine Discord-ID hinterlegt.</Empty>
        ) : logs.isLoading ? (
          <Empty>Lade Reports…</Empty>
        ) : logs.isError ? (
          <Empty>{errorMessage(logs.error)}</Empty>
        ) : !logs.data?.length ? (
          <Empty>Keine Reports gefunden.</Empty>
        ) : (
          logs.data.map((log) => (
            <details key={log.id} className="mt-2 rounded-md bg-elevated/40 p-2 text-[12px]">
              <summary className="cursor-pointer">
                {log.name} <span className="text-muted">· {timeAgo(log.updatedAt)}</span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted">{log.content}</pre>
            </details>
          ))
        )}
      </div>
    </aside>
  );
}
