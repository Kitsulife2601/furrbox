// FurrVRChat: link a VRChat group – open group instances (world, players, region) and
// group moderation (kick / ban / unban), logged like the Discord moderation.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendTextFile, getSql, iso, loadMe, newId, notify, requirePermission } from "../core";
import { AUDIT_LOG_NAME, VRCHAT_LOGS } from "../paths";

export type VrchatGroupInfo = {
  id: string;
  name: string;
  code: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number;
  onlineMemberCount: number;
};

export type VrchatStatus = {
  connected: boolean;
  pending2fa: string[] | null;
  accountName: string | null;
  groupId: string | null;
  group: VrchatGroupInfo | null;
  lastError: string | null;
};

export type VrchatInstance = {
  instanceId: string;
  location: string;
  worldName: string;
  worldImage: string | null;
  capacity: number;
  memberCount: number;
  region: string;
  access: string;
  openedAt: string;
  joinUrl: string;
};

export type VrchatModerationEntry = {
  id: string;
  action: string;
  targetUserId: string;
  targetName: string | null;
  reason: string;
  moderatorName: string;
  status: string;
  error: string | null;
  createdAt: string;
};

type Conn = {
  auth_cookie: string | null;
  two_factor_cookie: string | null;
  pending_cookie: string | null;
  pending_methods: string | null;
  account_name: string | null;
  group_id: string | null;
  group_json: string | null;
  group_fetched_at: unknown;
  instances_fetched_at: unknown;
  last_error: string | null;
};

const GROUP_ID = /^grp_[0-9a-f-]{36}$/i;
const USER_ID = /^usr_[0-9a-f-]{36}$/i;
const INSTANCE_REFRESH_MS = 45_000;
const GROUP_REFRESH_MS = 5 * 60_000;

async function conn(): Promise<Conn | null> {
  const sql = await getSql();
  const rows = await sql<Conn>`
    select auth_cookie, two_factor_cookie, pending_cookie, pending_methods, account_name, group_id, group_json,
           group_fetched_at, instances_fetched_at, last_error
    from vrchat_connection where id = 1`;
  return rows[0] ?? null;
}

function cookiesOf(c: Conn | null) {
  return c?.auth_cookie ? { auth: c.auth_cookie, twoFactor: c.two_factor_cookie } : null;
}

async function recordError(message: string | null) {
  const sql = await getSql();
  await sql`update vrchat_connection set last_error = ${message} where id = 1`;
}

/** Runs a VRChat call; an expired login is reported once and clears the stored cookies. */
async function withVrc<T>(fn: () => Promise<T>): Promise<T> {
  const { VrcError } = await import("../vrchat.server");
  try {
    const result = await fn();
    return result;
  } catch (error) {
    if (error instanceof VrcError && error.status === 401) {
      // Only drop the stored login if VRChat confirms it is really gone.
      const { vrcCurrentUser } = await import("../vrchat.server");
      const c = await conn();
      const cookies = cookiesOf(c);
      const stillValid = cookies ? await vrcCurrentUser(cookies).then(() => true, () => false) : false;
      if (stillValid) throw new Error(`VRChat hat die Anfrage abgelehnt: ${error.message}`);
      const sql = await getSql();
      await sql`update vrchat_connection set auth_cookie = null, two_factor_cookie = null where id = 1`;
      await recordError(`Die VRChat-Anmeldung ist abgelaufen (${error.message}). Bitte neu verbinden.`);
      throw new Error(`Die VRChat-Anmeldung ist abgelaufen (${error.message}). Der Owner muss VRChat neu verbinden.`);
    }
    throw error;
  }
}

function age(value: unknown) {
  const at = iso(value);
  return at ? Date.now() - new Date(at).getTime() : Number.POSITIVE_INFINITY;
}

export const getVrchatStatus = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<VrchatStatus> => {
    await requirePermission(context.userId, "canUseEvidence");
    let c = await conn();
    const cookies = cookiesOf(c);
    if (cookies && c?.group_id && age(c.group_fetched_at) > GROUP_REFRESH_MS) {
      try {
        const { vrcGroup } = await import("../vrchat.server");
        const g = await withVrc(() => vrcGroup(cookies, c!.group_id!));
        const sql = await getSql();
        await sql`update vrchat_connection set group_json = ${JSON.stringify(g)}, group_fetched_at = now(), last_error = null where id = 1`;
        c = await conn();
      } catch (error) {
        await recordError(error instanceof Error ? error.message : String(error));
        c = await conn();
      }
    }
    let group: VrchatGroupInfo | null = null;
    if (c?.group_json) {
      const g = JSON.parse(c.group_json) as Record<string, unknown>;
      group = {
        id: String(g.id),
        name: String(g.name),
        code: g.shortCode ? `${g.shortCode}.${g.discriminator}` : "",
        iconUrl: (g.iconUrl as string) ?? null,
        bannerUrl: (g.bannerUrl as string) ?? null,
        memberCount: Number(g.memberCount ?? 0),
        onlineMemberCount: Number(g.onlineMemberCount ?? 0),
      };
    }
    return {
      connected: Boolean(c?.auth_cookie),
      pending2fa: c?.pending_cookie && c.pending_methods ? (JSON.parse(c.pending_methods) as string[]) : null,
      accountName: c?.account_name ?? null,
      groupId: c?.group_id ?? null,
      group,
      lastError: c?.last_error ?? null,
    };
  });

/** Owner: connect a VRChat account. Returns whether a 2FA code is needed next. */
export const vrchatLogin = createServerFn({ method: "POST" })
  .validator((input: { username: string; password: string; code?: string }) => ({
    username: String(input.username ?? "").trim(),
    password: String(input.password ?? ""),
    code: String(input.code ?? "").replace(/\s+/g, ""),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageVrchat");
    if (!data.username || !data.password) throw new Error("Bitte VRChat-Nutzername und Passwort eingeben.");
    const { vrcLogin, vrcVerify2fa } = await import("../vrchat.server");
    const result = await vrcLogin(data.username, data.password);
    const sql = await getSql();
    await sql`insert into vrchat_connection (id) values (1) on conflict (id) do nothing`;
    // Authenticator code given together with the password: verify right away in the same
    // request, so VRChat sees login and 2FA from the same server.
    if (result.step === "2fa" && data.code && !result.methods.includes("emailOtp")) {
      const method = data.code.length > 6 ? "otp" : "totp";
      const verified = await vrcVerify2fa(result.pendingAuth, method, data.code);
      await sql`
        update vrchat_connection set auth_cookie = ${verified.cookies.auth}, two_factor_cookie = ${verified.cookies.twoFactor ?? null},
          pending_cookie = null, pending_methods = null, account_id = ${verified.userId}, account_name = ${verified.displayName},
          connected_by = ${context.userId}, connected_at = now(), last_error = null, group_fetched_at = null
        where id = 1`;
      return { step: "done" as const, methods: [] as string[] };
    }
    if (result.step === "2fa") {
      await sql`
        update vrchat_connection set pending_cookie = ${result.pendingAuth}, pending_methods = ${JSON.stringify(result.methods)}
        where id = 1`;
      return { step: "2fa" as const, methods: result.methods };
    }
    await sql`
      update vrchat_connection set auth_cookie = ${result.cookies.auth}, two_factor_cookie = null, pending_cookie = null,
        pending_methods = null, account_id = ${result.userId}, account_name = ${result.displayName},
        connected_by = ${context.userId}, connected_at = now(), last_error = null, group_fetched_at = null
      where id = 1`;
    return { step: "done" as const, methods: [] as string[] };
  });

export const vrchatVerify2fa = createServerFn({ method: "POST" })
  .validator((code: string) => String(code ?? "").replace(/\s+/g, ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: code }) => {
    await requirePermission(context.userId, "canManageVrchat");
    const c = await conn();
    if (!c?.pending_cookie || !c.pending_methods) throw new Error("Bitte zuerst mit Nutzername und Passwort anmelden.");
    const methods = JSON.parse(c.pending_methods) as string[];
    const method = methods.includes("emailOtp") ? "emailOtp" : code.length > 6 ? "otp" : "totp";
    const { vrcVerify2fa } = await import("../vrchat.server");
    const result = await vrcVerify2fa(c.pending_cookie, method, code);
    const sql = await getSql();
    await sql`
      update vrchat_connection set auth_cookie = ${result.cookies.auth}, two_factor_cookie = ${result.cookies.twoFactor ?? null},
        pending_cookie = null, pending_methods = null, account_id = ${result.userId}, account_name = ${result.displayName},
        connected_by = ${context.userId}, connected_at = now(), last_error = null, group_fetched_at = null
      where id = 1`;
    return { ok: true };
  });

/** Owner: set the VRChat group – short code ("FLS.0227"), id ("grp_…") or a vrchat.com group link. */
export const setVrchatGroup = createServerFn({ method: "POST" })
  .validator((input: string) => {
    const raw = String(input ?? "").trim();
    const id = /grp_[0-9a-f-]{36}/i.exec(raw)?.[0];
    if (id && GROUP_ID.test(id)) return id.toLowerCase();
    const code = /([A-Za-z0-9]{3,6})\.(\d{4})/.exec(raw);
    if (code) return `${code[1].toUpperCase()}.${code[2]}`;
    throw new Error("Bitte das Gruppen-Kürzel (z. B. FLS.0227), die Gruppen-ID (grp_…) oder den Gruppen-Link eingeben.");
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data: input }) => {
    await requirePermission(context.userId, "canManageVrchat");
    const cookies = cookiesOf(await conn());
    if (!cookies) throw new Error("Bitte zuerst ein VRChat-Konto verbinden.");
    const { vrcFindGroupByCode, vrcGroup } = await import("../vrchat.server");
    const groupId = GROUP_ID.test(input) ? input : await withVrc(() => vrcFindGroupByCode(cookies, input));
    if (!groupId) throw new Error(`Keine VRChat-Gruppe mit dem Kürzel ${input} gefunden.`);
    const g = await withVrc(() => vrcGroup(cookies, groupId));
    const sql = await getSql();
    await sql`
      update vrchat_connection set group_id = ${groupId}, group_json = ${JSON.stringify(g)}, group_fetched_at = now(),
        instances_fetched_at = null, last_error = null
      where id = 1`;
    await sql`delete from vrchat_instance`;
    return { name: g.name };
  });

export const disconnectVrchat = createServerFn({ method: "POST" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canManageVrchat");
    const sql = await getSql();
    await sql`
      update vrchat_connection set auth_cookie = null, two_factor_cookie = null, pending_cookie = null, pending_methods = null,
        account_id = null, account_name = null, last_error = null
      where id = 1`;
    return { ok: true };
  });

const REGION: Record<string, string> = { us: "USA West", use: "USA Ost", eu: "Europa", jp: "Japan" };
const ACCESS: Record<string, string> = { public: "Gruppe öffentlich", plus: "Gruppe+", members: "Nur Gruppe" };

/**
 * Refreshes the cached group instances (at most every 45 s, whoever asks first) and announces
 * newly opened instances to the team.
 */
async function refreshInstances() {
  const c = await conn();
  const cookies = cookiesOf(c);
  if (!cookies || !c?.group_id) return;
  if (age(c.instances_fetched_at) < INSTANCE_REFRESH_MS) return;
  const sql = await getSql();
  // Claim this refresh so parallel requests don't all hit VRChat.
  await sql`update vrchat_connection set instances_fetched_at = now() where id = 1`;
  const { parseLocation, vrcGroupInstances } = await import("../vrchat.server");
  let instances;
  try {
    instances = await withVrc(() => vrcGroupInstances(cookies, c.group_id!));
  } catch (error) {
    await recordError(error instanceof Error ? error.message : String(error));
    return;
  }
  const open = await sql<{ instance_id: string }>`select instance_id from vrchat_instance where closed_at is null`;
  const known = new Set(open.map((r) => r.instance_id));
  for (const i of instances) {
    const loc = parseLocation(i.location);
    const isNew = !known.has(i.instanceId);
    await sql`
      insert into vrchat_instance (instance_id, location, world_id, world_name, world_image, capacity, member_count, region, access_type)
      values (${i.instanceId}, ${i.location}, ${i.world.id}, ${i.world.name}, ${i.world.image}, ${i.world.capacity},
              ${i.memberCount}, ${loc.region}, ${loc.access})
      on conflict (instance_id) do update set
        location = excluded.location, world_name = excluded.world_name, world_image = excluded.world_image,
        capacity = excluded.capacity, member_count = excluded.member_count, last_seen = now(), closed_at = null,
        first_seen = case when vrchat_instance.closed_at is not null then now() else vrchat_instance.first_seen end`;
    if (isNew) {
      await notify(
        "VRChat-Instanz geöffnet",
        `${i.world.name} · ${REGION[loc.region] ?? loc.region} · ${ACCESS[loc.access] ?? loc.access} · ${i.memberCount} ${i.memberCount === 1 ? "Person" : "Personen"}`,
      );
    }
  }
  const current = instances.map((i) => i.instanceId);
  await sql.query(
    `update vrchat_instance set closed_at = now() where closed_at is null and not (instance_id = any($1::text[]))`,
    [current],
  );
  await recordError(null);
}

/** Open group instances (cached). */
export const listVrchatInstances = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canUseEvidence");
    await refreshInstances();
    const sql = await getSql();
    const rows = await sql<{
      instance_id: string;
      location: string;
      world_id: string | null;
      world_name: string | null;
      world_image: string | null;
      capacity: number | null;
      member_count: number;
      region: string | null;
      access_type: string | null;
      first_seen: unknown;
    }>`
      select instance_id, location, world_id, world_name, world_image, capacity, member_count, region, access_type, first_seen
      from vrchat_instance where closed_at is null order by member_count desc, first_seen`;
    const c = await conn();
    return {
      updatedAt: iso(c?.instances_fetched_at),
      instances: rows.map(
        (r): VrchatInstance => {
          const [worldId, instanceId = ""] = r.location.split(":");
          return {
            instanceId: r.instance_id,
            location: r.location,
            worldName: r.world_name ?? "Unbekannte Welt",
            worldImage: r.world_image,
            capacity: Number(r.capacity ?? 0),
            memberCount: Number(r.member_count ?? 0),
            region: REGION[r.region ?? ""] ?? (r.region ?? "").toUpperCase(),
            access: ACCESS[r.access_type ?? ""] ?? (r.access_type ?? ""),
            openedAt: iso(r.first_seen) ?? new Date().toISOString(),
            joinUrl: `https://vrchat.com/home/launch?worldId=${encodeURIComponent(r.world_id ?? worldId)}&instanceId=${encodeURIComponent(instanceId)}`,
          };
        },
      ),
    };
  });

/** Lightweight background check (called by every open FurrBox) so new instances get announced. */
export const vrchatTick = createServerFn({ method: "POST" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    const me = await loadMe(context.userId);
    if (!me.permissions.isTeam) return { ok: false };
    await refreshInstances();
    return { ok: true };
  });

export const searchVrchatUsers = createServerFn({ method: "GET" })
  .validator((query: string) => String(query ?? "").trim().slice(0, 60))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: query }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (query.length < 2) return [];
    const cookies = cookiesOf(await conn());
    if (!cookies) throw new Error("VRChat ist noch nicht verbunden.");
    const { vrcSearchUsers } = await import("../vrchat.server");
    return withVrc(() => vrcSearchUsers(cookies, query));
  });

const ACTION_LABEL: Record<string, string> = { kick: "Kick", ban: "Bann", unban: "Entbannung" };

/** Moderator+: kick / ban / unban someone in the VRChat group. */
export const vrchatModerate = createServerFn({ method: "POST" })
  .validator((input: { action: "kick" | "ban" | "unban"; userId: string; userName?: string; reason: string }) => ({
    action: (["kick", "ban", "unban"].includes(input.action) ? input.action : "kick") as "kick" | "ban" | "unban",
    userId: String(input.userId ?? "").trim(),
    userName: String(input.userName ?? "").trim().slice(0, 100),
    reason: String(input.reason ?? "").trim(),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canModerateVrchat");
    if (!USER_ID.test(data.userId)) throw new Error("Bitte eine VRChat-Person auswählen (ID beginnt mit usr_).");
    if (data.reason.length < 3) throw new Error("Bitte einen Grund angeben (mindestens 3 Zeichen).");
    const c = await conn();
    const cookies = cookiesOf(c);
    if (!cookies || !c?.group_id) throw new Error("VRChat-Gruppe ist noch nicht verbunden.");
    const { vrcBan, vrcKick, vrcUnban } = await import("../vrchat.server");
    let status = "success";
    let error: string | null = null;
    try {
      await withVrc(() =>
        data.action === "ban"
          ? vrcBan(cookies, c.group_id!, data.userId)
          : data.action === "unban"
            ? vrcUnban(cookies, c.group_id!, data.userId)
            : vrcKick(cookies, c.group_id!, data.userId),
      );
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    }
    const sql = await getSql();
    await sql`
      insert into vrchat_moderation (id, action, target_user_id, target_name, reason, moderator_user_id, status, error)
      values (${newId()}, ${data.action}, ${data.userId}, ${data.userName || null}, ${data.reason}, ${context.userId}, ${status}, ${error})`;
    const block = [
      "------------------------------------------------------------",
      `Datum: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
      `Plattform: VRChat (Gruppe)`,
      `Status: ${status === "success" ? "ERFOLGREICH" : "FEHLGESCHLAGEN"}`,
      `Aktion: ${ACTION_LABEL[data.action]}`,
      `Moderator: ${me.displayName} (${me.roleLabel})`,
      `Ziel: ${data.userName || data.userId} (${data.userId})`,
      "Grund:",
      data.reason,
      error ? `Fehler: ${error}` : "",
      "------------------------------------------------------------",
      "",
    ]
      .filter(Boolean)
      .join("\r\n");
    await appendTextFile("public", `${VRCHAT_LOGS}/${AUDIT_LOG_NAME}`, `${block}\r\n`, context.userId);
    await notify(
      `VRChat: ${ACTION_LABEL[data.action]} ${status === "success" ? "ausgeführt" : "fehlgeschlagen"}`,
      `${data.userName || data.userId} – von ${me.displayName}${error ? ` (${error})` : ""}`,
    );
    if (error) throw new Error(error);
    return { ok: true };
  });

export const listVrchatModeration = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<VrchatModerationEntry[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      action: string;
      target_user_id: string;
      target_name: string | null;
      reason: string;
      moderator_name: string | null;
      status: string;
      error: string | null;
      created_at: unknown;
    }>`
      select m.id, m.action, m.target_user_id, m.target_name, m.reason, p.display_name as moderator_name, m.status, m.error, m.created_at
      from vrchat_moderation m left join furr_profile p on p.user_id = m.moderator_user_id
      order by m.created_at desc limit 50`;
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetUserId: r.target_user_id,
      targetName: r.target_name,
      reason: r.reason,
      moderatorName: r.moderator_name ?? "Unbekannt",
      status: r.status,
      error: r.error,
      createdAt: iso(r.created_at) ?? "",
    }));
  });
