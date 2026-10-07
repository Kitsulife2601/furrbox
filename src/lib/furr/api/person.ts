// Personenakte: everything FurrBox knows about one person in one place – cases, sanctions,
// moderation on Discord and in VRChat, the watchlist entry and the last sightings.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { getSql, iso, requirePermission } from "../core";
import { EVIDENCE_ROOT, sanitizeSegment } from "../paths";
import type { CaseStatus } from "../types";

export type PersonRef = { name: string; discordId: string | null; usrId: string | null };
export type PersonHit = PersonRef & { key: string; hint: string };

export type PersonEvent = {
  id: string;
  at: string;
  platform: "Discord" | "VRChat";
  /** ban | kick | timeout | mute | warn | unban | sighting | … */
  kind: string;
  /** Who did it (empty for sightings). */
  by: string;
  text: string;
  failed: boolean;
};

export type PersonFile = {
  person: PersonRef;
  cases: { path: string; platform: string; caseId: string; createdAt: string; status: CaseStatus; assigneeName: string | null; note: string | null }[];
  sanctions: { id: string; platform: string; type: string; reason: string; createdAt: string; expiresAt: string | null; active: boolean }[];
  watch: { usrId: string; note: string; addedAt: string } | null;
  flags: { kind: string; score: number; detail: string | null }[];
  events: PersonEvent[];
};

const USR = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["open", "working", "waiting", "done"];
const CASE_FOLDERS = [`${EVIDENCE_ROOT}/Discord`, `${EVIDENCE_ROOT}/VRChat`];
/** Case folders are "<name>_<timestamp>" – this cuts the timestamp off again. */
const CASE_NAME = `regexp_replace(f.name, '_[0-9]{4}-[0-9]{2}-[0-9]{2}T.*$', '')`;

/** Finds people by name or id across everything the team has written down. */
export const searchPeople = createServerFn({ method: "GET" })
  .validator((input: { q: string }) => ({ q: String(input?.q ?? "").trim().slice(0, 80) }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<PersonHit[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    if (data.q.length < 2) return [];
    const sql = await getSql();
    const q = data.q;
    const [members, watched, sanctions, vrc, cases] = await Promise.all([
      sql.query<{ discord_id: string; name: string; username: string }>(
        `select discord_id, coalesce(nickname, display_name) as name, username from discord_member
         where discord_id = $1 or position(lower($1) in lower(coalesce(nickname, '') || ' ' || display_name || ' ' || username)) > 0
         order by display_name limit 15`,
        [q],
      ),
      sql.query<{ usr_id: string; display_name: string | null }>(
        `select usr_id, display_name from watchlist_entry
         where usr_id = $1 or position(lower($1) in lower(coalesce(display_name, ''))) > 0 limit 15`,
        [q],
      ),
      sql.query<{ platform: string; target_id: string; target_name: string | null }>(
        `select distinct on (platform, target_id) platform, target_id, target_name from mod_sanction
         where target_id is not null and (target_id = $1 or position(lower($1) in lower(coalesce(target_name, ''))) > 0)
         order by platform, target_id, created_at desc limit 15`,
        [q],
      ),
      sql.query<{ target_user_id: string; target_name: string | null }>(
        `select distinct on (target_user_id) target_user_id, target_name from vrchat_moderation
         where target_user_id = $1 or position(lower($1) in lower(coalesce(target_name, ''))) > 0
         order by target_user_id, created_at desc limit 15`,
        [q],
      ),
      sql.query<{ name: string; target_id: string | null; target_name: string | null; n: number }>(
        `select ${CASE_NAME} as name, max(m.target_id) as target_id, max(m.target_name) as target_name, count(*)::int as n
         from furr_file f left join evidence_case_meta m on m.case_path = f.folder || '/' || f.name
         where f.scope = 'public' and f.owner_id is null and f.is_folder = true and f.folder in ($2, $3)
           and (m.target_id = $1 or position(lower($1) in lower(f.name || ' ' || coalesce(m.target_name, ''))) > 0)
         group by 1 order by max(f.created_at) desc limit 15`,
        [q, ...CASE_FOLDERS],
      ),
    ]);

    const hits = new Map<string, PersonHit>();
    const add = (ref: PersonRef, hint: string) => {
      const key = ref.discordId ? `d:${ref.discordId}` : ref.usrId ? `v:${ref.usrId}` : `n:${sanitizeSegment(ref.name).toLowerCase()}`;
      const known = hits.get(key);
      if (known) {
        if (!known.hint.includes(hint)) known.hint += ` · ${hint}`;
      } else hits.set(key, { ...ref, key, hint });
    };
    for (const m of members) add({ name: m.name, discordId: m.discord_id, usrId: null }, `Discord @${m.username}`);
    for (const s of sanctions) {
      const vr = s.platform === "vrchat";
      add({ name: s.target_name || s.target_id, discordId: vr ? null : s.target_id, usrId: vr ? s.target_id : null }, "Strafe");
    }
    for (const w of watched) add({ name: w.display_name || w.usr_id, discordId: null, usrId: w.usr_id }, "Watchlist");
    for (const v of vrc) add({ name: v.target_name || v.target_user_id, discordId: null, usrId: v.target_user_id }, "VRChat");
    for (const c of cases) {
      const label = `${c.n} ${c.n === 1 ? "Fall" : "Fälle"}`;
      // A case of someone already found (same id or same name) only adds the hint.
      const seg = c.name.toLowerCase();
      const same = [...hits.values()].find(
        (h) => (c.target_id && (h.discordId === c.target_id || h.usrId === c.target_id)) || sanitizeSegment(h.name).toLowerCase() === seg,
      );
      if (same) same.hint += ` · ${label}`;
      else {
        const id = c.target_id;
        add({ name: c.target_name || c.name.replace(/_/g, " "), discordId: id && !USR.test(id) ? id : null, usrId: id && USR.test(id) ? id : null }, label);
      }
    }
    return [...hits.values()].slice(0, 30);
  });

export const getPersonFile = createServerFn({ method: "GET" })
  .validator((input: PersonRef) => ({
    name: String(input?.name ?? "").trim().slice(0, 200),
    discordId: input?.discordId ? String(input.discordId).trim().slice(0, 40) : null,
    usrId: input?.usrId && USR.test(String(input.usrId).trim()) ? String(input.usrId).trim() : null,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<PersonFile> => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!data.name && !data.discordId && !data.usrId) throw new Error("Keine Person angegeben.");
    const sql = await getSql();
    const name = data.name.toLowerCase();
    // An id as "name" must not match by name.
    const byName = name && name !== data.discordId && name !== data.usrId?.toLowerCase() ? name : null;
    const seg = byName ? sanitizeSegment(data.name).toLowerCase() : null;

    const [cases, sanctions, discord, vrc, audit, watch, flags] = await Promise.all([
      sql.query<{
        folder: string;
        name: string;
        created_at: unknown;
        status: string | null;
        assignee_name: string | null;
        note: string | null;
      }>(
        `select f.folder, f.name, f.created_at, m.status, p.display_name as assignee_name, m.note
         from furr_file f
         left join evidence_case_meta m on m.case_path = f.folder || '/' || f.name
         left join furr_profile p on p.user_id = m.assignee_id
         where f.scope = 'public' and f.owner_id is null and f.is_folder = true and f.folder in ($5, $6)
           and (m.target_id in ($1, $2) or lower(m.target_name) = $3 or lower(${CASE_NAME}) = $4)
         order by f.created_at desc limit 50`,
        [data.discordId, data.usrId, byName, seg, ...CASE_FOLDERS],
      ),
      sql.query<{ id: string; platform: string; type: string | null; reason: string; created_at: unknown; expires_at: unknown; active: boolean }>(
        `select id, platform, type, reason, created_at, expires_at, active from mod_sanction
         where target_id in ($1, $2) or lower(target_name) = $3
         order by created_at desc limit 50`,
        [data.discordId, data.usrId, byName],
      ),
      sql.query<{ id: string; action: string; reason: string; status: string; moderator: string | null; created_at: unknown }>(
        `select m.id, m.action, m.reason, m.status, p.display_name as moderator, m.created_at
         from moderation_request m left join furr_profile p on p.user_id = m.moderator_user_id
         where m.target_discord_id = $1 order by m.created_at desc limit 50`,
        [data.discordId],
      ),
      sql.query<{ id: string; action: string; reason: string; status: string; moderator: string | null; target_user_id: string; created_at: unknown }>(
        `select m.id, m.action, m.reason, m.status, p.display_name as moderator, m.target_user_id, m.created_at
         from vrchat_moderation m left join furr_profile p on p.user_id = m.moderator_user_id
         where m.target_user_id = $1 or lower(m.target_name) = $2 order by m.created_at desc limit 50`,
        [data.usrId, byName],
      ),
      sql.query<{ id: string; event_type: string; description: string | null; actor_name: string | null; created_at: unknown }>(
        `select id, event_type, description, actor_name, created_at from vrchat_audit
         where target_id = $1 order by created_at desc limit 30`,
        [data.usrId],
      ),
      sql.query<{ usr_id: string; note: string; created_at: unknown }>(
        `select usr_id, note, created_at from watchlist_entry where usr_id = $1 or lower(display_name) = $2 limit 1`,
        [data.usrId, byName],
      ),
      sql.query<{ kind: string; score: number; detail: string | null }>(
        `select kind, score, detail from anti_troll_flag where target_key in ($1, $2) order by updated_at desc limit 10`,
        [data.discordId, data.usrId],
      ),
    ]);

    // The usr_ id may only turn up through a name match – use it for the sightings too.
    const usrId = data.usrId ?? watch[0]?.usr_id ?? vrc[0]?.target_user_id ?? null;
    const sightings = usrId
      ? await sql.query<{ id: string; kind: string; world: string | null; hopping: boolean; seen_at: unknown }>(
          `select id, kind, world, hopping, seen_at from watchlist_sighting where usr_id = $1 order by seen_at desc limit 15`,
          [usrId],
        )
      : [];

    const events: PersonEvent[] = [
      ...discord.map((r) => ({
        id: `dc-${r.id}`,
        at: iso(r.created_at) ?? "",
        platform: "Discord" as const,
        kind: r.action,
        by: r.moderator ?? "Unbekannt",
        text: r.reason,
        failed: r.status === "failed",
      })),
      ...vrc.map((r) => ({
        id: `vf-${r.id}`,
        at: iso(r.created_at) ?? "",
        platform: "VRChat" as const,
        kind: r.action,
        by: r.moderator ?? "Unbekannt",
        text: r.reason,
        failed: r.status !== "success",
      })),
      ...audit.map((r) => ({
        id: `va-${r.id}`,
        at: iso(r.created_at) ?? "",
        platform: "VRChat" as const,
        kind: r.event_type,
        by: r.actor_name ?? "VRChat",
        text: r.description ?? "",
        failed: false,
      })),
      ...sightings.map((r) => ({
        id: `ws-${r.id}`,
        at: iso(r.seen_at) ?? "",
        platform: "VRChat" as const,
        kind: "sighting",
        by: "",
        text: `${r.kind === "leave" ? "Gegangen" : r.kind === "rejoin" ? "Wieder da" : "Gesehen"}${r.world ? ` in ${r.world}` : ""}${r.hopping ? " (wechselt schnell die Instanz)" : ""}`,
        failed: false,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const now = Date.now();
    return {
      person: { name: data.name, discordId: data.discordId, usrId },
      cases: cases.map((r) => ({
        path: `${r.folder}/${r.name}`,
        platform: r.folder.split("/").pop() ?? "",
        caseId: r.name,
        createdAt: iso(r.created_at) ?? "",
        status: (STATUSES.includes(r.status ?? "") ? r.status : "open") as CaseStatus,
        assigneeName: r.assignee_name,
        note: r.note,
      })),
      sanctions: sanctions.map((r) => {
        const expiresAt = iso(r.expires_at);
        return {
          id: r.id,
          platform: r.platform,
          type: r.type ?? "",
          reason: r.reason,
          createdAt: iso(r.created_at) ?? "",
          expiresAt,
          active: Boolean(r.active) && (!expiresAt || Date.parse(expiresAt) > now),
        };
      }),
      watch: watch[0] ? { usrId: watch[0].usr_id, note: watch[0].note, addedAt: iso(watch[0].created_at) ?? "" } : null,
      flags: flags.map((f) => ({ kind: f.kind, score: Number(f.score) || 0, detail: f.detail })),
      events,
    };
  });
