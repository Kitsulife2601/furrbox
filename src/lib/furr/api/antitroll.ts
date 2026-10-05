// Anti-Troll Signale: Repeat-Report / Vote-Abuse → Flag an Bot. Kein Auto-Ban.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAuditLater } from "../audit";
import { publishAlertLater } from "../alerts";
import { getSql, iso, newId, requirePermission } from "../core";

export type AntiTrollFlagDto = {
  id: string;
  targetKey: string;
  platform: string;
  kind: string;
  score: number;
  detail: string | null;
  caseId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const reportAntiTroll = createServerFn({ method: "POST" })
  .validator(
    (input: {
      targetKey: string;
      platform?: "discord" | "vrchat";
      kind: "vote_abuse" | "repeat_report" | "rejoin_hopping" | "other";
      detail?: string;
      caseId?: string;
      increment?: number;
    }) => ({
      targetKey: String(input.targetKey ?? "").trim().slice(0, 80),
      platform: input.platform === "discord" ? "discord" : "vrchat",
      kind: (["vote_abuse", "repeat_report", "rejoin_hopping", "other"].includes(input.kind)
        ? input.kind
        : "other") as "vote_abuse" | "repeat_report" | "rejoin_hopping" | "other",
      detail: input.detail ? String(input.detail).trim().slice(0, 500) : null,
      caseId: input.caseId ? String(input.caseId).trim().slice(0, 80) : null,
      increment: Math.max(1, Math.min(5, Math.trunc(Number(input.increment) || 1))),
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!data.targetKey) throw new Error("Ziel fehlt.");
    const sql = await getSql();
    const existing = await sql<{ id: string; score: number }>`
      select id, score from anti_troll_flag
      where target_key = ${data.targetKey} and kind = ${data.kind}
        and updated_at > now() - interval '24 hours'
      order by updated_at desc limit 1`;
    let id: string;
    let score: number;
    if (existing[0]) {
      id = existing[0].id;
      score = existing[0].score + data.increment;
      await sql`
        update anti_troll_flag set score = ${score}, updated_at = now(),
          detail = coalesce(${data.detail}, detail), case_id = coalesce(${data.caseId}, case_id),
          notified_bot = false
        where id = ${id}`;
    } else {
      id = newId();
      score = data.increment;
      await sql`
        insert into anti_troll_flag (id, target_key, platform, kind, score, detail, case_id)
        values (${id}, ${data.targetKey}, ${data.platform}, ${data.kind}, ${score}, ${data.detail}, ${data.caseId})`;
    }
    appendAuditLater({
      source: "furrbox",
      action: `anti_troll.${data.kind}`,
      actorId: context.userId,
      targetId: data.targetKey,
      caseId: data.caseId,
      detail: data.detail,
      meta: { score },
    });
    if (score >= 2) {
      publishAlertLater({
        kind: "anti_troll",
        severity: score >= 5 ? "critical" : "warn",
        title: `Anti-Troll: ${data.kind}`,
        body: `${data.targetKey} – Score ${score}${data.detail ? ` (${data.detail})` : ""}`,
        dedupKey: `at:${data.targetKey}:${data.kind}`,
        payload: { flagId: id, targetKey: data.targetKey, kind: data.kind, score, autoBan: false },
        channels: ["bot", "desktop"],
      });
    }
    return { id, score, autoBan: false as const };
  });

export const listAntiTrollFlags = createServerFn({ method: "GET" })
  .validator((limit?: number) => Math.min(100, Math.max(1, Number(limit) || 50)))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: limit }): Promise<AntiTrollFlagDto[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      target_key: string;
      platform: string;
      kind: string;
      score: number;
      detail: string | null;
      case_id: string | null;
      created_at: unknown;
      updated_at: unknown;
    }>`
      select id, target_key, platform, kind, score, detail, case_id, created_at, updated_at
      from anti_troll_flag order by updated_at desc limit ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      targetKey: r.target_key,
      platform: r.platform,
      kind: r.kind,
      score: Number(r.score),
      detail: r.detail,
      caseId: r.case_id,
      createdAt: iso(r.created_at) ?? "",
      updatedAt: iso(r.updated_at) ?? "",
    }));
  });
