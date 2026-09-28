// FurrEvidence: evidence case intake (Discord/VRChat), message proof via bot, moderation queue.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Paperclip, Search, Trash2 } from "lucide-react";
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
import type { ModerationAction } from "@/lib/furr/roles";
import type { MessageProof } from "@/lib/furr/types";
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
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        {(
          [
            ["case", "Neuer Fall"],
            ["cases", "Fallakten"],
            ["moderation", "Moderation"],
          ] as const
        ).map(([id, label]) => (
          <Btn key={id} variant={tab === id ? "default" : "ghost"} onClick={() => setTab(id)}>
            {label}
          </Btn>
        ))}
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

  const filteredMembers = useMemo(
    () => (members.data ?? []).filter((m) => m.label.toLowerCase().includes(memberFilter.toLowerCase())).slice(0, 50),
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

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <div className="flex gap-2">
          {(["Discord", "VRChat"] as const).map((p) => (
            <Btn key={p} variant={platform === p ? "primary" : "default"} onClick={() => setPlatform(p)}>
              {p}
            </Btn>
          ))}
        </div>
        {platform === "Discord" && (
          <Field label="Discord-Nutzer auswählen" hint={members.isError ? errorMessage(members.error) : `${members.data?.length ?? 0} synchronisierte Mitglieder`}>
            <TextInput placeholder="Mitglied suchen…" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} />
            <select
              size={Math.min(6, Math.max(2, filteredMembers.length))}
              value={targetDiscordId}
              onChange={(e) => {
                const m = members.data?.find((x) => x.discordId === e.target.value);
                setTargetDiscordId(e.target.value);
                if (m) setTargetPrimary(m.label);
              }}
              className="rounded-md border border-border bg-bg/60 p-1 text-[13px] text-fg outline-none"
            >
              {filteredMembers.map((m) => (
                <option key={m.discordId} value={m.discordId}>
                  {m.label} · {m.roleNames[0] ?? m.highestPrivilege}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={platform === "Discord" ? "Zielperson (Name)" : "VRChat Display Name"}>
          <TextInput value={targetPrimary} onChange={(e) => setTargetPrimary(e.target.value)} />
        </Field>
        {platform === "Discord" && (
          <Field label="Discord-ID der Zielperson">
            <TextInput value={targetDiscordId} onChange={(e) => setTargetDiscordId(e.target.value.trim())} inputMode="numeric" />
          </Field>
        )}
        <Field label={platform === "Discord" ? "Server / Channel / Message Link" : "Instance ID / World / Time"}>
          <TextInput value={targetSecondary} onChange={(e) => setTargetSecondary(e.target.value)} />
        </Field>
        {platform === "Discord" && (
          <Field label="Nachrichten-ID (optional)">
            <div className="flex gap-2">
              <TextInput value={messageId} onChange={(e) => setMessageId(e.target.value.trim())} inputMode="numeric" />
              <Btn disabled={!messageId || inspecting} onClick={() => void inspect()}>
                <Search className="size-3.5" /> {inspecting ? "Lädt…" : "Laden"}
              </Btn>
            </div>
          </Field>
        )}
        {proof?.found && (
          <div className="rounded-md border border-border bg-elevated/40 p-3 text-[12px]">
            <p className="text-muted">
              {proof.authorName ?? proof.authorId} in #{proof.channelName ?? "?"} · {proof.createdAt ? new Date(proof.createdAt).toLocaleString("de-DE") : ""}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{proof.content || "(kein Text)"}</p>
          </div>
        )}
      </div>

      <div className="grid content-start gap-3">
        <Field label="Violation Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border border-border bg-bg/60 px-2 text-[13px] text-fg outline-none"
          >
            {VIOLATION_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Moderator Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            className="rounded-md border border-border bg-bg/60 p-2 text-[13px] text-fg outline-none focus:border-accent"
          />
        </Field>
        <div
          className="rounded-md border border-dashed border-border p-3 text-[12px] text-muted"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 32));
          }}
        >
          <div className="flex items-center justify-between">
            <span>
              Beweisdateien ({files.length}) · {formatSize(totalSize)} / 3 MB
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-elevated px-2 py-1 text-fg hover:bg-fg/10">
              <Paperclip className="size-3.5" /> Hinzufügen
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const list = e.target.files;
                  if (list) setFiles((f) => [...f, ...Array.from(list)].slice(0, 32));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {files.length === 0 ? (
            <p className="mt-2">Noch keine Beweise hinzugefügt. Dateien hierher ziehen.</p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-fg">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-muted">{formatSize(f.size)}</span>
                  <button type="button" aria-label="Entfernen" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 className="size-3.5 text-muted hover:text-fg" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        <Btn variant="primary" disabled={saving || (!targetPrimary && !targetDiscordId)} onClick={() => void submit()}>
          {saving ? "Beweise werden gespeichert…" : "Fall speichern"}
        </Btn>
      </div>
    </div>
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
