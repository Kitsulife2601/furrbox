// VRChat location strings, e.g. "wrld_x:12345~group(grp_y)~groupAccessType(plus)~region(eu)".

export const VRC_REGION: Record<string, string> = { us: "USA West", use: "USA Ost", eu: "Europa", jp: "Japan" };
export const VRC_ACCESS: Record<string, string> = { public: "Gruppe öffentlich", plus: "Gruppe+", members: "Nur Gruppe" };

export function parseLocation(location: string) {
  const region = /~region\(([^)]+)\)/.exec(location)?.[1] ?? "us";
  const access = /~groupAccessType\(([^)]+)\)/.exec(location)?.[1] ?? "members";
  const [worldId, rest = ""] = location.split(":");
  return { worldId, instanceName: rest.split("~")[0] ?? "", region, access };
}

export const MOD_ACTION_LABEL: Record<string, string> = {
  warn: "Verwarnung",
  mute: "Stummschaltung",
  timeout: "Timeout",
  kick: "Kick",
  remove: "Aus Gruppe entfernt",
  ban: "Bann",
  unban: "Entbannung",
};

/** Moderation kind of a VRChat group audit event ("group.instance.warn" -> "warn"), or null. */
export function vrchatAuditKind(eventType: string): string | null {
  const t = eventType.toLowerCase();
  if (t.includes("unban")) return "unban";
  if (t.includes("ban")) return "ban";
  if (t.includes("warn")) return "warn";
  if (t.includes("mute")) return "mute";
  if (t.includes("kick")) return "kick";
  if (t === "group.member.remove") return "remove";
  return null;
}

/** German label for moderation audit events, null for everything else (joins, role changes, …). */
export function vrchatAuditAction(eventType: string): string | null {
  const kind = vrchatAuditKind(eventType);
  return kind ? MOD_ACTION_LABEL[kind] : null;
}
