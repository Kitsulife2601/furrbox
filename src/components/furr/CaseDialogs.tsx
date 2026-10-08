// Dialogs of the case list: "Bearbeiten" (person / id, violation, description) and
// "Strafe geben" (kick or ban in the VRChat group, straight from the case).
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Gavel, Pencil, Search, UserMinus } from "lucide-react";
import { VIOLATION_CATEGORIES, editEvidenceCase } from "@/lib/furr/api/evidence";
import { upsertSanction } from "@/lib/furr/api/sanctions";
import { getVrchatStatus, logVrchatModeration } from "@/lib/furr/api/vrchat";
import { withCaseRef } from "@/lib/furr/case-draft";
import { errorMessage, useMe } from "@/lib/furr/client";
import type { EvidenceCase } from "@/lib/furr/types";
import { scheduleWithUndo } from "@/lib/furr/undo";
import { useNotifications } from "@/store/notifications";
import { BAN_REASON_MIN, UndoBanner } from "./BanSafety";
import { Btn, ErrorText, Field, TextInput } from "./ui";
import { desktopVrchat, unwrap, useMyVrchat, VrcAvatar } from "./VRChat";

const USR = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASES_KEY = ["furr", "evidence-cases"];
const area = "w-full resize-y rounded-md border border-border bg-bg/60 p-2.5 text-[13px] text-fg outline-none placeholder:text-subtle focus:border-accent";

const nameOf = (c: EvidenceCase) => c.targetName || c.caseId.replace(/_\d{4}-.*$/, "").replace(/_/g, " ");

function Shell({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-auto bg-bg/60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className="grid w-full max-w-md gap-3 rounded-lg border border-border bg-surface p-4 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          {icon} {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function EditCaseDialog({ target: c, onClose }: { target: EvidenceCase; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(nameOf(c));
  const [id, setId] = useState(c.targetId ?? "");
  const [category, setCategory] = useState(c.category ?? "");
  const [description, setDescription] = useState(c.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const vr = c.platform === "VRChat";

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await editEvidenceCase({ data: { path: c.path, targetName: name, targetId: id, category, description } });
      await queryClient.invalidateQueries({ queryKey: CASES_KEY });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Shell title="Fall bearbeiten" icon={<Pencil className="size-4 text-accent" />} onClose={onClose}>
      <form onSubmit={save} className="grid gap-3">
        <Field label="Name der Person">
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={vr ? "VRChat-ID" : "Discord-ID"} hint={vr ? "Beginnt mit usr_ – steht im Instanz-Tracker oder auf dem VRChat-Profil." : "Die lange Zahl: in Discord Rechtsklick auf die Person → „Nutzer-ID kopieren“."}>
          <TextInput value={id} onChange={(e) => setId(e.target.value)} placeholder={vr ? "usr_…" : "123456789012345678"} className="font-mono text-[12px]" />
        </Field>
        <Field label="Verstoß">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-md border border-border bg-bg/60 px-2 text-[13px] text-fg outline-none focus:border-accent">
            <option value="">nicht angegeben</option>
            {/* Keep an older / free value selectable. */}
            {category && !(VIOLATION_CATEGORIES as readonly string[]).includes(category) && <option value={category}>{category}</option>}
            {VIOLATION_CATEGORIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Beschreibung">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={4000} placeholder="Was ist passiert?" className={area} />
        </Field>
        <p className="text-[11px] text-subtle">Der Ordner mit den Beweisen bleibt, wie er ist. Jede Änderung steht im Protokoll des Falls.</p>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? "Speichert…" : "Speichern"}
          </Btn>
        </div>
      </form>
    </Shell>
  );
}

type VrcUser = { id: string; displayName: string; image: string | null };

export function PunishCaseDialog({ target: c, onClose }: { target: EvidenceCase; onClose: () => void }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const mine = useMyVrchat();
  const status = useQuery({ queryKey: ["furr", "vrchat", "status"], queryFn: () => getVrchatStatus(), staleTime: 60_000 });
  const groupId = status.data?.groupId ?? null;
  const known = c.targetId && USR.test(c.targetId) ? c.targetId : null;
  const [who, setWho] = useState<VrcUser | null>(known ? { id: known, displayName: nameOf(c), image: null } : null);
  const [query, setQuery] = useState(nameOf(c));
  const [results, setResults] = useState<VrcUser[] | null>(null);
  const [reason, setReason] = useState(c.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ id: string; cancel: () => boolean } | null>(null);

  const blocked = !me.data?.permissions.canModerateVrchat
    ? "Kick und Bann in der VRChat-Gruppe dürfen Moderatoren, Owner und Dev."
    : !desktopVrchat()
      ? "Strafen in VRChat gehen nur in der FurrBox-Desktop-App."
      : mine.data && !mine.data.loggedIn
        ? "Melde dich zuerst an: FurrEvidence → Reiter „VRChat“ → „Dein VRChat-Konto“."
        : status.data && !groupId
          ? "Es ist noch keine VRChat-Gruppe verbunden (FurrEvidence → Reiter „VRChat“)."
          : null;

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResults(await unwrap(desktopVrchat()?.search(query)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: "kick" | "ban", person: VrcUser, why: string) {
    if (!groupId) return;
    let failure: string | null = null;
    try {
      await unwrap(desktopVrchat()?.moderate(action, groupId, person.id));
    } catch (err) {
      failure = errorMessage(err);
    }
    await logVrchatModeration({
      data: { action, userId: person.id, userName: person.displayName, reason: why, vrchatName: mine.data?.displayName ?? undefined, ok: !failure, error: failure ?? undefined },
    });
    if (failure) throw new Error(failure);
    // A ban stays in the list of running sanctions; the case remembers the person.
    if (action === "ban") {
      await upsertSanction({ data: { platform: "vrchat", targetId: person.id, targetName: person.displayName, type: "ban", reason: why, caseId: c.caseId } }).catch(() => undefined);
    }
    if (c.targetId !== person.id) {
      await editEvidenceCase({ data: { path: c.path, targetId: person.id, targetName: c.targetName ?? person.displayName } }).catch(() => undefined);
    }
    await queryClient.invalidateQueries({ queryKey: CASES_KEY });
    await queryClient.invalidateQueries({ queryKey: ["furr", "vrchat", "moderation"] });
    await queryClient.invalidateQueries({ queryKey: ["furr", "sanctions"] });
    useNotifications.getState().notify({
      version: "FurrEvidence",
      tone: "success",
      title: action === "ban" ? "Gebannt" : "Gekickt",
      description: `${person.displayName} – eingetragen beim Fall.`,
    });
  }

  async function kick() {
    if (!who) return;
    setBusy(true);
    setError("");
    try {
      await run("kick", who, withCaseRef(reason, c.caseId));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  /** A ban runs after 10 seconds – until then it can be undone (also from the notification). */
  function ban() {
    if (!who) return;
    const person = who;
    const why = withCaseRef(reason, c.caseId);
    setError("");
    setPending(
      scheduleWithUndo({
        label: `Bann gegen ${person.displayName}`,
        description: why,
        run: () => run("ban", person, why),
        onDone: () => {
          setPending(null);
          onClose();
        },
        onError: (err) => {
          setPending(null);
          setError(errorMessage(err));
        },
        onCancel: () => setPending(null),
      }),
    );
  }

  return (
    <Shell title="Strafe in VRChat geben" icon={<Gavel className="size-4 text-accent" />} onClose={onClose}>
      {blocked ? (
        <>
          <p className="text-[13px] text-muted">{blocked}</p>
          <div className="flex justify-end">
            <Btn onClick={onClose}>Schließen</Btn>
          </div>
        </>
      ) : !who ? (
        <>
          <p className="text-[12px] text-muted">Bei diesem Fall ist noch keine VRChat-ID eingetragen. Such die Person und klick sie an.</p>
          <form onSubmit={search} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <TextInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="VRChat-Name oder usr_…" className="h-9 pl-9" />
            </div>
            <Btn type="submit" variant="primary" disabled={busy || query.trim().length < 2}>
              Suchen
            </Btn>
          </form>
          {error && <ErrorText>{error}</ErrorText>}
          {results && results.length === 0 && <p className="text-[12px] text-muted">Niemand gefunden.</p>}
          <div className="grid max-h-56 gap-1 overflow-auto">
            {(results ?? []).map((u) => (
              <button key={u.id} type="button" onClick={() => setWho(u)} className="flex items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-fg/8">
                <VrcAvatar user={u} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{u.displayName}</span>
                  <span className="block truncate font-mono text-[10px] text-subtle">{u.id}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Btn onClick={onClose}>Abbrechen</Btn>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 p-2.5">
            <VrcAvatar user={who} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{who.displayName}</p>
              <p className="truncate font-mono text-[10px] text-muted">{who.id}</p>
            </div>
            {!pending && (
              <button type="button" onClick={() => setWho(null)} className="text-[12px] text-accent hover:underline">
                Andere Person
              </button>
            )}
          </div>
          <Field label="Grund" hint="Steht danach im Moderationslog, zusammen mit dem Fall.">
            <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={450} placeholder="Warum bekommt die Person die Strafe?" className={area} />
          </Field>
          {pending && <UndoBanner pendingId={pending.id} onUndo={() => pending.cancel()} />}
          {error && <ErrorText>{error}</ErrorText>}
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={busy || Boolean(pending) || reason.trim().length < 3} onClick={() => void kick()} title="Wirft die Person aus der Gruppe – sie kann wieder beitreten.">
              <UserMinus className="size-3.5" /> {busy ? "Läuft…" : "Kick"}
            </Btn>
            <Btn
              variant="danger"
              disabled={busy || Boolean(pending) || reason.trim().length < BAN_REASON_MIN}
              onClick={ban}
              title={`Bann braucht mindestens ${BAN_REASON_MIN} Zeichen Begründung. 10 Sekunden lang kannst du ihn rückgängig machen.`}
            >
              <Ban className="size-3.5" /> Bann
            </Btn>
          </div>
          <p className="text-[11px] text-subtle">
            Kick und Bann gelten für die VRChat-Gruppe und laufen unter deinem VRChat-Konto. Ein Bann startet erst nach 10 Sekunden – so lange kannst du ihn abbrechen.
          </p>
          <div className="flex justify-end">
            <Btn onClick={onClose}>{pending ? "Im Hintergrund weiter" : "Schließen"}</Btn>
          </div>
        </>
      )}
    </Shell>
  );
}
