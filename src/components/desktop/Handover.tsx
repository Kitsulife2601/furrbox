// Übergabe-Notiz: a short note at the end of a duty ("what is still open?") and the notes of the
// others when a duty starts. Opened by useDuty and from the staff flyout.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { Btn, ErrorText } from "@/components/furr/ui";
import { listHandovers, saveHandover } from "@/lib/furr/api/duty";
import { listEvidenceCases } from "@/lib/furr/api/evidence";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { useHandover } from "@/lib/furr/handover";
import { useNotifications } from "@/store/notifications";

const KEY = ["furr", "duty", "handover"] as const;
/** Notes older than this are no longer shown when a duty starts. */
const FRESH_MS = 3 * 24 * 3600_000;
const MAX = 1000;

export function HandoverDialogs() {
  const mode = useHandover((s) => s.mode);
  if (mode === "write") return <WriteDialog />;
  if (mode === "read" || mode === "all") return <ReadDialog all={mode === "all"} />;
  return null;
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="grid max-h-[80vh] w-full max-w-md gap-3 overflow-auto rounded-xl border border-border bg-surface p-4 text-fg shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <ClipboardList className="size-4 text-accent" /> {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function WriteDialog() {
  const close = useHandover((s) => s.close);
  const queryClient = useQueryClient();
  const me = useMe();
  const cases = useQuery({ queryKey: ["furr", "evidence-cases"], queryFn: () => listEvidenceCases(), staleTime: 30_000 });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = useMemo(
    () => (cases.data ?? []).filter((c) => c.status !== "done" && c.assigneeId === me.data?.userId),
    [cases.data, me.data?.userId],
  );

  function addCases() {
    const lines = mine.map((c) => `- ${c.caseId.replace(/_\d{4}-.*$/, "").replace(/_/g, " ")}${c.note ? `: ${c.note}` : ""}`);
    setText((t) => `${t.trim() ? `${t.trim()}\n` : ""}Meine offenen Fälle:\n${lines.join("\n")}`.slice(0, MAX));
  }

  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveHandover({ data: text });
      await queryClient.invalidateQueries({ queryKey: KEY });
      useNotifications.getState().notify({
        version: "FurrBox · Anwesenheit",
        tone: "success",
        title: "Übergabe gespeichert",
        description: "Wer als Nächstes anwesend ist, sieht deine Notiz.",
      });
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Übergabe-Notiz" onClose={close}>
      <p className="text-[12px] text-muted">Du bist nicht mehr anwesend. Was sollte der Nächste wissen? Zum Beispiel: was noch offen ist oder auf wen man achten soll.</p>
      <textarea
        autoFocus
        value={text}
        maxLength={MAX}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="z. B. Trollo99 kam zweimal mit neuem Konto – bitte im Auge behalten."
        className="w-full resize-y rounded-md border border-border bg-bg/60 p-2.5 text-[13px] outline-none placeholder:text-subtle focus:border-accent"
      />
      {mine.length > 0 && (
        <button type="button" onClick={addCases} className="justify-self-start text-[12px] text-accent hover:underline">
          + {mine.length === 1 ? "Meinen offenen Fall" : `Meine ${mine.length} offenen Fälle`} einfügen
        </button>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex justify-end gap-2">
        <Btn onClick={close}>Ohne Notiz</Btn>
        <Btn variant="primary" disabled={!text.trim() || busy} onClick={() => void save()}>
          {busy ? "Speichert…" : "Speichern"}
        </Btn>
      </div>
    </Shell>
  );
}

function ReadDialog({ all }: { all: boolean }) {
  const close = useHandover((s) => s.close);
  const seenAt = useHandover((s) => s.seenAt);
  const me = useMe();
  const notes = useQuery({ queryKey: KEY, queryFn: () => listHandovers(), staleTime: 0 });
  const uid = me.data?.userId ?? null;
  const shown = useMemo(() => {
    const list = notes.data ?? [];
    if (all) return list;
    // On duty start: only what the others wrote and what is new for me.
    return list.filter((n) => n.userId !== uid && (!seenAt || n.at > seenAt) && Date.now() - Date.parse(n.at) < FRESH_MS);
  }, [notes.data, all, uid, seenAt]);

  // Nothing new at duty start → never show an empty dialog.
  const nothing = !all && notes.isFetched && me.isFetched && shown.length === 0;
  useEffect(() => {
    if (nothing || (!all && notes.isError)) close();
  }, [nothing, all, notes.isError, close]);

  function done() {
    const newest = notes.data?.[0]?.at;
    if (newest) useHandover.getState().markSeen(newest);
    close();
  }

  if (!all && (!notes.isFetched || !me.isFetched || shown.length === 0)) return null;
  return (
    <Shell title={all ? "Übergabe-Notizen" : "Übergabe vom Team"} onClose={done}>
      {!all && <p className="text-[12px] text-muted">Das haben die anderen hinterlassen, bevor sie gegangen sind:</p>}
      {notes.isError ? (
        <ErrorText>{errorMessage(notes.error)}</ErrorText>
      ) : !notes.data ? (
        <p className="text-[12px] text-muted">Lade…</p>
      ) : shown.length === 0 ? (
        <p className="text-[12px] text-muted">Noch keine Übergabe-Notiz. Sie entsteht, wenn jemand seine Anwesenheit beendet und etwas dazuschreibt.</p>
      ) : (
        <div className="grid gap-2">
          {shown.map((n) => (
            <div key={n.id} className="rounded-lg border border-border bg-elevated/40 p-3">
              <p className="text-[12px] font-semibold">
                {n.name} <span className="font-normal text-subtle">· {timeAgo(n.at)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted">{n.text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Btn variant="primary" onClick={done}>
          {all ? "Schließen" : "Gelesen"}
        </Btn>
      </div>
    </Shell>
  );
}
