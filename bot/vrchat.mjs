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
const WATCH_MS = 60_000;
const GROUP_REFRESH_MS = 5 * 60_000;
const STATE_HEARTBEAT_MS = 10 * 60_000;

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
let log = console.log;

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
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

async function fetchInstances() {
  const { json } = await authed(`/groups/${encodeURIComponent(session.groupId)}/instances`);
  return (json ?? []).map((i) => ({
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
}

/** Sends the current state to FurrBox – only when something changed (lets the database sleep). */
async function pushState(force = false, instances = null) {
  if (!bridge) return;
  const signature = JSON.stringify([
    session.accountName ?? null,
    session.groupId ?? null,
    group?.memberCount,
    group?.onlineMemberCount,
    lastError,
    instances?.map((i) => `${i.instanceId}:${i.memberCount}`).sort() ?? null,
  ]);
  if (!force && signature === lastSignature && Date.now() - lastPushAt < STATE_HEARTBEAT_MS) return;
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
    if (force || !group || Date.now() - groupFetchedAt > GROUP_REFRESH_MS) {
      const { json } = await authed(`/groups/${encodeURIComponent(session.groupId)}`);
      group = mapGroup(json);
      groupFetchedAt = Date.now();
    }
    const instances = await fetchInstances();
    lastError = null;
    await pushState(force, instances);
  } catch (err) {
    if (!(err instanceof VrcError && err.status === 401)) {
      lastError = `VRChat: ${err instanceof Error ? err.message : String(err)}`;
      await pushState(force).catch(() => undefined);
    }
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

/** Starts the instance watcher. */
export function startVrchat(bridgeFn, logFn) {
  bridge = bridgeFn;
  log = logFn;
  if (session.auth) log(`VRChat: gespeicherte Anmeldung als ${session.accountName ?? "?"} gefunden.`);
  const tick = () => refresh().catch((err) => log("VRChat-Fehler:", err.message)).finally(() => setTimeout(tick, WATCH_MS));
  tick();
}
