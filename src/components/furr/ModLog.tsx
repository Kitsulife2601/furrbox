// Moderationslog / Audit-Viewer (read-only): jede Moderation (Discord + VRChat) mit Datum, Uhrzeit, Details.
// Zwei Ansichten: „Moderationen“ (listModerationLog: FurrBox + VRChat-Gruppen-Audit) und „Audit“ (gemeinsames
// Server-Audit furr_audit via listAuditLog: Duty, Votekick, Bann/Undo, Hinweise, Anhänge …).
import { useMemo, useState } from "react";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { listModerationLog, type ModLogEntry } from "@/lib/furr/api/modlog";
import { listAuditLog } from "@/lib/furr/api/audit-api";
import { errorMessage } from "@/lib/furr/client";
import { MOD_ACTION_LABEL } from "@/lib/furr/vrchat-location";
import { cn } from "@/lib/utils";
import { parseCaseRef } from "@/lib/furr/case-draft";
import { EVIDENCE_ROOT } from "@/lib/furr/paths";
import { useDesktop } from "@/store/desktop";
import { Badge, Btn, Empty, TextInput } from "./ui";

const PERIODS = [
  { days: 1, label: "Heute" },
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 365, label: "1 Jahr" },
];

/** Anzeige-Limit („letzte N“) – der Server liefert pro Quelle max. 500. */
const LIMITS = [50, 100, 250, 500];

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

function ModerationView() {
  const live10 = useLiveInterval(10_000);
  const [platform, setPlatform] = useState<"all" | "Discord" | "VRChat">("all");
  const [days, setDays] = useState(30);
  const [kinds, setKinds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [moderator, setModerator] = useState("");
  const [limit, setLimit] = useState(100);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const log = useQuery({
    queryKey: ["furr", "modlog", platform, days],
    queryFn: () => listModerationLog({ data: { platform, days } }),
    refetchInterval: live10,
  });

  const all = log.data ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of all) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [all]);
  const moderators = useMemo(() => [...new Set(all.map((e) => e.moderator))].sort((a, b) => a.localeCompare(b, "de")), [all]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (e) =>
        (!kinds.length || kinds.includes(e.kind)) &&
        (!moderator || e.moderator === moderator) &&
        (!q || `${e.id} ${e.moderator} ${e.target} ${e.targetId ?? ""} ${e.reason ?? ""} ${e.details ?? ""}`.toLowerCase().includes(q)),
    );
  }, [all, kinds, search, moderator]);
  const list = useMemo(() => matches.slice(0, limit), [matches, limit]);
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
        <select
          value={moderator}
          onChange={(e) => setModerator(e.target.value)}
          className="h-8 max-w-40 rounded-md border border-border bg-bg/60 px-2 text-[12px] text-fg outline-none"
          aria-label="Moderator"
        >
          <option value="">Alle Moderatoren</option>
          {moderators.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="h-8 rounded-md border border-border bg-bg/60 px-2 text-[12px] text-fg outline-none"
          aria-label="Anzahl"
        >
          {LIMITS.map((n) => (
            <option key={n} value={n}>
              Letzte {n}
            </option>
          ))}
        </select>
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, ID, Eintrags-ID oder Grund…" className="h-8 pl-8" />
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
        {(kinds.length > 0 || moderator) && (
          <button
            type="button"
            onClick={() => {
              setKinds([]);
              setModerator("");
            }}
            className="px-1 text-[12px] text-accent hover:underline"
          >
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
                      <td className="max-w-48 truncate px-3 py-2 font-medium">
                        {e.target}
                        {parseCaseRef(e.reason) && <span className="ml-1.5 rounded bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-300">Fall</span>}
                      </td>
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
        {selected && <Detail key={selected.id} entry={selected} onClose={() => setSelectedId(null)} />}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[11px] text-subtle">
        {list.length} von {matches.length} Treffern ({all.length} gesamt) · nur lesen · VRChat-Aktionen aus dem Spiel erscheinen nach wenigen Sekunden.
      </div>
    </div>
  );
}

export function ModLog() {
  const [view, setView] = useState<"moderation" | "audit">("moderation");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-bg/40 px-3 pt-2">
        {(
          [
            ["moderation", "Moderationen"],
            ["audit", "Audit (alle Events)"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2 text-[12px] font-medium transition-colors",
              view === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{view === "moderation" ? <ModerationView /> : <AuditView />}</div>
    </div>
  );
}

function Detail({ entry: e, onClose }: { entry: ModLogEntry; onClose: () => void }) {
  const { date, time } = formatDateTime(e.at);
  const openApp = useDesktop((s) => s.openApp);
  const caseId = parseCaseRef(e.reason);
  const [copied, setCopied] = useState(false);
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
        <div className="flex items-center gap-2 rounded-md bg-bg/60 px-2 py-1.5">
          <span className="text-muted">Eintrags-ID</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{e.id}</code>
          <button
            type="button"
            title="ID kopieren (z. B. als Audit-Bezug beim Clip-Anhängen)"
            onClick={() => void navigator.clipboard?.writeText(e.id).then(() => setCopied(true))}
            className="rounded p-1 text-muted hover:text-fg"
          >
            {copied ? <span className="text-[11px] text-emerald-300">kopiert</span> : <Copy className="size-3.5" />}
          </button>
        </div>
        {caseId ? (
          <button
            type="button"
            onClick={() => openApp("explorer", { payload: { scope: "public", folder: `${EVIDENCE_ROOT}/${e.platform}/${caseId}` } })}
            className="flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-left hover:bg-amber-500/20"
          >
            <FolderOpen className="size-3.5 text-amber-300" />
            <span className="min-w-0 flex-1 truncate">
              Fallakte öffnen · <span className="font-mono text-[11px]">{caseId}</span>
            </span>
          </button>
        ) : (
          <p className="text-[11px] text-subtle">Kein Fall-Bezug gespeichert (wird beim Bann über FurrBox als „[Fall: …]“ in der Begründung vermerkt).</p>
        )}
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

const AUDIT_SOURCES = ["discord", "vrchat", "furrbox", "desktop", "bot"] as const;

/** Gemeinsames Server-Audit (furr_audit via listAuditLog): alle Events inkl. Duty, Votekick, Bann-Undo, Hinweise. Nur lesen. */
export function AuditView() {
  const live = useLiveInterval(30_000);
  const openApp = useDesktop((s) => s.openApp);
  const [limit, setLimit] = useState(100);
  const [source, setSource] = useState<string>("");
  const [caseId, setCaseId] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const audit = useQuery({
    queryKey: ["furr", "audit", limit, source, caseId.trim()],
    queryFn: () => listAuditLog({ data: { limit, source: source || null, caseId: caseId.trim() || null } }),
    refetchInterval: live,
    retry: false,
  });
  const all = audit.data ?? [];
  const actors = useMemo(() => [...new Set(all.map((e) => e.actorName).filter((n): n is string => Boolean(n)))].sort(), [all]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (e) =>
        (!actor || e.actorName === actor) &&
        (!needle || `${e.id} ${e.action} ${e.targetName ?? ""} ${e.targetId ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [all, actor, q]);
  const selectCls = "h-8 rounded-md border border-border bg-bg/60 px-2 text-[12px] text-fg outline-none";

  return (
    <div className="flex h-full flex-col bg-bg/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={selectCls} aria-label="Anzahl">
          {LIMITS.map((n) => (
            <option key={n} value={n}>
              Letzte {n}
            </option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls} aria-label="Quelle">
          <option value="">Alle Quellen</option>
          {AUDIT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={actor} onChange={(e) => setActor(e.target.value)} className={cn(selectCls, "max-w-40")} aria-label="Nutzer">
          <option value="">Alle Nutzer</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <TextInput value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="Fall-ID" className="h-8 w-36 font-mono text-[11px]" />
        <div className="relative min-w-36 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Aktion, Ziel, Detail, ID…" className="h-8 pl-8" />
        </div>
        <Btn variant="ghost" onClick={() => void audit.refetch()} aria-label="Aktualisieren">
          <RefreshCw className={cn("size-3.5", audit.isFetching && "animate-spin")} />
        </Btn>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {audit.isError ? (
          <Empty>Audit-Log nicht erreichbar: {errorMessage(audit.error)}</Empty>
        ) : !audit.data ? (
          <Empty>Lade Audit-Log…</Empty>
        ) : !list.length ? (
          <Empty>Keine Audit-Einträge für diese Filter.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((e) => {
              const { date, time } = formatDateTime(e.at);
              const open = openId === e.id;
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => setOpenId(open ? null : e.id)} className={cn("grid w-full grid-cols-[86px_1fr] gap-3 px-3 py-2 text-left text-[12px] hover:bg-fg/5", open && "bg-accent/10")}>
                    <span>
                      <span className="block font-medium tabular-nums">{time}</span>
                      <span className="block text-subtle">{date}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="muted">{e.source}</Badge>
                        <span className="font-mono text-[11px] font-semibold">{e.action}</span>
                        {e.caseId && <span className="rounded bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-300">Fall</span>}
                      </span>
                      <span className="block truncate text-muted">
                        {e.actorName ?? "System"}
                        {e.targetName || e.targetId ? ` → ${e.targetName ?? e.targetId}` : ""}
                        {e.detail ? ` · ${e.detail}` : ""}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div className="furr-flyout-in grid gap-2 bg-bg/40 px-3 py-2 text-[12px]">
                      <p className="flex items-center gap-2">
                        <span className="text-muted">Audit-ID</span>
                        <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{e.id}</code>
                        <button type="button" title="ID kopieren" onClick={() => void navigator.clipboard?.writeText(e.id)} className="rounded p-1 text-muted hover:text-fg">
                          <Copy className="size-3.5" />
                        </button>
                      </p>
                      {e.detail && <p className="whitespace-pre-wrap rounded-md bg-bg/60 p-2">{e.detail}</p>}
                      {e.caseId && (
                        <div className="flex flex-wrap gap-1.5">
                          {(["VRChat", "Discord"] as const).map((pf) => (
                            <Btn key={pf} variant="ghost" onClick={() => openApp("explorer", { payload: { scope: "public", folder: `${EVIDENCE_ROOT}/${pf}/${e.caseId}` } })}>
                              <FolderOpen className="size-3.5" /> Fall {e.caseId} ({pf})
                            </Btn>
                          ))}
                          <Btn variant="ghost" onClick={() => setCaseId(e.caseId ?? "")}>
                            Alle Events zu diesem Fall
                          </Btn>
                        </div>
                      )}
                      {e.meta && <pre className="whitespace-pre-wrap break-words rounded-md bg-bg/60 p-2 font-mono text-[11px]">{JSON.stringify(e.meta, null, 2)}</pre>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-subtle">
        {list.length} von {all.length} Einträgen · gemeinsames Server-Audit (nur lesen)
      </div>
    </div>
  );
}
