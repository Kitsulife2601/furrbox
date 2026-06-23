"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Gavel, Image, ShieldAlert, UploadCloud, Video, X } from "lucide-react";
import { FurrWindow } from "@/components/FurrWindow";
import { inspectDiscordMessage, saveEvidenceCase, type DiscordMessageProof } from "@/lib/evidence";
import { listPresenceUsers, type PresenceUser } from "@/lib/presence";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

type Platform = "Discord" | "VRChat";

const categories = ["Harassment", "ToS Violation", "Chat Spam", "Threats", "NSFW Content", "Impersonation", "Other"];

function memberDisplayName(user: PresenceUser) {
  return user.nickname || user.discordUsername || user.displayName || user.username || "Unbekannter Nutzer";
}

function dualPresenceText(user: PresenceUser) {
  if (user.dualPresenceLabel) return user.dualPresenceLabel;
  const isExeOnline = user.isExeOnline ?? user.status === "online";
  const isDiscordOnline = user.isDiscordOnline ?? false;
  if (isExeOnline && isDiscordOnline) return "ðŸŸ¢ Online (App & DC)";
  if (isExeOnline) return "ðŸ”µ Online (Nur App)";
  if (isDiscordOnline) return "ðŸ’œ Online (Nur Discord)";
  return "âš« Offline";
}

function memberOptionLabel(user: PresenceUser) {
  return `${memberDisplayName(user)} - ${user.roleName} - ${dualPresenceText(user)}`;
}

function fileIcon(file: File) {
  if (file.type.startsWith("image/")) return <Image size={18} />;
  if (file.type.startsWith("video/")) return <Video size={18} />;
  return <FileText size={18} />;
}

export function FurrEvidence({ windowState }: { windowState: FurrWindowState }) {
  const { token, socket } = useFurrBoxStore();
  const [platform, setPlatform] = useState<Platform>("Discord");
  const [targetPrimary, setTargetPrimary] = useState("");
  const [selectedDiscordId, setSelectedDiscordId] = useState("");
  const [registeredMembers, setRegisteredMembers] = useState<PresenceUser[]>([]);
  const [teamMembers, setTeamMembers] = useState<PresenceUser[]>([]);
  const [memberLoadError, setMemberLoadError] = useState("");
  const [targetSecondary, setTargetSecondary] = useState("");
  const [messageId, setMessageId] = useState("");
  const [messageProof, setMessageProof] = useState<DiscordMessageProof | null>(null);
  const [messageBusy, setMessageBusy] = useState(false);
  const [violationCategory, setViolationCategory] = useState(categories[0]);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ type: "idle" | "saving" | "success" | "error"; message: string }>({ type: "idle", message: "" });

  const selectedMember = useMemo(() => {
    const merged = [...teamMembers, ...registeredMembers];
    return merged.find((member) => member.discordId === selectedDiscordId) || null;
  }, [registeredMembers, selectedDiscordId, teamMembers]);

  const targetLabels = useMemo(() => {
    if (platform === "Discord") return { primary: "Discord Nutzer", secondary: "Server / Channel / Message Link" };
    return { primary: "VRChat Display Name", secondary: "Instance ID / World / Time" };
  }, [platform]);

  useEffect(() => {
    if (!token || platform !== "Discord") return;
    Promise.all([listPresenceUsers(token, "global"), listPresenceUsers(token, "team")])
      .then(([globalMembers, team]) => {
        setRegisteredMembers(globalMembers.filter((member) => member.discordId));
        setTeamMembers(team.filter((member) => member.discordId));
        setMemberLoadError("");
      })
      .catch((error) => setMemberLoadError(error instanceof Error ? error.message : "Presence-Nutzer konnten nicht geladen werden."));
  }, [platform, token]);

  useEffect(() => {
    if (!socket || !token || platform !== "Discord") return;
    const refreshMembers = () => {
      Promise.all([listPresenceUsers(token, "global"), listPresenceUsers(token, "team")])
        .then(([globalMembers, team]) => {
          setRegisteredMembers(globalMembers.filter((member) => member.discordId));
          setTeamMembers(team.filter((member) => member.discordId));
        })
        .catch(() => undefined);
    };
    socket.on("presence:snapshot", refreshMembers);
    socket.on("presence:update", refreshMembers);
    socket.on("discord:presence-refreshed", refreshMembers);
    socket.on("discord:members-refreshed", refreshMembers);
    return () => {
      socket.off("presence:snapshot", refreshMembers);
      socket.off("presence:update", refreshMembers);
      socket.off("discord:presence-refreshed", refreshMembers);
      socket.off("discord:members-refreshed", refreshMembers);
    };
  }, [platform, socket, token]);

  function selectDiscordMember(discordId: string) {
    setSelectedDiscordId(discordId);
    const member = [...teamMembers, ...registeredMembers].find((candidate) => candidate.discordId === discordId);
    setTargetPrimary(member ? memberDisplayName(member) : "");
  }

  async function inspectMessage() {
    if (!token || !/^\d{17,22}$/.test(messageId)) {
      setStatus({ type: "error", message: "Nachrichten-ID muss eine gültige Discord-Snowflake sein." });
      return;
    }
    setMessageBusy(true);
    try {
      const proof = await inspectDiscordMessage(token, messageId);
      setMessageProof(proof);
      setStatus(proof.found ? { type: "success", message: "Nachricht als Beweis geladen." } : { type: "error", message: proof.error || "Nachricht nicht gefunden." });
    } catch (error) {
      setMessageProof(null);
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Nachricht konnte nicht geladen werden." });
    } finally {
      setMessageBusy(false);
    }
  }

  function addFiles(nextFiles: FileList | File[]) {
    const incoming = Array.from(nextFiles).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("text/") || file.name.endsWith(".log") || file.name.endsWith(".txt"));
    setFiles((current) => [...current, ...incoming]);
  }

  async function submit() {
    if (!token) {
      setStatus({ type: "error", message: "Du musst angemeldet sein." });
      return;
    }
    const resolvedTarget = platform === "Discord" && selectedMember ? memberDisplayName(selectedMember) : targetPrimary.trim();
    if (!resolvedTarget || (!files.length && !messageProof?.found)) {
      setStatus({ type: "error", message: "Zielperson und mindestens eine Datei oder geladene Nachrichten-ID sind erforderlich." });
      return;
    }

    setStatus({ type: "saving", message: "Beweise werden strukturiert gespeichert..." });
    try {
      const result = await saveEvidenceCase(token, {
        platform,
        targetPrimary: resolvedTarget,
        targetDiscordId: platform === "Discord" ? selectedMember?.discordId || undefined : undefined,
        targetDisplayName: platform === "Discord" && selectedMember ? memberDisplayName(selectedMember) : undefined,
        targetSecondary,
        messageId: messageId.trim() || undefined,
        messageProof,
        violationCategory,
        notes,
        files
      });
      socket?.emit("file-uploaded", { scope: "public" });
      setStatus({ type: "success", message: `Fall gesichert: ${result.casePath}` });
      setFiles([]);
      setNotes("");
      setMessageId("");
      setMessageProof(null);
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Speichern fehlgeschlagen." });
    }
  }

  return (
    <FurrWindow windowState={windowState} icon={<Gavel size={15} />}>
      <div className="grid h-full grid-cols-[1fr_360px] bg-slate-950 text-slate-100">
        <section className="flex min-w-0 flex-col p-5">
          <div className="mb-4">
            <h2 className="text-[22px] font-semibold">FurrEvidence</h2>
            <p className="mt-1 text-[13px] text-slate-400">Moderationsbeweise für Discord und VRChat revisionssicher in FurrFS ablegen.</p>
          </div>

          <div
            className={`grid min-h-72 flex-1 place-items-center rounded-2xl border border-dashed p-6 text-center transition ${
              dragging ? "border-cyan-300 bg-cyan-500/10" : "border-slate-600 bg-slate-900"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
          >
            <div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-500/15 text-cyan-200 shadow-[0_0_28px_rgba(34,211,238,0.25)]">
                <UploadCloud size={31} />
              </div>
              <p className="mt-4 text-[15px] font-semibold">Screenshots, Clips oder Chatlogs hier ablegen</p>
              <p className="mt-1 text-[12px] text-slate-400">Akzeptiert Bilder, Videos, `.txt` und `.log` Dateien.</p>
              <label className="mt-4 inline-flex h-10 cursor-pointer items-center rounded-xl bg-white px-4 text-[13px] font-semibold text-slate-950 hover:bg-cyan-100">
                Dateien auswählen
                <input className="hidden" type="file" multiple accept="image/*,video/*,.txt,.log,text/plain" onChange={(event) => event.target.files && addFiles(event.target.files)} />
              </label>
            </div>
          </div>
        </section>

        <aside className="scroll-soft overflow-auto border-l border-white/10 bg-slate-900/80 p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert size={18} className="text-cyan-200" />
            <h3 className="text-[15px] font-semibold">Fall-Metadaten</h3>
          </div>

          <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-800 p-1">
            {(["Discord", "VRChat"] as Platform[]).map((item) => (
              <button key={item} className={`h-9 rounded-lg text-[13px] font-semibold ${platform === item ? "bg-cyan-400 text-slate-950" : "text-slate-400"}`} onClick={() => setPlatform(item)}>
                {item}
              </button>
            ))}
          </div>

          <label className="mb-3 block">
            <span className="mb-1 block text-[12px] font-medium text-slate-400">{targetLabels.primary}</span>
            {platform === "Discord" ? (
              <div className="space-y-3 rounded-2xl border border-cyan-300/10 bg-slate-950/80 p-3 shadow-[0_0_20px_rgba(0,240,255,0.08)]">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Alle registrierten Fischmember</span>
                  <select
                    className="h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-[12px] font-semibold text-slate-100 outline-none focus:border-cyan-300 focus:shadow-[0_0_16px_rgba(0,240,255,0.22)]"
                    value={registeredMembers.some((member) => member.discordId === selectedDiscordId) ? selectedDiscordId : ""}
                    onChange={(event) => selectDiscordMember(event.target.value)}
                  >
                    <option value="">Globalen Nutzer auswählen</option>
                    {registeredMembers.map((member) => (
                      <option key={`global-${member.id}`} value={member.discordId || ""}>
                        {memberOptionLabel(member)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-200">Team-Rollen Matrix</span>
                  <select
                    className="h-11 w-full rounded-xl border border-fuchsia-300/20 bg-slate-950 px-3 text-[12px] font-semibold text-slate-100 outline-none focus:border-fuchsia-300 focus:shadow-[0_0_16px_rgba(255,0,127,0.22)]"
                    value={teamMembers.some((member) => member.discordId === selectedDiscordId) ? selectedDiscordId : ""}
                    onChange={(event) => selectDiscordMember(event.target.value)}
                  >
                    <option value="">Team-Mitglied auswählen</option>
                    {teamMembers.map((member) => (
                      <option key={`team-${member.id}`} value={member.discordId || ""}>
                        {memberOptionLabel(member)}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedMember ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <div className="truncate text-[13px] font-black text-white">{memberDisplayName(selectedMember)}</div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                      <span className="text-cyan-200">{dualPresenceText(selectedMember)}</span>
                      <span className="rounded-md border border-violet-400/30 px-2 py-0.5 text-violet-100">{selectedMember.roleName}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <input className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-[13px] outline-none focus:border-cyan-300" value={targetPrimary} onChange={(event) => setTargetPrimary(event.target.value)} />
            )}
            {platform === "Discord" && memberLoadError ? <span className="mt-1 block text-[11px] text-red-300">{memberLoadError}</span> : null}
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-[12px] font-medium text-slate-400">{targetLabels.secondary}</span>
            <input className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-[13px] outline-none focus:border-cyan-300" value={targetSecondary} onChange={(event) => setTargetSecondary(event.target.value)} />
          </label>

          {platform === "Discord" ? (
            <div className="mb-3">
              <span className="mb-1 block text-[12px] font-medium text-slate-400">Nachrichten-ID (Optional)</span>
              <div className="flex gap-2">
                <input
                  className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-[13px] outline-none focus:border-cyan-300"
                  inputMode="numeric"
                  placeholder="Discord Message Snowflake"
                  value={messageId}
                  onChange={(event) => {
                    setMessageId(event.target.value.replace(/\D/g, ""));
                    setMessageProof(null);
                  }}
                />
                <button className="h-10 rounded-xl border border-cyan-300/30 px-3 text-[12px] font-semibold text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50" disabled={messageBusy || !messageId} onClick={inspectMessage}>
                  Prüfen
                </button>
              </div>
              {messageProof ? (
                <div className={`mt-2 rounded-xl border p-3 text-[12px] ${messageProof.found ? "border-cyan-300/20 bg-cyan-500/10 text-cyan-100" : "border-red-300/20 bg-red-500/10 text-red-100"}`}>
                  {messageProof.found ? (
                    <>
                      <div className="mb-1 font-semibold">{messageProof.authorName} in #{messageProof.channelName}</div>
                      <p className="max-h-24 overflow-auto whitespace-pre-wrap text-slate-200">{messageProof.content}</p>
                    </>
                  ) : (
                    <p>{messageProof.error || "Nachricht nicht gefunden."}</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <label className="mb-3 block">
            <span className="mb-1 block text-[12px] font-medium text-slate-400">Violation Category</span>
            <select className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-[13px] outline-none focus:border-cyan-300" value={violationCategory} onChange={(event) => setViolationCategory(event.target.value)}>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-[12px] font-medium text-slate-400">Moderator Notes</span>
            <textarea className="h-24 w-full resize-none rounded-xl border border-white/10 bg-slate-950 p-3 text-[13px] outline-none focus:border-cyan-300" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>

          <div className="mb-4 rounded-xl border border-white/10 bg-slate-950">
            <div className="border-b border-white/10 px-3 py-2 text-[12px] font-semibold text-slate-400">Dateien ({files.length})</div>
            <div className="max-h-40 overflow-auto">
              {files.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-slate-500">Noch keine Beweise hinzugefügt.</p>
              ) : (
                files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center gap-2 border-b border-white/5 px-3 py-2 last:border-0">
                    <span className="text-cyan-200">{fileIcon(file)}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px]">{file.name}</span>
                    <button className="text-slate-500 hover:text-red-300" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {status.type !== "idle" ? (
            <div className={`mb-4 flex items-start gap-2 rounded-xl p-3 text-[12px] ${status.type === "success" ? "bg-emerald-500/10 text-emerald-200" : status.type === "error" ? "bg-red-500/10 text-red-200" : "bg-cyan-500/10 text-cyan-200"}`}>
              {status.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{status.message}</span>
            </div>
          ) : null}

          <button className="h-11 w-full rounded-xl bg-cyan-400 text-[14px] font-bold text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.25)] hover:bg-cyan-300 disabled:opacity-50" disabled={status.type === "saving"} onClick={submit}>
            Beweis sichern
          </button>
        </aside>
      </div>
    </FurrWindow>
  );
}
