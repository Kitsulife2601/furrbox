// VRChat part of the FurrBox bot. VRChat ties a login to the internet address it came from, so
// the login has to live here on the always-on PC – not on Vercel, whose address keeps changing.
//
// - Executes VRChat jobs queued in FurrBox (login, 2FA, group, search, kick/ban/unban).
// - Watches the group's open instances every minute and pushes changes to FurrBox
//   (/api/bridge/vrchat-state), which announces newly opened instances to the team.
// - Keeps the login in vrchat-session.json next to this file (cookies only, never the password).
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.vrchat.cloud/api/1";
// VRChat asks API users to identify themselves with a descriptive User-Agent.
const USER_AGENT = "FurrBox/2.0 (+https://github.com/Kitsulife2601/furrbox)";
const SESSION_FILE = join(dirname(fileURLToPath(import.meta.url)), "vrchat-session.json");
// Intervals while someone has FurrBox open (active) / while nobody does (idle, set by index.mjs).
// New instances are still detected while idle (Discord announcement), just a bit later.
const WATCH_MS = 60_000;
const IDLE_WATCH_MS = 2 * 60_000;
const GROUP_REFRESH_MS = 5 * 60_000;
const IDLE_GROUP_REFRESH_MS = 15 * 60_000;
const STATE_HEARTBEAT_MS = 10 * 60_000;
const IDLE_STATE_HEARTBEAT_MS = 30 * 60_000;
// Moderation done in VRChat should show up in FurrBox right away – the audit log is cheap to read
// and FurrBox is only contacted when there is something new. While idle nobody looks, and nothing
// is lost (auditSince), so it is read less often.
const AUDIT_MS = 10_000;
const IDLE_AUDIT_MS = 5 * 60_000;

class VrcError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let session = loadSession(); // { auth, twoFactor, groupId, accountId, accountName }
let pending = null; // { auth, methods } while a 2FA code is awaited
let group = null;
let groupFetchedAt = 0;
let lastSignature = "";
let lastPushAt = 0;
let lastError = null;
let bridge = null;
let auditAt = 0;
let auditError = null;
const auditSeen = new Set();
let log = console.log;
let active = false;
let started = false;
let watchTimer = null;
let watchBusy = false;
let auditTimer = null;
let auditBusy = false;

function loadSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSession() {
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

function cookieHeader(auth, twoFactor) {
  return [`auth=${auth}`, twoFactor ? `twoFactorAuth=${twoFactor}` : ""].filter(Boolean).join("; ");
}

function readCookie(res, name) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (pair.slice(0, idx).trim() === name) return pair.slice(idx + 1).trim() || null;
  }
  return null;
}

async function call(path, { method = "GET", body, auth, twoFactor, basic } = {}) {
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) headers.Cookie = cookieHeader(auth, twoFactor);
  if (basic) headers.Authorization = `Basic ${basic}`;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err?.code || err?.cause?.code || err?.name || "";
    throw new VrcError(`VRChat-Netzwerkfehler (${code || msg}).`, 0);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.error?.message?.replace(/^"|"$/g, "") || `VRChat antwortet mit Fehler ${res.status}.`;
    throw new VrcError(msg, res.status);
  }
  return { res, json };
}

/** Calls VRChat with the saved login; an invalid login is cleared and reported. */
async function authed(path, opts = {}) {
  if (!session.auth) throw new VrcError("VRChat ist nicht angemeldet.", 401);
  try {
    return await call(path, { ...opts, auth: session.auth, twoFactor: session.twoFactor });
  } catch (err) {
    if (err instanceof VrcError && err.status === 401) {
      session = { groupId: session.groupId };
      saveSession();
      lastError = "Die VRChat-Anmeldung ist abgelaufen. Bitte in FurrBox neu verbinden.";
      log("VRChat: Anmeldung abgelaufen.");
      await pushState(true).catch(() => undefined);
    }
    throw err;
  }
}

async function currentUser(auth, twoFactor) {
  const { json } = await call("/auth/user", { auth, twoFactor });
  if (!json?.id) throw new VrcError("VRChat verlangt noch eine Bestätigung (2FA).", 401);
  return { id: json.id, displayName: json.displayName ?? "" };
}

async function finishLogin(auth, twoFactor) {
  const me = await currentUser(auth, twoFactor);
  session = { ...session, auth, twoFactor: twoFactor ?? null, accountId: me.id, accountName: me.displayName };
  pending = null;
  lastError = null;
  saveSession();
  log(`VRChat: angemeldet als ${me.displayName}.`);
  await refresh(true);
  return { done: true, displayName: me.displayName };
}

async function verify(auth, method, code) {
  const path =
    method === "emailOtp"
      ? "/auth/twofactorauth/emailotp/verify"
      : method === "otp"
        ? "/auth/twofactorauth/otp/verify"
        : "/auth/twofactorauth/totp/verify";
  const { res, json } = await call(path, { method: "POST", body: { code }, auth });
  if (!json?.verified) throw new VrcError("Der Code ist falsch oder abgelaufen.", 400);
  // VRChat may hand out a fresh auth cookie together with the 2FA cookie – keep the newest.
  return finishLogin(readCookie(res, "auth") ?? auth, readCookie(res, "twoFactorAuth"));
}

function mapGroup(g) {
  return {
    id: g.id,
    name: g.name ?? "VRChat-Gruppe",
    shortCode: g.shortCode ?? "",
    discriminator: g.discriminator ?? "",
    iconUrl: g.iconUrl || null,
    bannerUrl: g.bannerUrl || null,
    memberCount: Number(g.memberCount ?? 0),
    onlineMemberCount: Number(g.onlineMemberCount ?? 0),
  };
}

/**
 * The group list only says how many *group members* are in an instance. The real number of people
 * comes from the instance itself (one small request per open instance).
 */
async function realUserCount(location) {
  try {
    const { json } = await authed(`/instances/${location}`);
    const n = Number(json?.n_users ?? json?.userCount);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    // An expired login must still be noticed; anything else (no access, …) keeps the list's number.
    if (err instanceof VrcError && err.status === 401) throw err;
    return null;
  }
}

async function fetchInstances() {
  const { json } = await authed(`/groups/${encodeURIComponent(session.groupId)}/instances`);
  const list = (json ?? []).map((i) => ({
    instanceId: String(i.instanceId ?? i.location ?? ""),
    location: String(i.location ?? ""),
    memberCount: Number(i.memberCount ?? 0),
    world: {
      id: String(i.world?.id ?? String(i.location ?? "").split(":")[0]),
      name: String(i.world?.name ?? "Unbekannte Welt"),
      capacity: Number(i.world?.capacity ?? 0),
      image: i.world?.thumbnailImageUrl || i.world?.imageUrl || null,
    },
  }));
  for (const i of list.slice(0, 15)) {
    if (!i.location.includes(":")) continue;
    const n = await realUserCount(i.location);
    if (n !== null) i.memberCount = Math.max(n, i.memberCount);
  }
  return list;
}

/** Sends the current state to FurrBox – only when something changed (lets the database sleep). */
async function pushState(force = false, instances = null) {
  if (!bridge) return;
  // While idle only real changes count (instance opened/closed, login, errors) – player counts are
  // refreshed as soon as someone opens FurrBox again.
  const signature = JSON.stringify([
    session.accountName ?? null,
    session.groupId ?? null,
    active ? group?.memberCount : null,
    active ? group?.onlineMemberCount : null,
    lastError,
    instances?.map((i) => (active ? `${i.instanceId}:${i.memberCount}` : i.instanceId)).sort() ?? null,
  ]);
  const heartbeat = active ? STATE_HEARTBEAT_MS : IDLE_STATE_HEARTBEAT_MS;
  if (!force && signature === lastSignature && Date.now() - lastPushAt < heartbeat) return;
  await bridge("vrchat-state", {
    account: session.auth ? { id: session.accountId, displayName: session.accountName } : null,
    groupId: session.groupId ?? null,
    group: session.groupId ? group : null,
    instances: instances ?? undefined,
    error: lastError,
  });
  lastSignature = signature;
  lastPushAt = Date.now();
}

async function refresh(force = false) {
  if (!session.auth || !session.groupId) {
    if (force) await pushState(true);
    return;
  }
  try {
    if (force || !group || Date.now() - groupFetchedAt > (active ? GROUP_REFRESH_MS : IDLE_GROUP_REFRESH_MS)) {
      const { json } = await authed(`/groups/${encodeURIComponent(session.groupId)}`);
      group = mapGroup(json);
      groupFetchedAt = Date.now();
    }
    const instances = await fetchInstances();
    lastError = auditError;
    await pushState(force, instances);
    if (force) await syncAudit();
  } catch (err) {
    if (!(err instanceof VrcError && err.status === 401)) {
      lastError = `VRChat: ${err instanceof Error ? err.message : String(err)}`;
      await pushState(force).catch(() => undefined);
    }
  }
}

/**
 * Reads new entries of the group's audit log (warnings, kicks, bans … done in VRChat itself)
 * and hands them to FurrBox for the moderation log.
 */
async function syncAudit() {
  auditAt = Date.now();
  const since = session.auditSince ?? null;
  const params = new URLSearchParams({ n: "100" });
  if (since) params.set("startDate", since);
  let json;
  try {
    ({ json } = await authed(`/groups/${encodeURIComponent(session.groupId)}/auditLogs?${params}`));
  } catch (err) {
    if (err instanceof VrcError && err.status === 403) {
      auditError = "Das VRChat-Konto des Bots darf das Gruppen-Protokoll nicht sehen – gib seiner Gruppen-Rolle das Recht „Audit-Log anzeigen“.";
      return;
    }
    throw err;
  }
  auditError = null;
  // startDate is inclusive: skip what was already handed over.
  const entries = (json?.results ?? []).filter((e) => e?.id && !auditSeen.has(e.id) && (!since || e.created_at >= since));
  for (const e of json?.results ?? []) if (e?.id) auditSeen.add(e.id);
  if (entries.length) {
    await bridge("vrchat-audit", { entries, initial: !since });
    const newest = entries.map((e) => e.created_at).filter(Boolean).sort().pop();
    if (newest) {
      session.auditSince = newest;
      saveSession();
    }
  } else if (!since) {
    session.auditSince = new Date().toISOString();
    saveSession();
  }
}

async function findGroupId(input) {
  if (/^grp_[0-9a-f-]{36}$/i.test(input)) return input;
  const [short, disc] = input.split(".");
  const { json } = await authed(`/groups?query=${encodeURIComponent(input)}&n=20`);
  const hit = (json ?? []).find(
    (g) => String(g.shortCode ?? "").toLowerCase() === short.toLowerCase() && String(g.discriminator ?? "") === disc,
  );
  if (!hit) throw new Error(`Keine VRChat-Gruppe mit dem Kürzel ${input} gefunden.`);
  return hit.id;
}

const JOBS = {
  async login({ username, password, code }) {
    const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`).toString("base64");
    const { res, json } = await call("/auth/user", { basic });
    const auth = readCookie(res, "auth");
    if (!auth) throw new Error("VRChat hat kein Login-Token geschickt.");
    const methods = json?.requiresTwoFactorAuth ?? [];
    if (!methods.length) return finishLogin(auth, null);
    if (code && !methods.includes("emailOtp")) {
      try {
        return await verify(auth, code.length > 6 ? "otp" : "totp", code);
      } catch {
        // Code expired while the job was waiting – ask again.
      }
    }
    pending = { auth, methods };
    return { needs: methods.includes("emailOtp") ? "emailOtp" : "totp" };
  },
  async verify({ code }) {
    if (!pending) throw new Error("Bitte zuerst Nutzername und Passwort eingeben (der Bot wurde evtl. neu gestartet).");
    const method = pending.methods.includes("emailOtp") ? "emailOtp" : code.length > 6 ? "otp" : "totp";
    return verify(pending.auth, method, code);
  },
  async "set-group"({ group: input }) {
    const groupId = await findGroupId(input);
    const { json } = await authed(`/groups/${encodeURIComponent(groupId)}`);
    session.groupId = groupId;
    session.auditSince = null;
    saveSession();
    group = mapGroup(json);
    groupFetchedAt = Date.now();
    await refresh(true);
    return { name: group.name };
  },
  async logout() {
    if (session.auth) await call("/logout", { method: "PUT", auth: session.auth, twoFactor: session.twoFactor }).catch(() => undefined);
    session = {};
    group = null;
    pending = null;
    lastError = null;
    rmSync(SESSION_FILE, { force: true });
    await pushState(true);
    return { ok: true };
  },
  async search({ query }) {
    if (/^usr_[0-9a-f-]{36}$/i.test(query)) {
      const { json } = await authed(`/users/${encodeURIComponent(query)}`);
      return [{ id: json.id, displayName: json.displayName ?? query, image: json.userIcon || json.currentAvatarThumbnailImageUrl || null }];
    }
    const { json } = await authed(`/users?search=${encodeURIComponent(query)}&n=10`);
    return (json ?? []).map((u) => ({ id: u.id, displayName: u.displayName ?? "", image: u.userIcon || u.currentAvatarThumbnailImageUrl || null }));
  },
  /** Is this VRChat account a member of the connected group? (personal logins in FurrBox) */
  async "member-check"({ userId }) {
    if (!session.groupId) throw new Error("Es ist keine VRChat-Gruppe verbunden.");
    if (!/^usr_[0-9a-f-]{36}$/i.test(String(userId))) throw new Error("Ungültige VRChat-ID.");
    try {
      const { json } = await authed(`/groups/${encodeURIComponent(session.groupId)}/members/${encodeURIComponent(userId)}`);
      const status = json?.membershipStatus ?? "member";
      return { member: status === "member", status, groupName: group?.name ?? null };
    } catch (err) {
      if (err instanceof VrcError && err.status === 404) return { member: false, status: "none", groupName: group?.name ?? null };
      throw err;
    }
  },
  async moderate({ action, userId }) {
    if (!session.groupId) throw new Error("Es ist keine VRChat-Gruppe verbunden.");
    const g = encodeURIComponent(session.groupId);
    const u = encodeURIComponent(userId);
    if (action === "ban") await authed(`/groups/${g}/bans`, { method: "POST", body: { userId } });
    else if (action === "unban") await authed(`/groups/${g}/bans/${u}`, { method: "DELETE" });
    else await authed(`/groups/${g}/members/${u}`, { method: "DELETE" });
    return { ok: true };
  },
};

/** Executes VRChat jobs handed out by /api/bridge/queue and reports each result. */
export async function handleVrchatJobs(jobs) {
  for (const job of jobs ?? []) {
    const handler = JOBS[job.kind];
    let report;
    try {
      if (!handler) throw new Error(`Unbekannter Auftrag: ${job.kind}`);
      report = { jobId: job.jobId, ok: true, result: await handler(job.payload ?? {}) };
    } catch (err) {
      report = { jobId: job.jobId, ok: false, error: err instanceof Error ? err.message : String(err) };
      log(`VRChat-Auftrag ${job.kind} fehlgeschlagen:`, report.error);
    }
    await bridge("vrchat-result", report).catch((err) => log("VRChat-Ergebnis nicht gesendet:", err.message));
  }
}

function tick() {
  clearTimeout(watchTimer);
  watchTimer = null;
  if (watchBusy) return; // the running refresh schedules the next one
  watchBusy = true;
  refresh()
    .catch((err) => log("VRChat-Fehler:", err.message))
    .finally(() => {
      watchBusy = false;
      watchTimer = setTimeout(tick, active ? WATCH_MS : IDLE_WATCH_MS);
    });
}

function auditTick() {
  clearTimeout(auditTimer);
  auditTimer = null;
  if (auditBusy) return;
  auditBusy = true;
  (session.auth && session.groupId ? syncAudit() : Promise.resolve())
    .catch((err) => log("VRChat-Protokoll-Fehler:", err.message))
    .finally(() => {
      auditBusy = false;
      auditTimer = setTimeout(auditTick, active ? AUDIT_MS : IDLE_AUDIT_MS);
    });
}

/** Called by index.mjs on every bridge poll: is someone using FurrBox right now? */
export function setVrchatActive(value) {
  const next = Boolean(value);
  if (next === active) return;
  active = next;
  // Someone just opened FurrBox: fresh instances / player counts / audit entries right away.
  if (active && started) {
    tick();
    auditTick();
  }
}

/** Starts the instance watcher. */
export function startVrchat(bridgeFn, logFn) {
  bridge = bridgeFn;
  log = logFn;
  started = true;
  if (session.auth) log(`VRChat: gespeicherte Anmeldung als ${session.accountName ?? "?"} gefunden.`);
  tick();
  auditTimer = setTimeout(auditTick, 5_000);
}
