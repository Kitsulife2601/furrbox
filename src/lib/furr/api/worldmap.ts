// Weltenkarte: where the team is in VRChat. Each team member can share their own location from
// their FurrBox desktop app (own VRChat login, opt-in). Friends' locations never come here – they
// stay in the desktop app of whoever is friends with them.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { getSql, iso, requirePermission } from "../core";

export type TeamLocation = {
  userId: string;
  furrName: string;
  vrchatUserId: string;
  vrchatName: string;
  image: string | null;
  location: string;
  worldName: string | null;
  worldImage: string | null;
  updatedAt: string;
};

const USER_ID = /^usr_[0-9a-f-]{36}$/i;

function cleanUrl(value: unknown) {
  const url = String(value ?? "").trim();
  return /^https:\/\/[^\s]+$/.test(url) ? url.slice(0, 500) : null;
}

export const shareVrchatLocation = createServerFn({ method: "POST" })
  .validator(
    (input: { vrchatUserId: string; vrchatName: string; image?: string | null; location: string; worldName?: string | null; worldImage?: string | null }) => ({
      vrchatUserId: String(input.vrchatUserId ?? "").trim(),
      vrchatName: String(input.vrchatName ?? "").trim().slice(0, 100),
      image: cleanUrl(input.image),
      location: String(input.location ?? "").trim().slice(0, 300),
      worldName: input.worldName ? String(input.worldName).slice(0, 200) : null,
      worldImage: cleanUrl(input.worldImage),
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!USER_ID.test(data.vrchatUserId)) throw new Error("Ungültiges VRChat-Konto.");
    if (!data.location) throw new Error("Kein Standort.");
    const sql = await getSql();
    await sql`
      insert into vrchat_presence (user_id, vrchat_user_id, vrchat_name, image, location, world_name, world_image, updated_at)
      values (${context.userId}, ${data.vrchatUserId}, ${data.vrchatName}, ${data.image}, ${data.location}, ${data.worldName}, ${data.worldImage}, now())
      on conflict (user_id) do update set
        vrchat_user_id = excluded.vrchat_user_id, vrchat_name = excluded.vrchat_name, image = excluded.image,
        location = excluded.location, world_name = excluded.world_name, world_image = excluded.world_image, updated_at = now()`;
    return { ok: true };
  });

export const stopSharingVrchatLocation = createServerFn({ method: "POST" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`delete from vrchat_presence where user_id = ${context.userId}`;
    return { ok: true };
  });

/**
 * Team members currently sharing their VRChat location (offline ones are left out). A share
 * counts for 3 minutes – the app sends one every minute.
 */
export const listTeamLocations = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<TeamLocation[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      user_id: string;
      display_name: string | null;
      vrchat_user_id: string;
      vrchat_name: string | null;
      image: string | null;
      location: string;
      world_name: string | null;
      world_image: string | null;
      updated_at: unknown;
    }>`
      select v.user_id, p.display_name, v.vrchat_user_id, v.vrchat_name, v.image, v.location, v.world_name, v.world_image, v.updated_at
      from vrchat_presence v left join furr_profile p on p.user_id = v.user_id
      where v.updated_at > now() - interval '3 minutes' and v.location <> 'offline'
      order by v.vrchat_name`;
    return rows.map((r) => ({
      userId: r.user_id,
      furrName: r.display_name ?? "Teammitglied",
      vrchatUserId: r.vrchat_user_id,
      vrchatName: r.vrchat_name ?? r.display_name ?? "?",
      image: r.image,
      location: r.location,
      worldName: r.world_name,
      worldImage: r.world_image,
      updatedAt: iso(r.updated_at) ?? "",
    }));
  });
