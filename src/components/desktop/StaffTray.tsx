// Staff-Bereich in der Taskleiste (wie ein Windows-Tray-Icon mit Schnelleinstellungen):
// Anwesenheit (on/away/off) + Chatbox-Hinweis + Staff-Tools (Clip, Incident markieren, Votekick-Panel).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, FilePlus2, Flag, FlagOff, MessageSquareText, ShieldCheck, Video } from "lucide-react";
import { clipsMarkIn, clipsMarkOut, clipsSave, hasDesktopClips } from "@/lib/furr/clips-client";
import { markIncidentAlert } from "@/lib/furr/api/alerts-api";
import { playersNote, useCaseDraft } from "@/lib/furr/case-draft";
import { errorMessage } from "@/lib/furr/client";
import type { VrcInstanceState } from "@/components/furr/VRChat";
import { ChatboxComposer } from "@/components/furr/ChatboxComposer";
import { DUTY_DOT, DUTY_LABEL, useDuty } from "@/components/furr/useDuty";
import { useHandover } from "@/lib/furr/handover";
import { useVoteStore } from "@/components/furr/useVoteWatch";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";

/** Tray-Knopf: nur für Staff (canUseEvidence). Punkt = eigener Status. */
export function StaffTrayButton() {
  const duty = useDuty();
  const tray = useDesktop((s) => s.tray);
  const setTray = useDesktop((s) => s.setTray);
  const votes = useVoteStore((s) => s.active.length);
  if (!duty.allowed) return null;
  return (
    <button
      type="button"
      aria-label={`Staff: ${DUTY_LABEL[duty.status]}`}
      title={`Staff · ${DUTY_LABEL[duty.status]}${duty.teamOn ? ` · ${duty.teamOn} im Team anwesend` : ""}`}
      onClick={() => setTray("staff")}
      className={cn("relative grid size-10 place-items-center rounded-md hover:bg-fg/8", tray === "staff" && "bg-fg/10")}
    >
      <ShieldCheck className="size-4" />
      <span
        key={duty.status}
        className={cn("furr-vr-pop absolute bottom-2 right-2 size-2 rounded-full ring-2 ring-bg/80", DUTY_DOT[duty.status])}
      />
      {votes > 0 && <span className="furr-vr-alert absolute right-1 top-1 size-2 rounded-full bg-red-400" />}
    </button>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border/70 bg-elevated/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {icon} {title}
      </p>
      {children}
    </section>
  );
}

export function StaffFlyout() {
  // Offenes Flyout: etwas frischer (20 s wie am Arm), sonst 60 s.
  const duty = useDuty(20_000);
  const queryClient = useQueryClient();
  const openApp = useDesktop((s) => s.openApp);
  const votes = useVoteStore((s) => s.active);
  const setCollapsed = useVoteStore((s) => s.setCollapsed);
  const [busy, setBusy] = useState<null | "clip" | "incident" | "mark">(null);
  const [markInAt, setMarkInAt] = useState<number | null>(null);
  const [inline, setInline] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const clips = hasDesktopClips();

  const instance = () => queryClient.getQueryData<VrcInstanceState>(["furr", "votewatch"]) ?? null;

  function caseFromInstance(note: string, clipId?: string) {
    const s = instance();
    useCaseDraft.getState().set({
      platform: "VRChat",
      targetPrimary: "",
      targetSecondary: [s?.worldName, s?.location].filter(Boolean).join(" · "),
      notes: [note, s?.inInstance ? playersNote(s.players) : "Nicht in einer VRChat-Instanz (laut Log)."].join("\n"),
      clipId,
    });
    openApp("evidence");
  }

  async function saveClip(reason: "manual" | "incident") {
    setBusy(reason === "manual" ? "clip" : "incident");
    setInline(null);
    const at = new Date();
    const stamp = at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    try {
      let clipId: string | undefined;
      if (clips) {
        const res = await clipsSave({ reason, meta: { source: "staff-tools", at: at.toISOString() } });
        if (!res.ok) throw new Error(res.error);
        clipId = res.value.id;
      }
      if (reason === "manual") {
        setInline({ tone: "ok", text: "Clip gespeichert" });
        return;
      }
      const note = `Incident markiert um ${stamp} Uhr${clipId ? " (Clip gespeichert)" : ""}.`;
      // Team-Alert über den Server-Alert-Bus (Bot/Desktop/VR) – best effort.
      const s = instance();
      void markIncidentAlert({
        data: { title: `Incident markiert · ${stamp}`, body: [s?.worldName, clipId ? "Clip gespeichert" : null].filter(Boolean).join(" · "), severity: "warn" },
      }).catch(() => undefined);
      setInline({ tone: "ok", text: clipId ? `Incident markiert · Clip gespeichert` : "Incident markiert" });
      useNotifications.getState().notify({
        id: `incident-${at.getTime()}`,
        version: "FurrBox · Incident",
        kind: "incident",
        tone: "info",
        title: `Incident markiert · ${stamp}`,
        description: clipId ? "Clip liegt bereit. Klick: Fall mit Clip anlegen." : "Klick: Fall mit Spielerliste anlegen.",
        actionLabel: "Fall anlegen",
        durationMs: 8_000,
        onClick: () => caseFromInstance(note, clipId),
      });
    } catch (e) {
      setInline({ tone: "bad", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  /** Clip Mark-In/Out (Clips-Pipeline der Desktop-App): Start markieren, beim Ende speichern. */
  async function mark() {
    setBusy("mark");
    setInline(null);
    try {
      if (markInAt === null) {
        const r = await clipsMarkIn();
        if (!r.ok) throw new Error(r.error);
        setMarkInAt(Date.now());
        setInline({ tone: "ok", text: "Mark-In gesetzt – beim Ende „Mark-Out“ drücken" });
      } else {
        const r = await clipsMarkOut({ source: "staff-tools" });
        if (!r.ok) throw new Error(r.error);
        setMarkInAt(null);
        setInline({ tone: "ok", text: `Clip gespeichert: ${r.value.name}` });
      }
    } catch (e) {
      setInline({ tone: "bad", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mica furr-flyout-in absolute bottom-14 right-2 z-[80] flex max-h-[calc(100%-4.5rem)] w-[min(380px,calc(100%-1rem))] flex-col gap-2 overflow-auto rounded-xl p-3">
      <Section title="Anwesenheit" icon={<ShieldCheck className="size-3.5" />}>
        <div className="flex items-center gap-3">
          <span key={duty.status} className={cn("furr-vr-pop size-3 shrink-0 rounded-full", DUTY_DOT[duty.status])} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">{DUTY_LABEL[duty.status]}</p>
            <p className="text-[11px] text-muted">
              {duty.status === "away"
                ? "Team sieht dich als kurz abwesend"
                : duty.teamOn
                  ? `${duty.teamOn} im Team anwesend`
                  : "Gerade niemand anwesend"}
            </p>
          </div>
        </div>
        {/* Windows-artiger Segment-Schalter: an / kurz weg / aus (Server: setDuty({ status })). */}
        <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg bg-bg/50 p-1" role="radiogroup" aria-label="Anwesenheit">
          {(["on", "away", "off"] as const).map((st) => (
            <button
              key={st}
              type="button"
              role="radio"
              aria-checked={duty.status === st}
              disabled={duty.busy}
              onClick={() => void duty.setStatus(st)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition duration-200 active:scale-95",
                duty.status === st ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              <span className={cn("size-2 rounded-full", DUTY_DOT[st])} />
              {st === "on" ? "Anwesend" : st === "away" ? "Kurz weg" : "Aus"}
            </button>
          ))}
        </div>
        {duty.error && <p className="furr-vr-notice mt-2 rounded-md bg-danger/15 px-2 py-1 text-[11px] text-red-200">{duty.error}</p>}
        <button type="button" onClick={() => useHandover.getState().open("all")} className="mt-2 text-[12px] text-accent hover:underline">
          Übergabe-Notizen ansehen
        </button>
      </Section>

      <Section title="Chatbox-Hinweis" icon={<MessageSquareText className="size-3.5" />}>
        <ChatboxComposer compact />
      </Section>

      <Section title="Staff-Tools" icon={<AlertOctagon className="size-3.5" />}>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={!clips || busy !== null}
            onClick={() => void saveClip("manual")}
            title={clips ? "Clip aus dem Puffer speichern" : "Clips gibt es nur in der Desktop-App (Clip-Einstellungen)"}
            className="flex items-center gap-2 rounded-md bg-elevated px-3 py-2 text-left text-[12px] transition hover:bg-fg/10 active:scale-95 disabled:opacity-50"
          >
            <Video className="size-4 text-accent" /> {busy === "clip" ? "Speichert…" : "Clip speichern"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void saveClip("incident")}
            title={clips ? "Clip speichern + Incident vormerken" : "Incident vormerken (ohne Clip – Clips nur in der Desktop-App)"}
            className="flex items-center gap-2 rounded-md bg-elevated px-3 py-2 text-left text-[12px] transition hover:bg-fg/10 active:scale-95 disabled:opacity-50"
          >
            <AlertOctagon className="size-4 text-amber-300" /> {busy === "incident" ? "Markiert…" : "Incident markieren"}
          </button>
          <button
            type="button"
            onClick={() => caseFromInstance(`Fall angelegt über Staff-Tools um ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.`)}
            className="flex items-center gap-2 rounded-md bg-elevated px-3 py-2 text-left text-[12px] transition hover:bg-fg/10 active:scale-95"
          >
            <FilePlus2 className="size-4 text-accent" /> Neuer Fall
          </button>
          {clips && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void mark()}
              title="Mark-In/Out: Abschnitt manuell begrenzen (Clips-Pipeline)"
              className={cn(
                "col-span-2 flex items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] transition active:scale-95 disabled:opacity-50",
                markInAt !== null ? "bg-red-500/20 text-red-100 hover:bg-red-500/30" : "bg-elevated hover:bg-fg/10",
              )}
            >
              {markInAt !== null ? <FlagOff className="size-4 text-red-300" /> : <Flag className="size-4 text-accent" />}
              {busy === "mark" ? "…" : markInAt !== null ? "Mark-Out (Clip speichern)" : "Mark-In setzen"}
              {markInAt !== null && <span className="furr-vr-alert ml-auto size-2 rounded-full bg-red-400" />}
            </button>
          )}
          <button
            type="button"
            disabled={!votes.length}
            onClick={() => setCollapsed(false)}
            className="flex items-center gap-2 rounded-md bg-elevated px-3 py-2 text-left text-[12px] transition hover:bg-fg/10 active:scale-95 disabled:opacity-50"
          >
            <span className={cn("size-2 rounded-full", votes.length ? "furr-vr-alert bg-red-400" : "bg-fg/30")} />
            {votes.length ? `Votekick (${votes.length})` : "Kein Votekick"}
          </button>
        </div>
        {inline && (
          <p key={inline.text} className={cn("furr-vr-pop mt-2 rounded-md px-2 py-1 text-[12px]", inline.tone === "ok" ? "bg-emerald-500/15 text-emerald-200" : "bg-danger/20 text-red-200")}>
            {inline.text}
          </p>
        )}
      </Section>
    </div>
  );
}
