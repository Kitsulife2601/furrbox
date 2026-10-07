// FurrEvidence → Personen: search for someone and see everything about them on one page –
// cases, sanctions, what the team did on Discord and in VRChat, watchlist and sightings.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, Eye, FolderOpen, Gavel, Search, ShieldAlert, UserRound } from "lucide-react";
import { getPersonFile, searchPeople, type PersonFile as PersonFileData, type PersonRef } from "@/lib/furr/api/person";
import { errorMessage, timeAgo } from "@/lib/furr/client";
import { usePersonFile } from "@/lib/furr/person-file";
import { MOD_ACTION_LABEL, vrchatAuditKind } from "@/lib/furr/vrchat-location";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { Badge, Btn, Empty, ErrorText, TextInput } from "./ui";

const STATUS: Record<string, { label: string; tone: "warn" | "accent" | "muted" | "good" }> = {
  open: { label: "Offen", tone: "warn" },
  working: { label: "In Arbeit", tone: "accent" },
  waiting: { label: "Wartet", tone: "muted" },
  done: { label: "Erledigt", tone: "good" },
};
const SANCTION_TONE: Record<string, "warn" | "bad" | "accent" | "muted"> = { mute: "accent", timeout: "warn", ban: "bad", warn: "muted" };
const FLAG_LABEL: Record<string, string> = {
  vote_abuse: "Votekick-Missbrauch",
  repeat_report: "Mehrfach gemeldet",
  rejoin_hopping: "Wechselt schnell die Instanz",
  other: "Auffällig",
};

function dateTime(at: string) {
  return at ? new Date(at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => useNotifications.getState().notify({ version: "FurrEvidence", title: "Kopiert", description: text }),
    () => undefined,
  );
}

function eventLabel(kind: string) {
  if (kind === "sighting") return "Sichtung";
  return MOD_ACTION_LABEL[kind] ?? MOD_ACTION_LABEL[vrchatAuditKind(kind) ?? ""] ?? kind;
}

export function PersonPanel() {
  const target = usePersonFile((s) => s.target);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  // Search only after a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);
  const hits = useQuery({ queryKey: ["furr", "people", q], queryFn: () => searchPeople({ data: { q } }), enabled: q.length >= 2 && !target, staleTime: 30_000 });

  if (target) return <FileView person={target} onBack={() => usePersonFile.getState().close()} />;

  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <UserRound className="size-4 text-accent" /> Personenakte
        </h2>
        <p className="text-[12px] text-muted">Alles zu einer Person auf einer Seite: Fälle, Strafen, Moderation und Watchlist.</p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <TextInput autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Name, Discord-ID oder usr_…" className="h-10 pl-9" />
      </div>
      {q.length < 2 ? (
        <Empty>Tippe mindestens 2 Zeichen ein.</Empty>
      ) : hits.isError ? (
        <ErrorText>{errorMessage(hits.error)}</ErrorText>
      ) : !hits.data ? (
        <Empty>Suche…</Empty>
      ) : hits.data.length === 0 ? (
        <Empty>Niemand gefunden. Zu dieser Person gibt es noch keinen Eintrag.</Empty>
      ) : (
        <div className="grid gap-1.5">
          {hits.data.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => usePersonFile.getState().open(h)}
              className="flex items-center gap-3 rounded-lg border border-border bg-elevated/40 px-3 py-2 text-left hover:border-accent/60 hover:bg-elevated/70"
            >
              <UserRound className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{h.name}</span>
                <span className="block truncate text-[11px] text-subtle">{h.hint}</span>
              </span>
              <span className="shrink-0 text-[11px] text-subtle">{h.usrId ? "VRChat" : h.discordId ? "Discord" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FileView({ person, onBack }: { person: PersonRef; onBack: () => void }) {
  const openApp = useDesktop((s) => s.openApp);
  const file = useQuery({
    queryKey: ["furr", "person-file", person.name, person.discordId, person.usrId],
    queryFn: () => getPersonFile({ data: { name: person.name, discordId: person.discordId, usrId: person.usrId } }),
    refetchInterval: 60_000,
  });
  const data: PersonFileData | undefined = file.data;
  const usrId = data?.person.usrId ?? person.usrId;
  const active = data?.sanctions.filter((s) => s.active) ?? [];
  const openCases = data?.cases.filter((c) => c.status !== "done").length ?? 0;
  const empty = data && !data.cases.length && !data.sanctions.length && !data.events.length && !data.watch && !data.flags.length;

  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-4 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Btn variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> Zurück
        </Btn>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold">{person.name || person.discordId || person.usrId}</h2>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-subtle">
            {person.discordId && (
              <button type="button" onClick={() => copy(person.discordId!)} className="flex items-center gap-1 hover:text-fg" title="Discord-ID kopieren">
                <Copy className="size-3" /> Discord {person.discordId}
              </button>
            )}
            {usrId && (
              <button type="button" onClick={() => copy(usrId)} className="flex items-center gap-1 hover:text-fg" title="VRChat-ID kopieren">
                <Copy className="size-3" /> {usrId}
              </button>
            )}
          </div>
        </div>
      </div>

      {file.isError ? (
        <ErrorText>{errorMessage(file.error)}</ErrorText>
      ) : !data ? (
        <Empty>Lade Akte…</Empty>
      ) : empty ? (
        <Empty>Zu dieser Person ist noch nichts eingetragen.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {active.length > 0 ? (
              active.map((s) => (
                <Badge key={s.id} tone={SANCTION_TONE[s.type] ?? "warn"}>
                  Aktiv: {MOD_ACTION_LABEL[s.type] ?? s.type} ({s.platform === "vrchat" ? "VRChat" : "Discord"})
                </Badge>
              ))
            ) : (
              <Badge tone="good">Keine laufende Strafe</Badge>
            )}
            <Badge tone={openCases ? "warn" : "muted"}>
              {data.cases.length} {data.cases.length === 1 ? "Fall" : "Fälle"}
              {openCases ? ` · ${openCases} offen` : ""}
            </Badge>
            <Badge tone="muted">
              {data.sanctions.length} {data.sanctions.length === 1 ? "Strafe" : "Strafen"} insgesamt
            </Badge>
            {data.watch && <Badge tone="accent">Auf der Watchlist</Badge>}
          </div>

          {(data.watch || data.flags.length > 0) && (
            <div className="grid gap-2 rounded-lg border border-accent/40 bg-accent/8 p-3 text-[12px]">
              {data.watch && (
                <p className="flex gap-2">
                  <Eye className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span>
                    <span className="font-semibold">Watchlist</span> seit {dateTime(data.watch.addedAt)}
                    {data.watch.note ? <span className="block whitespace-pre-wrap text-muted">{data.watch.note}</span> : null}
                  </span>
                </p>
              )}
              {data.flags.map((f, i) => (
                <p key={i} className="flex gap-2">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                  <span>
                    <span className="font-semibold">{FLAG_LABEL[f.kind] ?? f.kind}</span>
                    {f.score > 1 ? ` (${f.score}×)` : ""}
                    {f.detail ? <span className="block text-muted">{f.detail}</span> : null}
                  </span>
                </p>
              ))}
            </div>
          )}

          <Section title="Fälle" count={data.cases.length} empty="Kein Fall zu dieser Person.">
            {data.cases.map((c) => (
              <div key={c.path} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2">
                <Badge tone={STATUS[c.status]?.tone ?? "muted"}>{STATUS[c.status]?.label ?? c.status}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">
                    {c.platform} · {dateTime(c.createdAt)}
                    {c.assigneeName ? ` · zuständig: ${c.assigneeName}` : ""}
                  </p>
                  {c.note && <p className="line-clamp-2 text-[12px] text-muted">{c.note}</p>}
                </div>
                <Btn variant="ghost" onClick={() => openApp("explorer", { payload: { scope: "public", folder: c.path } })}>
                  <FolderOpen className="size-3.5" /> Öffnen
                </Btn>
              </div>
            ))}
          </Section>

          <Section title="Strafen" count={data.sanctions.length} empty="Keine Strafe eingetragen.">
            {data.sanctions.map((s) => (
              <div key={s.id} className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2", !s.active && "opacity-70")}>
                <Gavel className="size-3.5 shrink-0 text-muted" />
                <Badge tone={SANCTION_TONE[s.type] ?? "muted"}>{MOD_ACTION_LABEL[s.type] ?? s.type}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12px]">{s.reason}</p>
                  <p className="text-[11px] text-subtle">
                    {s.platform === "vrchat" ? "VRChat" : "Discord"} · {dateTime(s.createdAt)}
                    {s.active ? (s.expiresAt ? ` · läuft bis ${dateTime(s.expiresAt)}` : " · ohne Ende") : " · beendet"}
                  </p>
                </div>
              </div>
            ))}
          </Section>

          <Section title="Verlauf" count={data.events.length} empty="Noch nichts passiert.">
            {data.events.map((e) => (
              <div key={e.id} className="flex gap-3 rounded-lg px-3 py-1.5 text-[12px] odd:bg-elevated/30">
                <span className="w-28 shrink-0 text-subtle" title={dateTime(e.at)}>
                  {timeAgo(e.at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("font-semibold", e.failed && "text-subtle line-through")}>{eventLabel(e.kind)}</span>
                  <span className="text-subtle">
                    {" "}
                    · {e.platform}
                    {e.by ? ` · von ${e.by}` : ""}
                    {e.failed ? " · fehlgeschlagen" : ""}
                  </span>
                  {e.text && <span className="block text-muted">{e.text}</span>}
                </span>
              </div>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
        {title} <span className="tabular-nums text-subtle">{count}</span>
      </h3>
      {count === 0 ? <p className="px-1 text-[12px] text-subtle">{empty}</p> : children}
    </section>
  );
}
