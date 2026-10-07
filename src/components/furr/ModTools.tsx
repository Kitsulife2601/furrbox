// FurrEvidence → "Strafen" and "Watchlist": the lists the team needs every day.
//   Strafen:   who is muted / in timeout / banned right now, until when and why.
//   Watchlist: people the team keeps an eye on, with a note and the last sightings.
import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Gavel, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { liftSanction, listSanctions, type SanctionDto } from "@/lib/furr/api/sanctions";
import { addToWatchlist, listWatchlist, listWatchlistSightings, removeFromWatchlist, type WatchlistEntryDto } from "@/lib/furr/api/watchlist";
import { errorMessage, timeAgo } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/store/notifications";
import { Badge, Btn, Empty, ErrorText, Field, TextInput } from "./ui";

const TYPE_LABEL: Record<string, string> = { mute: "Stumm", timeout: "Timeout", ban: "Bann", warn: "Verwarnung" };
const TYPE_TONE: Record<string, "warn" | "bad" | "accent" | "muted"> = { mute: "accent", timeout: "warn", ban: "bad", warn: "muted" };
const USR = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateTime(at: string | null) {
  return at ? new Date(at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
}

/** "noch 3 Std. 20 Min." – null when there is no end. */
function remaining(expiresAt: string | null) {
  if (!expiresAt) return null;
  const min = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000);
  if (min <= 0) return "läuft gerade ab";
  if (min < 60) return `noch ${min} Min.`;
  if (min < 48 * 60) return `noch ${Math.floor(min / 60)} Std. ${min % 60} Min.`;
  return `noch ${Math.round(min / 1440)} Tage`;
}

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() =>
    useNotifications.getState().notify({ version: "FurrEvidence", title: "Kopiert", description: text }),
  );
}

// ---------- Strafen ----------

export function SanctionsPanel() {
  const queryClient = useQueryClient();
  const [showEnded, setShowEnded] = useState(false);
  const [platform, setPlatform] = useState<"all" | "discord" | "vrchat">("all");
  const [search, setSearch] = useState("");
  const [lifting, setLifting] = useState<SanctionDto | null>(null);

  const q = useQuery({
    queryKey: ["furr", "sanctions", showEnded],
    queryFn: () => listSanctions({ data: { includeInactive: showEnded } }),
    refetchInterval: 60_000,
  });
  const needle = search.trim().toLowerCase();
  const list = useMemo(
    () =>
      (q.data ?? []).filter(
        (s) =>
          (platform === "all" || s.platform === platform) &&
          (!needle || `${s.targetName ?? ""} ${s.targetId} ${s.reason} ${s.caseId ?? ""}`.toLowerCase().includes(needle)),
      ),
    [q.data, platform, needle],
  );
  const active = list.filter((s) => s.active);

  return (
    <div className="mx-auto grid w-full max-w-5xl content-start gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Gavel className="size-4 text-accent" /> Laufende Strafen
          </h2>
          <p className="text-[12px] text-muted">
            {active.length} {active.length === 1 ? "läuft" : "laufen"} gerade
            {showEnded ? ` · ${list.length - active.length} beendet` : ""}
          </p>
        </div>
        <div className="flex rounded-lg bg-bg/60 p-0.5 text-[12px]">
          {(
            [
              ["all", "Alle"],
              ["discord", "Discord"],
              ["vrchat", "VRChat"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPlatform(id)}
              className={cn("rounded-md px-2.5 py-1", platform === id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Grund, Fall" className="h-8 pl-8 text-[12px]" />
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} className="accent-[var(--color-accent)]" />
          Beendete zeigen
        </label>
        <button type="button" aria-label="Aktualisieren" onClick={() => void q.refetch()} className="rounded-md p-1.5 text-muted hover:bg-fg/8 hover:text-fg">
          <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} />
        </button>
      </div>

      {q.isError ? (
        <ErrorText>{errorMessage(q.error)}</ErrorText>
      ) : !q.data ? (
        <Empty>Lade Strafen…</Empty>
      ) : list.length === 0 ? (
        <Empty>{needle || platform !== "all" ? "Keine Strafe passt zur Suche." : "Gerade läuft keine Strafe."}</Empty>
      ) : (
        <div className="grid gap-2">
          {list.map((s) => (
            <div key={s.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border bg-elevated/40 p-3", !s.active && "opacity-60")}>
              <div className="flex w-24 shrink-0 flex-col items-start gap-1">
                <Badge tone={TYPE_TONE[s.type] ?? "muted"}>{TYPE_LABEL[s.type] ?? s.type}</Badge>
                <span className="text-[11px] text-subtle">{s.platform === "vrchat" ? "VRChat" : "Discord"}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{s.targetName || s.targetId}</p>
                <p className="line-clamp-2 text-[12px] text-muted">{s.reason}</p>
                <p className="mt-0.5 text-[11px] text-subtle">
                  seit {dateTime(s.createdAt)}
                  {s.caseId ? ` · Fall ${s.caseId.replace(/_\d{4}-.*$/, "")}` : ""}
                </p>
              </div>
              <div className="w-36 shrink-0 text-right text-[12px]">
                {s.active ? (
                  <>
                    <p className="font-medium">{remaining(s.expiresAt) ?? "ohne Ende"}</p>
                    <p className="text-[11px] text-subtle">{s.expiresAt ? `bis ${dateTime(s.expiresAt)}` : "bis jemand sie aufhebt"}</p>
                  </>
                ) : (
                  <p className="text-subtle">beendet</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => copy(s.targetId)} title="ID kopieren" className="rounded p-1.5 text-muted hover:bg-fg/8 hover:text-fg">
                  <Copy className="size-3.5" />
                </button>
                {s.active && s.type !== "warn" && (
                  <Btn variant="ghost" onClick={() => setLifting(s)}>
                    Aufheben
                  </Btn>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lifting && (
        <LiftDialog
          sanction={lifting}
          onClose={() => setLifting(null)}
          onDone={async () => {
            setLifting(null);
            await queryClient.invalidateQueries({ queryKey: ["furr", "sanctions"] });
          }}
        />
      )}
    </div>
  );
}

function LiftDialog({ sanction: s, onClose, onDone }: { sanction: SanctionDto; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await liftSanction({ data: { id: s.id, reason } });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" onMouseDown={onClose}>
      <form onSubmit={submit} onMouseDown={(e) => e.stopPropagation()} className="mica grid w-full max-w-md gap-3 rounded-xl p-4">
        <h3 className="text-[14px] font-semibold">
          {TYPE_LABEL[s.type] ?? s.type} von {s.targetName || s.targetId} aufheben?
        </h3>
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12px] text-amber-100">
          Das trägt die Strafe in FurrBox als beendet aus und schreibt es ins Protokoll. In {s.platform === "vrchat" ? "VRChat" : "Discord"} selbst
          musst du sie zusätzlich von Hand aufheben – FurrBox nimmt sie dort nicht automatisch zurück.
        </p>
        <Field label="Begründung (kommt ins Protokoll)">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Einsicht gezeigt, Verwechslung" autoFocus />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Abbrechen
          </Btn>
          <Btn type="submit" variant="primary" disabled={busy || reason.trim().length < 3}>
            {busy ? "Hebe auf…" : "Aufheben"}
          </Btn>
        </div>
      </form>
    </div>
  );
}

// ---------- Watchlist ----------

export function WatchlistPanel() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<WatchlistEntryDto | null>(null);

  const list = useQuery({ queryKey: ["furr", "watchlist"], queryFn: () => listWatchlist(), refetchInterval: 60_000 });
  const sightings = useQuery({
    queryKey: ["furr", "watchlist", "sightings", selected],
    queryFn: () => listWatchlistSightings({ data: { usrId: selected ?? undefined, limit: 40 } }),
    refetchInterval: 60_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["furr", "watchlist"] });
  const needle = search.trim().toLowerCase();
  const entries = (list.data ?? []).filter((e) => !needle || `${e.displayName ?? ""} ${e.usrId} ${e.note}`.toLowerCase().includes(needle));
  const nameOf = (usrId: string) => list.data?.find((e) => e.usrId === usrId)?.displayName ?? null;

  return (
    <div className="@container mx-auto grid w-full max-w-5xl content-start gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Eye className="size-4 text-accent" /> Watchlist
          </h2>
          <p className="text-[12px] text-muted">VRChat-Konten, auf die das Team ein Auge hat. Nur für das Team sichtbar.</p>
        </div>
        <div className="relative w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, ID, Notiz" className="h-8 pl-8 text-[12px]" />
        </div>
        <Btn variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Eintragen
        </Btn>
      </div>

      {adding && (
        <AddWatch
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}

      <div className="grid items-start gap-3 @3xl:grid-cols-[1.3fr_1fr]">
        <section className="grid gap-2">
          {list.isError ? (
            <ErrorText>{errorMessage(list.error)}</ErrorText>
          ) : !list.data ? (
            <Empty>Lade Watchlist…</Empty>
          ) : entries.length === 0 ? (
            <Empty>{needle ? "Niemand passt zur Suche." : "Die Watchlist ist leer."}</Empty>
          ) : (
            entries.map((e) => (
              <div
                key={e.usrId}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border bg-elevated/40 p-3",
                  selected === e.usrId ? "border-accent" : "border-border hover:border-fg/25",
                )}
                onClick={() => setSelected(selected === e.usrId ? null : e.usrId)}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] font-semibold">
                    <span className="truncate">{e.displayName || "Unbekannter Name"}</span>
                    {e.alarmJoin && <Badge tone="warn">Alarm beim Beitritt</Badge>}
                  </p>
                  <p className="truncate font-mono text-[10px] text-subtle">{e.usrId}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted">{e.note || "Keine Notiz."}</p>
                  <p className="mt-1 text-[11px] text-subtle">eingetragen {timeAgo(e.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-0.5" onClick={(ev) => ev.stopPropagation()}>
                  <button type="button" onClick={() => copy(e.usrId)} title="VRChat-ID kopieren" className="rounded p-1.5 text-muted hover:bg-fg/8 hover:text-fg">
                    <Copy className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => setRemoving(e)} title="Von der Watchlist nehmen" className="rounded p-1.5 text-muted hover:bg-danger/20 hover:text-fg">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="grid gap-2 rounded-lg border border-border bg-elevated/30 p-3">
          <h3 className="text-[13px] font-semibold">
            Zuletzt gesehen {selected ? `· ${nameOf(selected) ?? "ausgewählte Person"}` : "· alle"}
          </h3>
          {sightings.isError ? (
            <ErrorText>{errorMessage(sightings.error)}</ErrorText>
          ) : !sightings.data ? (
            <p className="text-[12px] text-muted">Lade…</p>
          ) : sightings.data.length === 0 ? (
            <p className="text-[12px] text-muted">
              Noch keine Sichtung. Eine Sichtung entsteht, wenn jemand aus dem Team mit der FurrBox-Desktop-App in derselben Instanz ist.
            </p>
          ) : (
            <div className="grid max-h-80 gap-1 overflow-auto">
              {sightings.data.map((s) => (
                <p key={s.id} className="text-[12px]">
                  <span className="tabular-nums text-subtle">{dateTime(s.seenAt)}</span>{" "}
                  <b className="font-medium">{s.displayName || nameOf(s.usrId) || s.usrId}</b>{" "}
                  <span className="text-muted">
                    {s.kind === "leave" ? "ist gegangen" : s.kind === "rejoin" ? "ist wieder da" : "ist gekommen"}
                    {s.world ? ` · ${s.world}` : ""}
                    {s.hopping ? " · springt rein und raus" : ""}
                  </span>
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      {removing && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" onMouseDown={() => setRemoving(null)}>
          <div onMouseDown={(e) => e.stopPropagation()} className="mica grid w-full max-w-sm gap-3 rounded-xl p-4">
            <h3 className="text-[14px] font-semibold">{removing.displayName || removing.usrId} von der Watchlist nehmen?</h3>
            <p className="text-[12px] text-muted">Die Notiz wird gelöscht. Das Entfernen steht im Protokoll.</p>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setRemoving(null)}>
                Abbrechen
              </Btn>
              <Btn
                variant="danger"
                onClick={async () => {
                  const usrId = removing.usrId;
                  setRemoving(null);
                  if (selected === usrId) setSelected(null);
                  await removeFromWatchlist({ data: usrId }).catch((err) =>
                    useNotifications.getState().notify({ version: "Watchlist", title: "Entfernen fehlgeschlagen", description: errorMessage(err) }),
                  );
                  await refresh();
                }}
              >
                Entfernen
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddWatch({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const [usrId, setUsrId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [alarm, setAlarm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // People paste the profile link as often as the id – take the id out of either.
  const id = /usr_[0-9a-f-]{36}/i.exec(usrId)?.[0] ?? usrId.trim();
  const valid = USR.test(id);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await addToWatchlist({ data: { usrId: id, displayName: name.trim() || undefined, note, alarmJoin: alarm } });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3 @container">
      <div className="grid gap-3 @xl:grid-cols-2">
        <Field label="VRChat-ID oder Profil-Link" hint="Beginnt mit usr_ – im Instanz-Tracker gibt es dafür den Kopieren-Knopf.">
          <TextInput value={usrId} onChange={(e) => setUsrId(e.target.value)} placeholder="usr_… oder https://vrchat.com/home/user/usr_…" className="font-mono text-[12px]" autoFocus />
        </Field>
        <Field label="Name (zum Wiedererkennen)">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Anzeigename in VRChat" />
        </Field>
      </div>
      <Field label="Notiz" hint="Warum steht die Person hier? Kurz und sachlich.">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="rounded-lg border border-border bg-bg/60 p-2.5 text-[13px] outline-none focus:border-accent"
        />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
        <input type="checkbox" checked={alarm} onChange={(e) => setAlarm(e.target.checked)} className="accent-[var(--color-accent)]" />
        Alarm, wenn die Person eine Instanz betritt, in der jemand aus dem Team ist
      </label>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>
          Abbrechen
        </Btn>
        <Btn type="submit" variant="primary" disabled={busy || !valid}>
          {busy ? "Speichere…" : "Auf die Watchlist"}
        </Btn>
      </div>
      {usrId.trim() && !valid && <p className="text-[11px] text-amber-300">Das sieht noch nicht wie eine VRChat-ID aus (usr_ und 36 Zeichen).</p>}
    </form>
  );
}
