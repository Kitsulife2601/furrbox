// Personal VRChat login of the FurrBox desktop app. Every team member signs in with their own
// VRChat account; kicks/bans then run under their own name. VRChat ties a login to the address
// it came from, so this has to run here on the user's PC (not on the FurrBox server).
// The login is kept in <userData>/vrchat-session.json (cookies only, never the password) and
// survives app updates.
const fs = require("node:fs");
const path = require("node:path");

const API = "https://api.vrchat.cloud/api/1";
const USER_AGENT = "FurrBox/2.0 (+https://github.com/Kitsulife2601/furrbox)";

class VrcError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function createVrchat(userDataDir) {
  const file = path.join(userDataDir, "vrchat-session.json");
  let session = load();
  let pending = null; // { auth, methods } while a 2FA code is awaited

  function load() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }
  function save() {
    fs.writeFileSync(file, JSON.stringify(session, null, 2), { mode: 0o600 });
  }

  function readCookie(res, name) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (pair.slice(0, idx).trim() === name) return pair.slice(idx + 1).trim() || null;
    }
    return null;
  }

  async function call(p, { method = "GET", body, auth, twoFactor, basic } = {}) {
    const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Cookie = [`auth=${auth}`, twoFactor ? `twoFactorAuth=${twoFactor}` : ""].filter(Boolean).join("; ");
    if (basic) headers.Authorization = `Basic ${basic}`;
    const res = await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

  async function authed(p, opts = {}) {
    if (!session.auth) throw new VrcError("Du bist nicht bei VRChat angemeldet.", 401);
    try {
      return await call(p, { ...opts, auth: session.auth, twoFactor: session.twoFactor });
    } catch (err) {
      if (err instanceof VrcError && err.status === 401) {
        session = {};
        save();
        throw new VrcError("Deine VRChat-Anmeldung ist abgelaufen. Bitte neu anmelden.", 401);
      }
      throw err;
    }
  }

  async function finish(auth, twoFactor) {
    const { json } = await call("/auth/user", { auth, twoFactor });
    if (!json?.id) throw new VrcError("VRChat verlangt noch eine Bestätigung (2FA).", 401);
    session = { auth, twoFactor: twoFactor ?? null, userId: json.id, displayName: json.displayName ?? "" };
    pending = null;
    save();
    return status();
  }

  function status() {
    return {
      loggedIn: Boolean(session.auth),
      displayName: session.displayName ?? null,
      userId: session.userId ?? null,
      needs: pending ? (pending.methods.includes("emailOtp") ? "emailOtp" : "totp") : null,
    };
  }

  return {
    status,
    async login(username, password) {
      const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`).toString("base64");
      const { res, json } = await call("/auth/user", { basic });
      const auth = readCookie(res, "auth");
      if (!auth) throw new Error("VRChat hat kein Login-Token geschickt.");
      const methods = json?.requiresTwoFactorAuth ?? [];
      if (!methods.length) return finish(auth, null);
      pending = { auth, methods };
      return status();
    },
    async verify(code) {
      if (!pending) throw new Error("Bitte zuerst Nutzername und Passwort eingeben.");
      const clean = String(code).replace(/\s+/g, "");
      const method = pending.methods.includes("emailOtp") ? "emailOtp" : clean.length > 6 ? "otp" : "totp";
      const p =
        method === "emailOtp"
          ? "/auth/twofactorauth/emailotp/verify"
          : method === "otp"
            ? "/auth/twofactorauth/otp/verify"
            : "/auth/twofactorauth/totp/verify";
      const { res, json } = await call(p, { method: "POST", body: { code: clean }, auth: pending.auth });
      if (!json?.verified) throw new Error("Der Code ist falsch oder abgelaufen.");
      return finish(readCookie(res, "auth") ?? pending.auth, readCookie(res, "twoFactorAuth"));
    },
    async logout() {
      if (session.auth) await call("/logout", { method: "PUT", auth: session.auth, twoFactor: session.twoFactor }).catch(() => undefined);
      session = {};
      pending = null;
      fs.rmSync(file, { force: true });
      return status();
    },
    cancelLogin() {
      pending = null;
      return status();
    },
    async search(query) {
      const q = String(query).trim();
      if (/^usr_[0-9a-f-]{36}$/i.test(q)) {
        const { json } = await authed(`/users/${encodeURIComponent(q)}`);
        return [{ id: json.id, displayName: json.displayName ?? q, image: json.userIcon || json.currentAvatarThumbnailImageUrl || null }];
      }
      const { json } = await authed(`/users?search=${encodeURIComponent(q)}&n=10`);
      return (json ?? []).map((u) => ({ id: u.id, displayName: u.displayName ?? "", image: u.userIcon || u.currentAvatarThumbnailImageUrl || null }));
    },
    async moderate(action, groupId, userId) {
      if (!/^grp_[0-9a-f-]{36}$/i.test(groupId)) throw new Error("Keine VRChat-Gruppe verbunden.");
      if (!/^usr_[0-9a-f-]{36}$/i.test(userId)) throw new Error("Ungültige VRChat-Person.");
      const g = encodeURIComponent(groupId);
      const u = encodeURIComponent(userId);
      if (action === "ban") await authed(`/groups/${g}/bans`, { method: "POST", body: { userId } });
      else if (action === "unban") await authed(`/groups/${g}/bans/${u}`, { method: "DELETE" });
      else if (action === "kick") await authed(`/groups/${g}/members/${u}`, { method: "DELETE" });
      else throw new Error("Unbekannte Aktion.");
      return { ok: true };
    },
  };
}

module.exports = { createVrchat };
