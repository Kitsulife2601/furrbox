// Minimal VRChat API client (server-only). Auth works with the cookies VRChat sets after login;
// FurrBox stores only those cookies, never the account password.
// Docs: https://vrchat.community (community-maintained API reference).

const BASE = "https://api.vrchat.cloud/api/1";
// VRChat asks API users to identify themselves with a descriptive User-Agent.
const USER_AGENT = "FurrBox/2.0 (+https://github.com/Kitsulife2601/furrbox)";

export type VrcCookies = { auth: string; twoFactor?: string | null };

export class VrcError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function cookieHeader(c: VrcCookies) {
  return [`auth=${c.auth}`, c.twoFactor ? `twoFactorAuth=${c.twoFactor}` : ""].filter(Boolean).join("; ");
}

function readCookie(res: Response, name: string) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (pair.slice(0, idx).trim() === name) return pair.slice(idx + 1).trim() || null;
  }
  return null;
}

async function call(path: string, init: RequestInit & { cookies?: VrcCookies; authHeader?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.cookies) headers.set("Cookie", cookieHeader(init.cookies));
  if (init.authHeader) headers.set("Authorization", init.authHeader);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    console.warn("[vrchat] request failed", {
      path: path.split("?")[0],
      status: res.status,
      body: text.slice(0, 300),
      sentCookies: init.cookies ? cookieHeader(init.cookies).split("; ").map((c) => `${c.split("=")[0]}(${c.length})`) : [],
    });
    const msg =
      (json as { error?: { message?: string } } | null)?.error?.message?.replace(/^"|"$/g, "") ||
      `VRChat antwortet mit Fehler ${res.status}.`;
    throw new VrcError(msg, res.status);
  }
  return { res, json };
}

export type LoginResult =
  | { step: "done"; cookies: VrcCookies; userId: string; displayName: string }
  | { step: "2fa"; pendingAuth: string; methods: string[] };

/** Step 1: username + password (Basic auth). VRChat may ask for a 2FA code next. */
export async function vrcLogin(username: string, password: string): Promise<LoginResult> {
  const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`).toString("base64");
  const { res, json } = await call("/auth/user", { authHeader: `Basic ${basic}` });
  const auth = readCookie(res, "auth");
  if (!auth) throw new VrcError("VRChat hat kein Login-Token geschickt.", 500);
  const body = json as { requiresTwoFactorAuth?: string[]; id?: string; displayName?: string };
  if (body.requiresTwoFactorAuth?.length) return { step: "2fa", pendingAuth: auth, methods: body.requiresTwoFactorAuth };
  return { step: "done", cookies: { auth }, userId: body.id ?? "", displayName: body.displayName ?? "" };
}

/** Step 2: 2FA code from the authenticator app ("totp"), e-mail ("emailOtp") or a recovery code ("otp"). */
export async function vrcVerify2fa(pendingAuth: string, method: string, code: string) {
  const path =
    method === "emailOtp"
      ? "/auth/twofactorauth/emailotp/verify"
      : method === "otp"
        ? "/auth/twofactorauth/otp/verify"
        : "/auth/twofactorauth/totp/verify";
  let res: Response;
  let json: unknown;
  try {
    ({ res, json } = await call(path, { method: "POST", body: JSON.stringify({ code }), cookies: { auth: pendingAuth } }));
  } catch (error) {
    if (error instanceof VrcError && error.status === 401) {
      throw new VrcError("VRChat hat die Anmeldung verworfen. Bitte Nutzername, Passwort und 2FA-Code zusammen eingeben.", 401);
    }
    throw error;
  }
  if (!(json as { verified?: boolean } | null)?.verified) throw new VrcError("Der Code ist falsch oder abgelaufen.", 400);
  const twoFactor = readCookie(res, "twoFactorAuth");
  // VRChat may hand out a fresh auth cookie together with the 2FA cookie – keep the newest one.
  const cookies: VrcCookies = { auth: readCookie(res, "auth") ?? pendingAuth, twoFactor };
  console.info("[vrchat] 2FA verified", {
    setCookies: res.headers.getSetCookie().map((c) => c.split("=")[0]),
    rotatedAuth: cookies.auth !== pendingAuth,
    hasTwoFactor: Boolean(twoFactor),
  });
  const me = await vrcCurrentUser(cookies);
  return { cookies, userId: me.id, displayName: me.displayName };
}

export async function vrcCurrentUser(cookies: VrcCookies) {
  const { json } = await call("/auth/user", { cookies });
  const user = json as { id?: string; displayName?: string; requiresTwoFactorAuth?: string[] };
  if (!user?.id) throw new VrcError("Die VRChat-Anmeldung ist abgelaufen. Bitte neu verbinden.", 401);
  return { id: user.id, displayName: user.displayName ?? "" };
}

export type VrcGroup = {
  id: string;
  name: string;
  shortCode: string;
  discriminator: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number;
  onlineMemberCount: number;
};

export async function vrcGroup(cookies: VrcCookies, groupId: string): Promise<VrcGroup> {
  const { json } = await call(`/groups/${encodeURIComponent(groupId)}`, { cookies });
  const g = json as Record<string, unknown>;
  return {
    id: String(g.id ?? groupId),
    name: String(g.name ?? "VRChat-Gruppe"),
    shortCode: String(g.shortCode ?? ""),
    discriminator: String(g.discriminator ?? ""),
    iconUrl: (g.iconUrl as string) || null,
    bannerUrl: (g.bannerUrl as string) || null,
    memberCount: Number(g.memberCount ?? 0),
    onlineMemberCount: Number(g.onlineMemberCount ?? 0),
  };
}

/** Finds a group by its short code, e.g. "FLS.0227". */
export async function vrcFindGroupByCode(cookies: VrcCookies, code: string): Promise<string | null> {
  const [short, disc] = code.split(".");
  const { json } = await call(`/groups?query=${encodeURIComponent(code)}&n=20`, { cookies });
  const groups = (json as Record<string, unknown>[]) ?? [];
  const hit = groups.find(
    (g) => String(g.shortCode ?? "").toLowerCase() === short.toLowerCase() && String(g.discriminator ?? "") === disc,
  );
  return hit ? String(hit.id) : null;
}

export type VrcGroupInstance = {
  instanceId: string;
  location: string;
  memberCount: number;
  world: { id: string; name: string; capacity: number; image: string | null };
};

export async function vrcGroupInstances(cookies: VrcCookies, groupId: string): Promise<VrcGroupInstance[]> {
  const { json } = await call(`/groups/${encodeURIComponent(groupId)}/instances`, { cookies });
  return ((json as Record<string, unknown>[]) ?? []).map((i) => {
    const w = (i.world ?? {}) as Record<string, unknown>;
    return {
      instanceId: String(i.instanceId ?? i.location ?? ""),
      location: String(i.location ?? ""),
      memberCount: Number(i.memberCount ?? 0),
      world: {
        id: String(w.id ?? String(i.location ?? "").split(":")[0]),
        name: String(w.name ?? "Unbekannte Welt"),
        capacity: Number(w.capacity ?? 0),
        image: ((w.thumbnailImageUrl as string) || (w.imageUrl as string)) ?? null,
      },
    };
  });
}

export type VrcUser = { id: string; displayName: string; image: string | null };

export async function vrcSearchUsers(cookies: VrcCookies, query: string): Promise<VrcUser[]> {
  if (/^usr_[0-9a-f-]{36}$/i.test(query)) {
    const { json } = await call(`/users/${encodeURIComponent(query)}`, { cookies });
    const u = json as Record<string, unknown>;
    return [{ id: String(u.id), displayName: String(u.displayName ?? query), image: (u.userIcon as string) || (u.currentAvatarThumbnailImageUrl as string) || null }];
  }
  const { json } = await call(`/users?search=${encodeURIComponent(query)}&n=10`, { cookies });
  return ((json as Record<string, unknown>[]) ?? []).map((u) => ({
    id: String(u.id),
    displayName: String(u.displayName ?? ""),
    image: (u.userIcon as string) || (u.currentAvatarThumbnailImageUrl as string) || null,
  }));
}

export async function vrcBan(cookies: VrcCookies, groupId: string, userId: string) {
  await call(`/groups/${encodeURIComponent(groupId)}/bans`, { method: "POST", body: JSON.stringify({ userId }), cookies });
}

export async function vrcUnban(cookies: VrcCookies, groupId: string, userId: string) {
  await call(`/groups/${encodeURIComponent(groupId)}/bans/${encodeURIComponent(userId)}`, { method: "DELETE", cookies });
}

export async function vrcKick(cookies: VrcCookies, groupId: string, userId: string) {
  await call(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE", cookies });
}

/** "wrld_x:12345~group(grp_y)~groupAccessType(plus)~region(eu)" -> parts. */
export function parseLocation(location: string) {
  const region = /~region\(([^)]+)\)/.exec(location)?.[1] ?? "us";
  const access = /~groupAccessType\(([^)]+)\)/.exec(location)?.[1] ?? "members";
  const [worldId, rest = ""] = location.split(":");
  const name = rest.split("~")[0] ?? "";
  return { worldId, instanceName: name, region, access };
}
