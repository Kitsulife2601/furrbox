// FurrAccountManager (Dev only): edit roles / Discord IDs, delete accounts (accounts come from Discord logins).
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, requirePermission } from "../core";
import { isRole, type Role } from "../roles";
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
