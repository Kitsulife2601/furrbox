// FurrEvidence → Fallakten: every case with its state ("Offen", "In Arbeit", "Wartet", "Erledigt"),
// who takes care of it and a short note – so nothing is left lying around.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Paperclip, Search, StickyNote, UserCheck, UserRound } from "lucide-react";
import { listEvidenceCases, updateEvidenceCase } from "@/lib/furr/api/evidence";
import { listPresence } from "@/lib/furr/api/presence";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { usePersonFile } from "@/lib/furr/person-file";
import type { CaseStatus, EvidenceCase } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { AttachClipDialog } from "./AttachClipDialog";
import { Btn, Empty, PromptDialog, TextInput } from "./ui";

const CASE_STATUS: { id: CaseStatus; label: string; className: string }[] = [
  { id: "open", label: "Offen", className: "bg-amber-500/20 text-amber-300" },
  { id: "working", label: "In Arbeit", className: "bg-sky-500/20 text-sky-300" },
  { id: "waiting", label: "Wartet", className: "bg-violet-500/20 text-violet-300" },
  { id: "done", label: "Erledigt", className: "bg-emerald-500/20 text-emerald-300" },
];

type Filter = "todo" | "mine" | "done" | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "todo", label: "Zu tun" },
  { id: "mine", label: "Meine" },
  { id: "done", label: "Erledigt" },
  { id: "all", label: "Alle" },
];

/** Case folders end in a timestamp ("Name_2026-10-02T…") – show only the name. */
const title = (caseId: string) => caseId.replace(/_\d{4}-.*$/, "");

export function CaseList() {
  const live15 = useLiveInterval(15_000);
  const queryClient = useQueryClient();
  const me = useMe();
  const openApp = useDesktop((s) => s.openApp);
  const cases = useQuery({ queryKey: ["furr", "evidence-cases"], queryFn: () => listEvidenceCases(), refetchInterval: live15 });
  const team = useQuery({ queryKey: ["furr", "presence", "team"], queryFn: () => listPresence({ data: "team" }), staleTime: 60_000 });
  const [filter, setFilter] = useState<Filter>("todo");
  const [search, setSearch] = useState("");
  const [attaching, setAttaching] = useState<EvidenceCase | null>(null);
  const [noting, setNoting] = useState<EvidenceCase | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const myId = me.data?.userId ?? null;
  const people = (team.data ?? []).filter((u) => u.hasAccount);
  const all = useMemo(() => cases.data ?? [], [cases.data]);
  const counts = useMemo(
    () => ({
      todo: all.filter((c) => c.status !== "done").length,
      mine: all.filter((c) => c.status !== "done" && c.assigneeId === myId).length,
      done: all.filter((c) => c.status === "done").length,
      all: all.length,
    }),
    [all, myId],
  );
  const needle = search.trim().toLowerCase();
  const shown = all.filter(
    (c) =>
      (filter === "all" || (filter === "done" ? c.status === "done" : c.status !== "done" && (filter === "todo" || c.assigneeId === myId))) &&
      (!needle || `${c.caseId} ${c.platform} ${c.assigneeName ?? ""} ${c.note ?? ""}`.toLowerCase().includes(needle)),
  );

  async function change(c: EvidenceCase, patch: { status?: CaseStatus; assigneeId?: string | null; note?: string }) {
    setBusy(c.path);
    try {
      await updateEvidenceCase({ data: { path: c.path, ...patch } });
      await queryClient.invalidateQueries({ queryKey: ["furr", "evidence-cases"] });
    } catch (e) {
      useNotifications.getState().notify({ version: "FurrEvidence", title: "Nicht gespeichert", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  if (cases.isError) return <Empty>{errorMessage(cases.error)}</Empty>;
  if (!cases.data) return <Empty>Lade Fallakten…</Empty>;
  if (!all.length) return <Empty>Noch keine Fälle gespeichert.</Empty>;

  return (
    <div className="relative min-h-full">
      {attaching && <AttachClipDialog target={attaching} onClose={() => setAttaching(null)} />}
      {noting && (
        <PromptDialog
          title={`Notiz zu „${title(noting.caseId)}“`}
          initial={noting.note ?? ""}
          confirmLabel="Speichern"
          onSubmit={(value) => {
            const target = noting;
            setNoting(null);
            void change(target, { note: value });
          }}
          onCancel={() => setNoting(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex rounded-lg bg-bg/60 p-0.5 text-[12px]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn("rounded-md px-2.5 py-1", filter === f.id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-52">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Fall, Person, Notiz" className="h-8 pl-8 text-[12px]" />
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty>
          {needle
            ? "Kein Fall passt zur Suche."
            : filter === "mine"
              ? "Du hast gerade keinen offenen Fall."
              : filter === "todo"
                ? "Alles erledigt – kein offener Fall."
                : "Hier ist noch nichts."}
        </Empty>
      ) : (
        <div className="grid gap-2 p-3">
          {shown.map((c) => {
            const status = CASE_STATUS.find((s) => s.id === c.status) ?? CASE_STATUS[0];
            const mine = c.assigneeId === myId;
            return (
              <div
                key={c.path}
                className={cn("grid gap-2 rounded-lg border border-border bg-elevated/40 p-3", busy === c.path && "opacity-60", c.status === "done" && "opacity-75")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.className)}>{status.label}</span>
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={c.caseId}>
                    {title(c.caseId)}
                  </p>
                  <span className="text-[11px] text-subtle">
                    {c.platform} · {c.fileCount} {c.fileCount === 1 ? "Datei" : "Dateien"} · {timeAgo(c.createdAt)}
                  </span>
                </div>

                {c.note && <p className="whitespace-pre-wrap rounded-md bg-bg/50 px-2.5 py-1.5 text-[12px] text-muted">{c.note}</p>}

                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <label className="flex items-center gap-1.5 text-muted">
                    Status
                    <select
                      value={c.status}
                      disabled={busy === c.path}
                      onChange={(e) => void change(c, { status: e.target.value as CaseStatus })}
                      className="h-8 rounded-md border border-border bg-bg/60 px-2 text-fg outline-none focus:border-accent"
                    >
                      {CASE_STATUS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-muted">
                    Zuständig
                    <select
                      value={c.assigneeId ?? ""}
                      disabled={busy === c.path}
                      onChange={(e) => void change(c, { assigneeId: e.target.value || null })}
                      className={cn("h-8 max-w-44 rounded-md border bg-bg/60 px-2 text-fg outline-none focus:border-accent", mine ? "border-accent/60" : "border-border")}
                    >
                      <option value="">niemand</option>
                      {/* Keep the current person selectable even if they are no longer in the team list. */}
                      {c.assigneeId && !people.some((u) => u.id === c.assigneeId) && <option value={c.assigneeId}>{c.assigneeName}</option>}
                      {people.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.id === myId ? `${u.displayName} (du)` : u.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!mine && c.status !== "done" && (
                    <Btn variant="ghost" disabled={busy === c.path} onClick={() => void change(c, { assigneeId: "me", status: c.status === "open" ? "working" : c.status })}>
                      <UserCheck className="size-3.5" /> Ich übernehme
                    </Btn>
                  )}
                  <div className="ml-auto flex gap-1">
                    <Btn
                      variant="ghost"
                      onClick={() => usePersonFile.getState().open({ name: c.targetName ?? title(c.caseId).replace(/_/g, " "), discordId: null, usrId: null })}
                      title="Alles zu dieser Person zeigen"
                    >
                      <UserRound className="size-3.5" /> Akte
                    </Btn>
                    <Btn variant="ghost" onClick={() => setNoting(c)} title="Kurze Notiz für das Team">
                      <StickyNote className="size-3.5" /> {c.note ? "Notiz ändern" : "Notiz"}
                    </Btn>
                    <Btn variant="ghost" onClick={() => setAttaching(c)} title="Clip oder Datei an diesen Fall hängen (mit Audit-Bezug)">
                      <Paperclip className="size-3.5" /> Clip anhängen
                    </Btn>
                    <Btn variant="ghost" onClick={() => openApp("explorer", { payload: { scope: "public", folder: c.path } })}>
                      <FolderOpen className="size-3.5" /> Öffnen
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
