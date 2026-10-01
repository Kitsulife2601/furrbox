// Moderationslog: every moderation action (Discord + VRChat) with date, time and details.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Search, X } from "lucide-react";
import { listModerationLog, type ModLogEntry } from "@/lib/furr/api/modlog";
import { errorMessage } from "@/lib/furr/client";
import { MOD_ACTION_LABEL } from "@/lib/furr/vrchat-location";
import { cn } from "@/lib/utils";
import { Badge, Btn, Empty, TextInput } from "./ui";

const PERIODS = [
  { days: 1, label: "Heute" },
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 365, label: "1 Jahr" },
];

const KIND_ORDER = ["warn", "mute", "timeout", "kick", "remove", "ban", "unban"];

const KIND_STYLE: Record<string, string> = {
  warn: "bg-amber-500/20 text-amber-300",
  mute: "bg-violet-500/20 text-violet-300",
  timeout: "bg-sky-500/20 text-sky-300",
  kick: "bg-orange-500/20 text-orange-300",
  remove: "bg-orange-500/20 text-orange-300",
  ban: "bg-danger/25 text-red-300",
  unban: "bg-emerald-500/20 text-emerald-300",
};

function formatDateTime(at: string) {
  const d = new Date(at);
  return {
    date: d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }),
    time: d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function formatDuration(ms: number | null) {
  if (!ms) return null;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} Min.`;
  if (min < 1440) return `${Math.round(min / 60)} Std.`;
  return `${Math.round(min / 1440)} Tage`;
}

function KindBadge({ entry }: { entry: Pick<ModLogEntry, "kind" | "label"> }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", KIND_STYLE[entry.kind] ?? "bg-fg/10 text-muted")}>
      {entry.label}
    </span>
  );
}

function exportText(entries: ModLogEntry[]) {
  const lines = entries.map((e) => {
    const { date, time } = formatDateTime(e.at);
    return [
      "------------------------------------------------------------",
      `Datum/Uhrzeit: ${date} ${time}`,
      `Plattform: ${e.platform}${e.source === "VRChat" ? " (direkt in VRChat)" : " (über FurrBox)"}`,
      `Aktion: ${e.label}${formatDuration(e.durationMs) ? ` (${formatDuration(e.durationMs)})` : ""}`,
      `Moderator: ${e.moderator}`,
      `Ziel: ${e.target}${e.targetId ? ` (${e.targetId})` : ""}`,
      e.reason ? `Grund: ${e.reason}` : "",
      `Status: ${e.status === "success" ? "erfolgreich" : e.status === "failed" ? `fehlgeschlagen${e.error ? ` – ${e.error}` : ""}` : "wartet auf den Bot"}`,
      e.details ? `Details: ${e.details}` : "",
    ]
      .filter(Boolean)
      .join("\r\n");
  });
  const blob = new Blob([`FurrBox Moderationslog – exportiert am ${new Date().toLocaleString("de-DE")}\r\n${lines.join("\r\n")}\r\n`], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Moderationslog_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ModLog() {
  const [platform, setPlatform] = useState<"all" | "Discord" | "VRChat">("all");
  const [days, setDays] = useState(30);
  const [kinds, setKinds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const log = useQuery({
    queryKey: ["furr", "modlog", platform, days],
    queryFn: () => listModerationLog({ data: { platform, days } }),
    refetchInterval: 30_000,
  });

  const all = log.data ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of all) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [all]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (e) =>
        (!kinds.length || kinds.includes(e.kind)) &&
        (!q || `${e.moderator} ${e.target} ${e.targetId ?? ""} ${e.reason ?? ""} ${e.details ?? ""}`.toLowerCase().includes(q)),
    );
  }, [all, kinds, search]);
  const selected = list.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="@container flex h-full flex-col bg-bg/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex gap-1 rounded-lg bg-bg/60 p-1">
          {(["all", "Discord", "VRChat"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={cn(
                "h-7 rounded-md px-3 text-[12px] font-medium",
                platform === p ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              {p === "all" ? "Alle" : p}
            </button>
          ))}
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-8 rounded-md border border-border bg-bg/60 px-2 text-[12px] text-fg outline-none"
          aria-label="Zeitraum"
        >
          {PERIODS.map((p) => (
            <option key={p.days} value={p.days}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, ID oder Grund suchen…" className="h-8 pl-8" />
        </div>
        <Btn variant="ghost" onClick={() => void log.refetch()} aria-label="Aktualisieren">
          <RefreshCw className={cn("size-3.5", log.isFetching && "animate-spin")} />
        </Btn>
        <Btn variant="ghost" disabled={!list.length} onClick={() => exportText(list)}>
          <Download className="size-3.5" /> Export
        </Btn>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        {KIND_ORDER.filter((k) => counts[k]).map((k) => {
          const on = kinds.includes(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
                on ? "border-accent bg-accent/15 text-fg" : "border-border text-muted hover:text-fg",
              )}
            >
              {MOD_ACTION_LABEL[k]} <span className="tabular-nums text-subtle">{counts[k]}</span>
            </button>
          );
        })}
        {kinds.length > 0 && (
          <button type="button" onClick={() => setKinds([])} className="px-1 text-[12px] text-accent hover:underline">
            Filter zurücksetzen
          </button>
        )}
        {!Object.keys(counts).length && <span className="text-[12px] text-subtle">Keine Aktionen im gewählten Zeitraum.</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {log.isError ? (
            <Empty>{errorMessage(log.error)}</Empty>
          ) : !log.data ? (
            <Empty>Lade Moderationslog…</Empty>
          ) : !list.length ? (
            <Empty>Keine Einträge gefunden.</Empty>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Datum & Uhrzeit</th>
                  <th className="px-3 py-2 font-medium">Aktion</th>
                  <th className="px-3 py-2 font-medium">Ziel</th>
                  <th className="hidden px-3 py-2 font-medium @2xl:table-cell">Moderator</th>
                  <th className="hidden px-3 py-2 font-medium @3xl:table-cell">Grund</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const { date, time } = formatDateTime(e.at);
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setSelectedId(e.id)}
                      className={cn("cursor-pointer border-t border-border hover:bg-fg/5", selectedId === e.id && "bg-accent/10")}
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        <p className="font-medium tabular-nums">{time}</p>
                        <p className="text-subtle">{date}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <KindBadge entry={e} />
                          <Badge tone={e.platform === "VRChat" ? "accent" : "muted"}>{e.platform}</Badge>
                          {e.status === "failed" && <Badge tone="bad">fehlgeschlagen</Badge>}
                          {e.status === "pending" && <Badge tone="warn">wartet</Badge>}
                        </div>
                      </td>
                      <td className="max-w-48 truncate px-3 py-2 font-medium">{e.target}</td>
                      <td className="hidden max-w-40 truncate px-3 py-2 @2xl:table-cell">{e.moderator}</td>
                      <td className="hidden max-w-64 truncate px-3 py-2 text-muted @3xl:table-cell">
                        {e.reason ?? (e.source === "VRChat" ? "direkt in VRChat" : "–")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {selected && <Detail entry={selected} onClose={() => setSelectedId(null)} />}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[11px] text-subtle">
        {list.length} von {all.length} Einträgen · VRChat-Aktionen aus dem Spiel kommen über das Gruppen-Protokoll (Bot prüft alle 2 Minuten).
      </div>
    </div>
  );
}

function Detail({ entry: e, onClose }: { entry: ModLogEntry; onClose: () => void }) {
  const { date, time } = formatDateTime(e.at);
  const rows: [string, string | null][] = [
    ["Datum", date],
    ["Uhrzeit", time],
    ["Plattform", `${e.platform} · ${e.source === "VRChat" ? "direkt in VRChat" : "über FurrBox"}`],
    ["Moderator", e.moderator],
    ["Ziel", e.target],
    ["Ziel-ID", e.targetId],
    ["Dauer", formatDuration(e.durationMs)],
    ["Status", e.status === "success" ? "erfolgreich" : e.status === "failed" ? "fehlgeschlagen" : "wartet auf den Bot"],
    ["Fehler", e.error],
  ];
  return (
    <aside className="absolute inset-0 z-20 flex flex-col overflow-hidden border-l border-border bg-surface @3xl:static @3xl:w-80">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <KindBadge entry={e} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.target}</p>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:text-fg" aria-label="Schließen">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-3 overflow-auto p-3 text-[12px]">
        <dl className="grid grid-cols-[90px_1fr] gap-y-1.5">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className={cn("break-words", k === "Ziel-ID" && "font-mono text-[11px]")}>{v}</dd>
              </div>
            ))}
        </dl>
        {e.reason && (
          <div>
            <p className="text-muted">Grund</p>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-bg/60 p-2">{e.reason}</p>
          </div>
        )}
        {e.details && (
          <div>
            <p className="text-muted">Details aus VRChat</p>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-bg/60 p-2 font-mono text-[11px]">{e.details}</pre>
          </div>
        )}
      </div>
    </aside>
  );
}
