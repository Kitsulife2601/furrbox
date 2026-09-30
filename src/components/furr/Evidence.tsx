// FurrEvidence: evidence case intake (Discord/VRChat), message proof via bot, moderation queue.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderOpen, Globe2, Image as ImageIcon, MessagesSquare, Save, Search, UploadCloud, X } from "lucide-react";
import {
  VIOLATION_CATEGORIES,
  getMessageInspect,
  listEvidenceCases,
  listModeration,
  queueModeration,
  requestMessageInspect,
  saveEvidenceCase,
} from "@/lib/furr/api/evidence";
import { listDiscordMembers } from "@/lib/furr/api/presence";
import { getBridgeStatus } from "@/lib/furr/api/session";
import { errorMessage, fileToBase64, timeAgo, useMe } from "@/lib/furr/client";
import { MAX_UPLOAD_BYTES, formatSize } from "@/lib/furr/paths";
import { ROLE_LABEL, isRole, type ModerationAction } from "@/lib/furr/roles";
import type { DiscordMemberOption, MessageProof } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { Badge, Btn, Empty, ErrorText, Field, TextInput } from "./ui";

const DURATIONS = [
  { label: "10 Minuten", ms: 10 * 60_000 },
  { label: "1 Stunde", ms: 60 * 60_000 },
  { label: "1 Tag", ms: 24 * 60 * 60_000 },
  { label: "7 Tage", ms: 7 * 24 * 60 * 60_000 },
  { label: "28 Tage", ms: 28 * 24 * 60 * 60_000 },
];

const ACTION_LABEL: Record<ModerationAction, string> = { warn: "Warn", timeout: "Timeout", mute: "Mute", ban: "Ban" };

async function waitForInspect(requestId: string): Promise<MessageProof> {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await getMessageInspect({ data: requestId });
    if (res.status === "done" && res.result) return res.result;
  }
  throw new Error("Der Discord-Bot hat nicht rechtzeitig geantwortet.");
}

export function Evidence() {
  const [tab, setTab] = useState<"case" | "cases" | "moderation">("case");
  const bridge = useQuery({ queryKey: ["furr", "bridge"], queryFn: () => getBridgeStatus(), refetchInterval: 15_000 });

  return (
    <div className="flex h-full flex-col bg-bg/40">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <div className="flex gap-1 rounded-lg bg-bg/60 p-1">
          {(
            [
              ["case", "Neuer Fall"],
              ["cases", "Fallakten"],
              ["moderation", "Moderation"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "h-8 rounded-md px-3 text-[13px] font-medium transition-colors",
                tab === id ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-muted">
          Discord-Bot:{" "}
          {bridge.data?.connected ? (
            <Badge tone="good">verbunden</Badge>
          ) : (
            <Badge tone="warn">{bridge.data?.configured ? "nicht verbunden" : "nicht eingerichtet"}</Badge>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "case" && <CaseForm onSaved={() => setTab("cases")} />}
        {tab === "cases" && <CaseList />}
        {tab === "moderation" && <ModerationPanel />}
      </div>
    </div>
  );
}

function CaseForm({ onSaved }: { onSaved: () => void }) {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["furr", "discord-members"], queryFn: () => listDiscordMembers() });
  const [platform, setPlatform] = useState<"Discord" | "VRChat">("Discord");
  const [memberFilter, setMemberFilter] = useState("");
  const [targetPrimary, setTargetPrimary] = useState("");
  const [targetDiscordId, setTargetDiscordId] = useState("");
  const [targetSecondary, setTargetSecondary] = useState("");
  const [messageId, setMessageId] = useState("");
  const [proof, setProof] = useState<MessageProof | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [category, setCategory] = useState<string>(VIOLATION_CATEGORIES[0]);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [dragging, setDragging] = useState(false);

  const filteredMembers = useMemo(
    () =>
      (members.data ?? [])
        .filter((m) => `${m.label} ${m.displayName} ${m.discordId}`.toLowerCase().includes(memberFilter.toLowerCase()))
        .slice(0, 60),
    [members.data, memberFilter],
  );
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  async function inspect() {
    setError("");
    setInspecting(true);
    try {
      const { requestId } = await requestMessageInspect({ data: messageId });
      const result = await waitForInspect(requestId);
      setProof(result);
      if (!result.found) setError(result.error || "Nachricht nicht gefunden.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setInspecting(false);
    }
  }

  async function submit() {
    setError("");
    if (totalSize > MAX_UPLOAD_BYTES) return setError("Beweisdateien sind zusammen größer als 3 MB.");
    setSaving(true);
    try {
      const payloadFiles = await Promise.all(
        files.map(async (f) => ({ name: f.name, mimeType: f.type, base64: await fileToBase64(f) })),
      );
      const member = members.data?.find((m) => m.discordId === targetDiscordId);
      const res = await saveEvidenceCase({
        data: {
          platform,
          targetPrimary: targetPrimary || member?.label || targetDiscordId,
          targetDiscordId,
          targetDisplayName: member ? member.nickname || member.displayName : "",
          targetSecondary,
          messageId,
          messageProof: proof,
          violationCategory: category,
          notes,
          files: payloadFiles,
        },
      });
      useNotifications.getState().notify({ version: "FurrEvidence", title: "Fall gespeichert", description: res.casePath });
      await queryClient.invalidateQueries({ queryKey: ["furr"] });
      setFiles([]);
      setNotes("");
      setProof(null);
      setMessageId("");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const selected = members.data?.find((m) => m.discordId === targetDiscordId) ?? null;
  const ready = Boolean(targetPrimary || targetDiscordId);
  const usage = Math.min(100, Math.round((totalSize / MAX_UPLOAD_BYTES) * 100));

  function pick(m: DiscordMemberOption) {
    setTargetDiscordId(m.discordId);
    setTargetPrimary(m.label);
    setManual(false);
  }

  function clearTarget() {
    setTargetDiscordId("");
    setTargetPrimary("");
  }

  function addFiles(list: FileList | File[]) {
    setFiles((f) => [...f, ...Array.from(list)].slice(0, 32));
  }

  return (
    <div className="@container flex min-h-full flex-col">
      <div className="mx-auto grid w-full max-w-5xl flex-1 content-start gap-4 p-4 @3xl:grid-cols-2">
        <div className="grid content-start gap-4">
          <Card step={1} title="Plattform & Zielperson" subtitle="Um wen geht es?">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg/60 p-1">
              {(["Discord", "VRChat"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPlatform(p);
                    clearTarget();
                  }}
                  className={cn(
                    "flex h-9 items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors",
                    platform === p ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:bg-fg/6 hover:text-fg",
                  )}
                >
                  {p === "Discord" ? <MessagesSquare className="size-4" /> : <Globe2 className="size-4" />}
                  {p}
                </button>
              ))}
            </div>

            {platform === "Discord" && !manual && selected ? (
              <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 p-3">
                <Avatar name={selected.nickname || selected.displayName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{selected.nickname || selected.displayName}</p>
                  <p className="truncate text-[12px] text-muted">
                    @{selected.username} · <span className="font-mono">{selected.discordId}</span>
                  </p>
                </div>
                <button type="button" onClick={clearTarget} className="rounded-md p-1.5 text-muted hover:bg-fg/10 hover:text-fg" aria-label="Andere Person wählen">
                  <X className="size-4" />
                </button>
              </div>
            ) : platform === "Discord" && !manual ? (
              <div className="grid gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                  <TextInput
                    placeholder={`Mitglied suchen… (${members.data?.length ?? 0} synchronisiert)`}
                    value={memberFilter}
                    onChange={(e) => setMemberFilter(e.target.value)}
                    className="h-10 pl-9"
                  />
                </div>
                <div className="grid max-h-56 gap-0.5 overflow-auto rounded-lg border border-border bg-bg/40 p-1">
                  {members.isError ? (
                    <p className="px-3 py-4 text-center text-[12px] text-muted">{errorMessage(members.error)}</p>
                  ) : !members.data ? (
                    <p className="px-3 py-4 text-center text-[12px] text-muted">Lade Mitglieder…</p>
                  ) : filteredMembers.length === 0 ? (
                    <p className="px-3 py-4 text-center text-[12px] text-muted">Niemand gefunden.</p>
                  ) : (
                    filteredMembers.map((m) => {
                      const role = memberRole(m);
                      return (
                        <button
                          key={m.discordId}
                          type="button"
                          onClick={() => pick(m)}
                          className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-fg/8"
                        >
                          <Avatar name={m.nickname || m.displayName} small />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{m.nickname || m.displayName}</span>
                            <span className="block truncate text-[11px] text-muted">@{m.username}</span>
                          </span>
                          {role && <Badge tone="accent">{role}</Badge>}
                        </button>
                      );
                    })
                  )}
                </div>
                <button type="button" onClick={() => setManual(true)} className="justify-self-start text-[12px] text-accent hover:underline">
                  Nicht in der Liste? Manuell eingeben
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                <Field label={platform === "Discord" ? "Name der Person" : "VRChat Display Name"}>
                  <TextInput value={targetPrimary} onChange={(e) => setTargetPrimary(e.target.value)} className="h-10" />
                </Field>
                {platform === "Discord" && (
                  <>
                    <Field label="Discord-ID" hint="Rechtsklick auf die Person → „Benutzer-ID kopieren“">
                      <TextInput value={targetDiscordId} onChange={(e) => setTargetDiscordId(e.target.value.trim())} inputMode="numeric" className="h-10 font-mono" />
                    </Field>
                    <button type="button" onClick={() => setManual(false)} className="justify-self-start text-[12px] text-accent hover:underline">
                      Zurück zur Mitgliederliste
                    </button>
                  </>
                )}
              </div>
            )}

            <Field label={platform === "Discord" ? "Wo ist es passiert? (Server, Channel oder Link)" : "Instanz, Welt und Uhrzeit"}>
              <TextInput value={targetSecondary} onChange={(e) => setTargetSecondary(e.target.value)} className="h-10" placeholder={platform === "Discord" ? "#allgemein oder https://discord.com/channels/…" : "wrld_… · 21:30 Uhr"} />
            </Field>
          </Card>

          {platform === "Discord" && (
            <Card step={2} title="Nachricht als Beweis" subtitle="Optional: der Bot holt die Nachricht direkt aus Discord.">
              <div className="flex gap-2">
                <TextInput value={messageId} onChange={(e) => setMessageId(e.target.value.trim())} inputMode="numeric" placeholder="Nachrichten-ID" className="h-10 font-mono" />
                <Btn className="h-10 px-4" disabled={!messageId || inspecting} onClick={() => void inspect()}>
                  <Search className="size-4" /> {inspecting ? "Lädt…" : "Laden"}
                </Btn>
              </div>
              {proof?.found && (
                <div className="flex gap-3 rounded-lg bg-bg/60 p-3">
                  <Avatar name={proof.authorName ?? "?"} small />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px]">
                      <span className="font-semibold">{proof.authorName ?? proof.authorId}</span>{" "}
                      <span className="text-subtle">
                        in #{proof.channelName ?? "?"}
                        {proof.createdAt ? ` · ${new Date(proof.createdAt).toLocaleString("de-DE")}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px]">{proof.content || "(kein Text)"}</p>
                  </div>
                  <button type="button" onClick={() => setProof(null)} className="self-start rounded p-1 text-muted hover:text-fg" aria-label="Nachricht entfernen">
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="grid content-start gap-4">
          <Card step={platform === "Discord" ? 3 : 2} title="Einordnung" subtitle="Was ist passiert?">
            <div className="flex flex-wrap gap-1.5">
              {VIOLATION_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                    category === c ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:border-fg/30 hover:text-fg",
                  )}
                >
                  {CATEGORY_LABEL[c] ?? c}
                </button>
              ))}
            </div>
            <div className="grid gap-1">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                maxLength={10_000}
                placeholder="Notizen für das Team: Was genau ist passiert, gab es Vorwarnungen, …"
                className="resize-y rounded-lg border border-border bg-bg/60 p-3 text-[13px] text-fg outline-none placeholder:text-subtle focus:border-accent"
              />
              <span className="justify-self-end text-[11px] text-subtle">{notes.length} / 10.000</span>
            </div>
          </Card>

          <Card step={platform === "Discord" ? 4 : 3} title="Beweisdateien" subtitle="Screenshots, Videos oder Logs – zusammen max. 3 MB.">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
                dragging ? "border-accent bg-accent/10" : "border-border hover:border-fg/30 hover:bg-fg/4",
              )}
            >
              <UploadCloud className={cn("size-7", dragging ? "text-accent" : "text-subtle")} />
              <span className="text-[13px] font-medium">Dateien hierher ziehen</span>
              <span className="text-[12px] text-muted">oder klicken zum Auswählen</span>
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="grid gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-bg/70">
                <div className={cn("h-full rounded-full", usage >= 100 ? "bg-danger" : "bg-accent")} style={{ width: `${usage}%` }} />
              </div>
              <span className="text-[11px] text-subtle">
                {files.length} {files.length === 1 ? "Datei" : "Dateien"} · {formatSize(totalSize)} von 3 MB
              </span>
            </div>
            {files.length > 0 && (
              <ul className="grid gap-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-bg/50 px-2 py-1.5 text-[12px]">
                    {f.type.startsWith("image/") ? <ImageIcon className="size-4 shrink-0 text-accent" /> : <FileText className="size-4 shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-muted">{formatSize(f.size)}</span>
                    <button type="button" aria-label="Entfernen" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="rounded p-0.5 text-muted hover:text-fg">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 text-[12px] text-muted">
            {ready ? (
              <>
                <span className="font-medium text-fg">{selected ? selected.nickname || selected.displayName : targetPrimary || targetDiscordId}</span>
                {" · "}
                {platform} · {CATEGORY_LABEL[category] ?? category} · {files.length} {files.length === 1 ? "Datei" : "Dateien"}
                {proof?.found ? " · Nachricht" : ""}
              </>
            ) : (
              "Wähle zuerst die Zielperson aus."
            )}
            {error && <p className="mt-1 text-red-300">{error}</p>}
          </div>
          <Btn variant="primary" className="h-10 px-5" disabled={saving || !ready} onClick={() => void submit()}>
            <Save className="size-4" /> {saving ? "Wird gespeichert…" : "Fall speichern"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  Harassment: "Belästigung",
  "Chat Spam": "Spam",
  "NSFW Content": "NSFW-Inhalte",
  Threats: "Drohungen",
  Impersonation: "Identitätsbetrug",
  "ToS Violation": "Regelverstoß",
  Other: "Sonstiges",
};

function memberRole(m: DiscordMemberOption) {
  const name = m.roleNames.find((r) => r && r !== "@everyone");
  if (name) return name;
  return isRole(m.highestPrivilege) && m.highestPrivilege !== "member" ? ROLE_LABEL[m.highestPrivilege] : null;
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent/80 to-violet-500/70 font-semibold text-white",
        small ? "size-8 text-[12px]" : "size-10 text-[14px]",
      )}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function Card({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl border border-border bg-elevated/40 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent/20 text-[12px] font-semibold text-accent">{step}</span>
        <div>
          <h3 className="text-[14px] font-semibold leading-6">{title}</h3>
          {subtitle && <p className="text-[12px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function CaseList() {
  const cases = useQuery({ queryKey: ["furr", "evidence-cases"], queryFn: () => listEvidenceCases(), refetchInterval: 15_000 });
  const openApp = useDesktop((s) => s.openApp);
  if (cases.isError) return <Empty>{errorMessage(cases.error)}</Empty>;
  if (!cases.data) return <Empty>Lade Fallakten…</Empty>;
  if (!cases.data.length) return <Empty>Noch keine Fälle gespeichert.</Empty>;
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="bg-elevated/60 text-muted">
        <tr>
          <th className="px-3 py-2 font-medium">Fall</th>
          <th className="px-3 py-2 font-medium">Plattform</th>
          <th className="px-3 py-2 font-medium">Dateien</th>
          <th className="px-3 py-2 font-medium">Erstellt</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {cases.data.map((c) => (
          <tr key={c.path} className="border-t border-border hover:bg-fg/5">
            <td className="max-w-[280px] truncate px-3 py-2 font-mono text-[12px]">{c.caseId}</td>
            <td className="px-3 py-2">{c.platform}</td>
            <td className="px-3 py-2">{c.fileCount}</td>
            <td className="px-3 py-2 text-muted">{c.createdAt ? new Date(c.createdAt).toLocaleString("de-DE") : ""}</td>
            <td className="px-3 py-2 text-right">
              <Btn variant="ghost" onClick={() => openApp("explorer", { payload: { scope: "public", folder: c.path } })}>
                <FolderOpen className="size-3.5" /> Öffnen
              </Btn>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModerationPanel() {
  const me = useMe();
  const queryClient = useQueryClient();
  const entries = useQuery({ queryKey: ["furr", "moderation"], queryFn: () => listModeration(), refetchInterval: 5_000 });
  const allowed = me.data?.permissions.moderationActions ?? [];
  const [action, setAction] = useState<ModerationAction>("warn");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].ms);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsDuration = action === "timeout" || action === "mute";

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await queueModeration({ data: { action, targetDiscordId: target, reason, durationMs: needsDuration ? duration : undefined } });
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["furr", "moderation"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,340px)_1fr]">
      <div className="grid content-start gap-3">
        <p className="text-[12px] text-muted">
          Befehle werden in die Warteschlange gestellt und vom Discord-Bot ausgeführt. Ergebnisse landen im Audit-Log
          (Shared Network → Dokumente/Moderation_Beweise/Discord_Logs).
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACTION_LABEL) as ModerationAction[]).map((a) => (
            <Btn key={a} disabled={!allowed.includes(a)} variant={action === a ? "primary" : "default"} onClick={() => setAction(a)}>
              {ACTION_LABEL[a]}
            </Btn>
          ))}
        </div>
        <Field label="Discord-ID der Zielperson">
          <TextInput value={target} onChange={(e) => setTarget(e.target.value.trim())} inputMode="numeric" />
        </Field>
        {needsDuration && (
          <Field label="Dauer">
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="h-9 rounded-md border border-border bg-bg/60 px-2 text-[13px] text-fg outline-none"
            >
              {DURATIONS.map((d) => (
                <option key={d.ms} value={d.ms}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Begründung">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="rounded-md border border-border bg-bg/60 p-2 text-[13px] text-fg outline-none focus:border-accent"
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Btn variant="danger" disabled={busy || !allowed.includes(action)} onClick={() => void submit()}>
          {ACTION_LABEL[action]} ausführen
        </Btn>
      </div>
      <div className="min-w-0">
        {!entries.data?.length ? (
          <Empty>Noch keine Moderationsaktionen.</Empty>
        ) : (
          <ul className="grid gap-2">
            {entries.data.map((m) => (
              <li key={m.id} className="rounded-md bg-elevated/40 px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold uppercase">{m.action}</span>
                  <span className="min-w-0 flex-1 truncate">→ {m.targetName}</span>
                  <Badge tone={m.status === "success" ? "good" : m.status === "failed" ? "bad" : "warn"}>{m.status}</Badge>
                </div>
                <p className={cn("mt-1 text-muted")}>
                  {m.moderatorName} · {timeAgo(m.createdAt)} · {m.reason}
                </p>
                {m.error && <p className="mt-1 text-red-300">{m.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
