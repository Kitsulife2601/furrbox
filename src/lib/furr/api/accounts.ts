// FurrAccountManager (Dev only): create, edit roles / Discord IDs, delete accounts.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { createProfile, getSql, notify, requirePermission } from "../core";
import { ROLE_LABEL, isRole, type Role } from "../roles";
import { queryPresence } from "./presence";

const DISCORD_ID = /^\d{17,22}$/;

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canManageAccounts");
    const sql = await getSql();
    const roles = await sql<{ user_id: string; role: string }>`select user_id, role from furr_profile`;
    const accountRole = new Map(roles.map((r) => [r.user_id, r.role]));
    return (await queryPresence(true))
      .filter((u) => u.hasAccount)
      .map((u) => ({ ...u, accountRole: (isRole(accountRole.get(u.id)) ? accountRole.get(u.id) : "member") as Role }));
  });

export const createAccount = createServerFn({ method: "POST" })
  .validator((input: { email: string; username: string; password: string; discordId?: string; role: Role }) => ({
    email: String(input.email ?? "").trim().toLowerCase(),
    username: String(input.username ?? "").trim().toLowerCase(),
    password: String(input.password ?? ""),
    discordId: String(input.discordId ?? "").trim(),
    role: isRole(input.role) ? input.role : "member",
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageAccounts");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
    if (!/^[a-z0-9_.-]{3,32}$/.test(data.username)) throw new Error("Wunschnutzername muss 3-32 Zeichen lang sein (a-z, 0-9, _ . -).");
    if (data.password.length < 8) throw new Error("Start-Passwort muss mindestens 8 Zeichen lang sein.");
    if (data.discordId && !DISCORD_ID.test(data.discordId)) throw new Error("Discord-ID muss eine numerische Snowflake sein.");

    const sql = await getSql();
    const taken = await sql`
      select 1 from furr_profile where username = ${data.username}
        or (${data.discordId} <> '' and discord_id = ${data.discordId})`;
    if (taken.length) throw new Error("Nutzername oder Discord-ID ist bereits vergeben.");
    const emailTaken = await sql`select 1 from "user" where lower(email) = ${data.email}`;
    if (emailTaken.length) throw new Error("Diese E-Mail-Adresse hat bereits ein Konto.");

    const { auth } = await import("@/lib/auth/server");
    // Create the credential account directly (like Better Auth's admin createUser) so the
    // Dev's own session is untouched — signUpEmail would sign the caller in as the new user.
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createUser({ email: data.email, name: data.username, emailVerified: false });
    if (!created) throw new Error("Account konnte nicht erstellt werden.");
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await ctx.password.hash(data.password),
    });
    const newUserId = created.id;
    await createProfile(sql, newUserId, {
      username: data.username,
      displayName: data.username,
      discordId: data.discordId || null,
      role: data.role,
    });
    await notify("System-Update: Neuer Account erstellt", `${data.username} wurde als ${ROLE_LABEL[data.role]} angelegt.`);
    return { userId: newUserId };
  });

export const updateAccount = createServerFn({ method: "POST" })
  .validator((input: { userId: string; role?: Role; discordId?: string | null; displayName?: string }) => ({
    userId: String(input.userId ?? ""),
    role: isRole(input.role) ? input.role : undefined,
    discordId: input.discordId === undefined ? undefined : String(input.discordId ?? "").trim(),
    displayName: input.displayName === undefined ? undefined : String(input.displayName).trim(),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageAccounts");
    const sql = await getSql();
    const target = await sql<{ role: string }>`select role from furr_profile where user_id = ${data.userId}`;
    if (!target.length) throw new Error("Account wurde nicht gefunden.");

    if (data.role && data.role !== "dev" && target[0].role === "dev") {
      const devs = await sql<{ n: number }>`select count(*)::int as n from furr_profile where role = 'dev'`;
      if ((devs[0]?.n ?? 0) <= 1) throw new Error("Der letzte Dev-Account kann nicht herabgestuft werden.");
    }
    if (data.discordId !== undefined) {
      if (data.discordId && !DISCORD_ID.test(data.discordId)) throw new Error("Discord-ID muss eine numerische Snowflake sein.");
      if (data.discordId) {
        const clash = await sql<{ username: string }>`
          select username from furr_profile where discord_id = ${data.discordId} and user_id <> ${data.userId}`;
        if (clash.length) throw new Error(`Discord-ID ist bereits ${clash[0].username} zugewiesen.`);
      }
      await sql`update furr_profile set discord_id = ${data.discordId || null} where user_id = ${data.userId}`;
    }
    if (data.role) await sql`update furr_profile set role = ${data.role} where user_id = ${data.userId}`;
    if (data.displayName !== undefined) {
      if (data.displayName.length < 2 || data.displayName.length > 80) throw new Error("Anzeigename muss 2-80 Zeichen lang sein.");
      await sql`update furr_profile set display_name = ${data.displayName} where user_id = ${data.userId}`;
    }
    return { ok: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .validator((userId: string) => String(userId ?? ""))
  .middleware([authMiddleware])
  .handler(async ({ context, data: userId }) => {
    await requirePermission(context.userId, "canManageAccounts");
    if (userId === context.userId) throw new Error("Du kannst deinen eigenen Account hier nicht löschen.");
    const sql = await getSql();
    const target = await sql<{ role: string }>`select role from furr_profile where user_id = ${userId}`;
    if (!target.length) throw new Error("Account wurde nicht gefunden.");
    if (target[0].role === "dev") {
      const devs = await sql<{ n: number }>`select count(*)::int as n from furr_profile where role = 'dev'`;
      if ((devs[0]?.n ?? 0) <= 1) throw new Error("Der letzte Dev-Account kann nicht gelöscht werden.");
    }
    await sql`delete from furr_file where scope = 'private' and owner_id = ${userId}`;
    await sql`delete from chat_message where sender_id = ${userId} or recipient_id = ${userId}`;
    await sql`delete from furr_presence where user_id = ${userId}`;
    await sql`delete from furr_profile where user_id = ${userId}`;
    await sql`delete from "user" where id = ${userId}`;
    return { ok: true };
  });
