// Discord login -> FurrBox profile + live staff check (server-only).
// Staff = a Dev / Owner / Moderator / Supporter role on the Fish server; everyone
// else stays "member" and never sees the admin tools.
import { createServerOnlyFn } from "@tanstack/react-start";
import type { Sql } from "@/lib/db";
import type { Role } from "./roles";

const FISH_GUILD_ID = "1386651125327073470";

// Same ids the Discord bot uses (highest first). A matching user id counts too.
const STAFF_IDS: [Role, string][] = [
  ["dev", "1312104318006071328"],
  ["owner", "1395506854549000202"],
  ["moderator", "1397883231134547989"],
  ["supporter", "1395506316801343558"],
];

/** How long a staff check is trusted before Discord is asked again. */
const RECHECK_MS = 5 * 60_000;

export function privilegeFor(discordId: string, roleIds: string[]): Role | "none" {
  for (const [role, id] of STAFF_IDS) {
    if (discordId === id || roleIds.includes(id)) return role;
  }
  return "none";
}

type Link = { discord_id: string; profile_discord_id: string | null; has_profile: boolean; checked_at: unknown };

/**
 * Links the signed-in user's Discord account to their profile and refreshes the
 * staff privilege from Discord (at most every 5 minutes). No-op for users
 * without a Discord account.
 */
export async function syncDiscordLogin(
  sql: Sql,
  userId: string,
  createProfile: (discordId: string) => Promise<void>,
) {
  const rows = await sql<Link>`
    select a."accountId" as discord_id, p.discord_id as profile_discord_id,
           p.user_id is not null as has_profile, p.discord_checked_at as checked_at
    from account a
    left join furr_profile p on p.user_id = a."userId"
    where a."userId" = ${userId} and a."providerId" = 'discord'
    limit 1`;
  const link = rows[0];
  if (!link) return;

  if (!link.has_profile) {
    await createProfile(link.discord_id);
  } else if (link.profile_discord_id !== link.discord_id) {
    // The Discord id may have been assigned to another (legacy) profile by hand.
    await sql`update furr_profile set discord_id = null where discord_id = ${link.discord_id} and user_id <> ${userId}`;
    await sql`update furr_profile set discord_id = ${link.discord_id} where user_id = ${userId}`;
  }

  const checkedAt = link.checked_at ? new Date(String(link.checked_at)).getTime() : 0;
  if (Date.now() - checkedAt < RECHECK_MS) return;

  const privilege = await fetchPrivilege(userId, link.discord_id);
  if (privilege === null) return; // Discord unreachable: keep the last known value.
  await sql`
    update furr_profile set discord_privilege = ${privilege}, discord_checked_at = now()
    where user_id = ${userId}`;
}

// Server-only so the Better Auth server never lands in the client bundle.
const fetchPrivilege = createServerOnlyFn(async (userId: string, discordId: string): Promise<Role | "none" | null> => {
  try {
    const { auth } = await import("@/lib/auth/server");
    const { accessToken } = await auth.api.getAccessToken({ body: { providerId: "discord", userId } });
    if (!accessToken) return null;
    const guildId = process.env.DISCORD_GUILD_ID?.trim() || FISH_GUILD_ID;
    const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) return "none"; // not on the server
    if (!res.ok) return null;
    const member = (await res.json()) as { roles?: string[] };
    return privilegeFor(discordId, member.roles ?? []);
  } catch (error) {
    console.warn("[furrbox] Discord staff check failed", error);
    return null;
  }
});
