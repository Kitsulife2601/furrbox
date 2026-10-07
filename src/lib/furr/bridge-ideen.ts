// Bridge-Handler für Bot-Ideen-Features (Duty, Whitelist, Hint, Sanctions, Vote, Flags, Clip).
// Wird aus routes/api/bridge/$.ts dünn eingebunden.
import { discordName, getSetting, getSql, iso, newId, notify } from "@/lib/furr/core";
import { bridgeError, bridgeJson, runSideEffect } from "@/lib/furr/http";


const DISCORD_ID = /^\d{17,22}$/;
const USERNAME = /^[a-z0-9_.-]{3,32}$/;
async function audit(source: string, kind: string, opts: { target?: string; targetId?: string; detail?: string; caseId?: string } = {}) {
  const sql = await getSql();
  const id = newId();
  // Bot-Tabelle (weiterhin) + gemeinsames furr_audit (Fassade)
  try {
    await sql`
      insert into mod_audit (id, source, kind, target, target_id, detail, case_id)
      values (${id}, ${source}, ${kind}, ${opts.target ?? null}, ${opts.targetId ?? null}, ${opts.detail ?? null}, ${opts.caseId ?? null})`;
  } catch { /* Tabelle fehlt vor Migration */ }
  try {
    await sql`
      insert into furr_audit (id, source, actor_name, action, target_id, target_name, case_id, detail)
      values (${id}, ${source === "bot" ? "bot" : source}, ${opts.target ?? null}, ${kind.slice(0, 80)},
              ${opts.targetId ?? null}, ${opts.target ?? null}, ${opts.caseId ?? null}, ${opts.detail ?? null})`;
  } catch { /* vor Migration */ }
  return id;
}

async function resolveUserIdByDiscord(discordId: string) {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`select user_id from furr_profile where discord_id = ${discordId} limit 1`;
  return rows[0]?.user_id ?? null;
}

async function modChannelId() {
  const id = await getSetting("mod_channel_id", "");
  if (/^\d{17,22}$/.test(id)) return id;
  return getSetting("duty_channel_id", "1434484156431204382");
}

/** Sanctions + Flags an die Queue hängen (Outbox-Felder werden in $.ts gelesen). */
export async function enrichQueuePayload(sql: Awaited<ReturnType<typeof getSql>>, base: Record<string, unknown>) {
  let activeSanctions: unknown[] = [];
  try {
    const rows = await sql<{
      id: string;
      platform: string | null;
      target_id: string | null;
      type: string | null;
      discord_id: string | null;
      kind: string | null;
      reason: string | null;
      expires_at: unknown;
      active: boolean;
    }>`
      select id, platform, target_id, type, discord_id, kind, reason, expires_at, active from mod_sanction
      where active = true
      order by created_at desc limit 200`;
    activeSanctions = rows.map((r) => ({
      id: r.id,
      platform: r.platform ?? "discord",
      targetId: r.target_id ?? r.discord_id,
      type: r.type ?? r.kind,
      discordId: r.discord_id ?? (r.platform === "discord" ? r.target_id : null),
      kind: r.kind ?? r.type,
      reason: r.reason,
      expiresAt: iso(r.expires_at),
      active: r.active,
    }));
  } catch {
    activeSanctions = [];
  }

  let flags: unknown[] = [];
  try {
    const rows = await sql<{ id: string; kind: string; discord_id: string | null; context: string | null }>`
      update mod_flag set alerted = true
      where id in (select id from mod_flag where active and not alerted order by created_at limit 20)
      returning id, kind, discord_id, context`;
    flags = rows.map((r) => ({ id: r.id, kind: r.kind, discordId: r.discord_id, context: r.context }));
  } catch {
    flags = [];
  }

  return { ...base, activeSanctions, flags };
}

export async function handleIdeenBridge(
  action: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const sql = await getSql();

  if (action === "bot-settings") {
    const [modCh, qEn, qStart, qEnd, qTz, minSec] = await Promise.all([
      modChannelId(),
      getSetting("quiet_hours_enabled", "false"),
      getSetting("quiet_hours_start", "23:00"),
      getSetting("quiet_hours_end", "07:00"),
      getSetting("quiet_hours_tz", "Europe/Berlin"),
      getSetting("alert_min_interval_sec", "30"),
    ]);
    return bridgeJson({
      modChannelId: modCh,
      quietHours: {
        enabled: qEn === "true",
        start: qStart,
        end: qEnd,
        tz: qTz,
        minIntervalSec: Number(minSec) || 30,
      },
    });
  }

  if (action === "duty") {
    const discordId = String(body.discordId ?? "");
    const status = String(body.status ?? "").toLowerCase();
    if (!DISCORD_ID.test(discordId)) return bridgeError("Ungültige Discord-ID", 400);
    if (!["on", "off", "away"].includes(status)) return bridgeError("status muss on|off|away sein", 400);
    const userId = await resolveUserIdByDiscord(discordId);
    if (!userId) return bridgeError("Kein FurrBox-Konto zu dieser Discord-ID. Bitte einmal in FurrBox anmelden.", 404);
    const onDuty = status === "on";
    await sql`
      insert into mod_duty (user_id, on_duty, updated_at, status) values (${userId}, ${onDuty}, now(), ${status})
      on conflict (user_id) do update set on_duty = excluded.on_duty, updated_at = now(), status = excluded.status`;
    const name = await discordName(discordId);
    const auditId = await audit("bot", "duty", { target: name, targetId: discordId, detail: status });
    await runSideEffect(
      () => notify("Duty", `${name} ist jetzt ${status === "on" ? "anwesend" : status === "away" ? "kurz weg" : "nicht anwesend"} (Discord).`),
      "duty-notify",
    );
    return bridgeJson({ ok: true, status, onDuty, auditId });
  }

  if (action === "whitelist-check") {
    const discordId = String(body.discordId ?? "");
    if (!DISCORD_ID.test(discordId)) return bridgeError("Ungültige Discord-ID", 400);
    const rows = await sql<{ username: string | null; note: string; must_change_password: boolean }>`
      select username, note, must_change_password from furr_whitelist where discord_id = ${discordId}`;
    const row = rows[0];
    const auditId = await audit("bot", "whitelist-check", { targetId: discordId, detail: row ? "hit" : "miss" });
    return bridgeJson({
      onWhitelist: Boolean(row),
      username: row?.username ?? null,
      note: row?.note ?? null,
      mustChangePassword: Boolean(row?.must_change_password),
      auditId,
    });
  }

  if (action === "whitelist-remove") {
    const discordId = String(body.discordId ?? "");
    const by = String(body.byDiscordId ?? "");
    if (!DISCORD_ID.test(discordId)) return bridgeError("Ungültige Discord-ID", 400);
    await sql`delete from furr_whitelist where discord_id = ${discordId}`;
    await sql`delete from furr_whitelist_unlock where user_id in (select user_id from furr_profile where discord_id = ${discordId})`;
    const auditId = await audit("bot", "whitelist-remove", { targetId: discordId, detail: `by ${by}` });
    await runSideEffect(() => notify("Whitelist", `${discordId} per Discord-Bot entfernt.`), "wl-remove");
    return bridgeJson({ ok: true, auditId });
  }

  if (action === "whitelist-add") {
    const discordId = String(body.discordId ?? "");
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const note = String(body.note ?? "").trim().slice(0, 200);
    const by = String(body.byDiscordId ?? "");
    if (!DISCORD_ID.test(discordId)) return bridgeError("Ungültige Discord-ID", 400);
    if (!USERNAME.test(username)) return bridgeError("Nutzername: 3–32 Zeichen, nur a–z, 0–9, _ . -", 400);
    if (password.length < 8 || password.length > 200) return bridgeError("Passwort 8–200 Zeichen.", 400);
    const taken = await sql`select 1 from furr_whitelist where lower(username) = ${username} and discord_id <> ${discordId}`;
    if (taken.length) return bridgeError("Dieser Nutzername ist schon vergeben.", 409);
    const byUser = by && DISCORD_ID.test(by) ? await resolveUserIdByDiscord(by) : null;
    const { hashPassword } = await import("@/lib/furr/whitelist-login.server");
    const hash = await hashPassword(password);
    await sql`
      insert into furr_whitelist (discord_id, note, added_by, username, password_hash, must_change_password)
      values (${discordId}, ${note}, ${byUser}, ${username}, ${hash}, true)
      on conflict (discord_id) do update set
        note = excluded.note, username = excluded.username, password_hash = excluded.password_hash,
        must_change_password = true, failed_attempts = 0, locked_until = null`;
    const auditId = await audit("bot", "whitelist-add", { targetId: discordId, detail: username });
    await runSideEffect(() => notify("Whitelist", `${username} per Discord-Bot freigeschaltet.`), "wl-add");
    return bridgeJson({ ok: true, auditId });
  }

  if (action === "hint") {
    const text = String(body.text ?? "").trim().slice(0, 144);
    const discordId = String(body.discordId ?? "");
    if (!text) return bridgeError("Text ist leer.", 400);
    const id = newId();
    await sql`
      insert into furr_hint (id, text, requested_by_discord_id, status)
      values (${id}, ${text}, ${DISCORD_ID.test(discordId) ? discordId : null}, 'queued')`;
    const auditId = await audit("bot", "hint", { targetId: discordId || undefined, detail: text.slice(0, 120) });
    return bridgeJson({ ok: true, hintId: id, auditId });
  }

  if (action === "sanctions") {
    const rows = await sql<{
      id: string;
      discord_id: string;
      kind: string;
      reason: string | null;
      expires_at: unknown;
      active: boolean;
    }>`
      select id, discord_id, kind, reason, expires_at, active from mod_sanction
      where active = true order by created_at desc limit 200`;
    return bridgeJson({
      sanctions: rows.map((r) => ({
        id: r.id,
        discordId: r.discord_id,
        kind: r.kind,
        reason: r.reason,
        expiresAt: iso(r.expires_at),
        active: r.active,
      })),
    });
  }

  if (action === "sanction-upsert") {
    const discordId = String(body.discordId ?? "");
    const kind = String(body.kind ?? "");
    if (!DISCORD_ID.test(discordId) || (kind !== "mute" && kind !== "timeout")) {
      return bridgeError("Ungültige Sanction", 400);
    }
    const durationMs = body.durationMs == null ? null : Math.trunc(Number(body.durationMs));
    const expiresAt =
      durationMs && durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : null;
    // Alte aktive gleicher Art beenden
    await sql`update mod_sanction set active = false
      where active = true and kind = ${kind} and (discord_id = ${discordId} or (platform = 'discord' and target_id = ${discordId}))`;
    const id = newId();
    const reason = String(body.reason ?? "").slice(0, 500);
    const modBy = body.moderatorDiscordId ? String(body.moderatorDiscordId) : "bot";
    await sql`
      insert into mod_sanction (
        id, discord_id, kind, reason, moderator_discord_id, moderation_request_id, expires_at, active,
        platform, target_id, type, created_by
      ) values (
        ${id}, ${discordId}, ${kind}, ${reason},
        ${body.moderatorDiscordId ? String(body.moderatorDiscordId) : null},
        ${body.moderationRequestId ? String(body.moderationRequestId) : null},
        ${expiresAt}, true,
        ${"discord"}, ${discordId}, ${kind}, ${modBy}
      )`;
    const auditId = await audit("bot", "sanction", { targetId: discordId, detail: `${kind} ${expiresAt || "unbegrenzt"}` });
    return bridgeJson({ ok: true, sanctionId: id, auditId });
  }

  if (action === "sanction-clear") {
    const sanctionId = String(body.sanctionId ?? "");
    if (!sanctionId) return bridgeError("sanctionId fehlt", 400);
    await sql`update mod_sanction set active = false where id = ${sanctionId}`;
    return bridgeJson({ ok: true });
  }

  if (action === "warn-count") {
    const discordId = String(body.discordId ?? "");
    if (!DISCORD_ID.test(discordId)) return bridgeError("Ungültige Discord-ID", 400);
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from moderation_request
      where target_discord_id = ${discordId} and action = 'warn' and status = 'success'
        and created_at > now() - interval '30 days'`;
    const count = rows[0]?.n ?? 0;
    const name = await discordName(discordId);
    const suggestTimeout = count >= 3;
    if (suggestTimeout) {
      // Alert in Outbox (Dedup)
      const channelId = await modChannelId();
      if (/^\d{17,22}$/.test(channelId)) {
        const dedupe = `warn-stage:${discordId}:${count}`;
        const existing = await sql`select 1 from bot_outbox where dedupe_key = ${dedupe} and created_at > now() - interval '1 day'`;
        if (!existing.length) {
          const embed = {
            title: "Stufen-Logik · Timeout vorschlagen",
            description: `**${name}** hat **${count}** Warnungen (30 Tage). Kein Auto-Timeout.`,
            fields: [{ name: "Ziel", value: `${name} (${discordId})` }],
            color: 0xfbbf24,
          };
          await sql`
            insert into bot_outbox (id, channel_id, content, kind, embed_json, dedupe_key, ref_id)
            values (${newId()}, ${channelId}, ${`Timeout-Vorschlag für ${name}`}, 'alert', ${JSON.stringify(embed)}, ${dedupe}, ${discordId})`;
        }
      }
    }
    return bridgeJson({ count, suggestTimeout, targetName: name });
  }

  if (action === "vote-event") {
    // Desktop/Server meldet Vote-Start/Cast/Ergebnis → eine Embed-Karte (edit)
    const voteId = String(body.voteId ?? body.id ?? "").slice(0, 120);
    if (!voteId) return bridgeError("voteId fehlt", 400);
    const channelId = (await modChannelId()) || (await getSetting("duty_channel_id", ""));
    if (!/^\d{17,22}$/.test(channelId)) return bridgeError("Kein Mod-/Duty-Channel gesetzt.", 400);
    let auditId = String(body.auditId ?? "");
    if (!auditId) {
      auditId = await audit("bot", "votekick", {
        target: String(body.target ?? ""),
        targetId: voteId,
        detail: String(body.result ?? "open"),
      });
    }
    const payload = {
      voteId,
      target: body.target,
      initiator: body.initiator,
      world: body.world,
      quorum: body.quorum,
      votesNeeded: body.votesNeeded,
      endsAt: body.endsAt,
      result: body.result ?? null,
      at: body.at || new Date().toISOString(),
      auditId,
      clipRequested: Boolean(body.clipRequested),
    };
    const existing = await sql<{ discord_message_id: string | null }>`
      select discord_message_id from bot_vote_mirror where vote_id = ${voteId}`;
    await sql`
      insert into bot_vote_mirror (vote_id, channel_id, discord_message_id, payload_json, audit_id, updated_at)
      values (${voteId}, ${channelId}, ${existing[0]?.discord_message_id ?? null}, ${JSON.stringify(payload)}, ${auditId}, now())
      on conflict (vote_id) do update set
        payload_json = excluded.payload_json, audit_id = excluded.audit_id, updated_at = now()`;
    const outboxId = newId();
    await sql`
      insert into bot_outbox (id, channel_id, content, kind, embed_json, discord_message_id, ref_id, dedupe_key)
      values (${outboxId}, ${channelId}, ${`Votekick ${payload.target}`}, 'vote', ${JSON.stringify(payload)},
              ${existing[0]?.discord_message_id ?? null}, ${voteId}, ${`vote:${voteId}`})`;
    return bridgeJson({ ok: true, auditId, outboxId });
  }

  if (action === "outbox-ack") {
    const messageId = String(body.discordMessageId ?? "");
    if (body.outboxId) {
      await sql`update bot_outbox set discord_message_id = ${messageId || null} where id = ${String(body.outboxId)}`;
    }
    if (body.voteId) {
      await sql`update bot_vote_mirror set discord_message_id = ${messageId || null}, updated_at = now() where vote_id = ${String(body.voteId)}`;
    }
    return bridgeJson({ ok: true });
  }

  if (action === "clip-request") {
    const id = newId();
    const auditId =
      String(body.auditId ?? "") ||
      (await audit("bot", "clip-request", {
        targetId: body.voteId ? String(body.voteId) : undefined,
        detail: String(body.reason ?? "Clip anfordern"),
      }));
    await sql`
      insert into bot_clip_request (id, vote_id, audit_id, reason, requested_by_discord_id, status)
      values (${id}, ${body.voteId ? String(body.voteId) : null}, ${auditId},
              ${String(body.reason ?? "").slice(0, 300)},
              ${body.discordId ? String(body.discordId) : null}, 'queued')`;
    return bridgeJson({ ok: true, requestId: id, auditId });
  }

  if (action === "case-stub") {
    const auditId =
      String(body.auditId ?? "") ||
      (await audit("bot", "case-stub", {
        targetId: body.voteId ? String(body.voteId) : undefined,
        detail: "Fall anlegen (Stub)",
      }));
    // Evidence-API braucht Session-Auth – Stub liefert Audit-ID; Desktop/Evidence kann nachziehen.
    return bridgeJson({
      ok: true,
      auditId,
      casePath: null,
      error: null,
      note: "Stub: vollständige Fallakte über FurrEvidence / Clips-Agent mit auditId verknüpfen.",
    });
  }

  if (action === "flag") {
    const id = newId();
    const kind = String(body.kind ?? "antitroll").slice(0, 40);
    const discordId = body.discordId ? String(body.discordId) : null;
    const context = String(body.context ?? "").slice(0, 1000);
    await sql`
      insert into mod_flag (id, kind, discord_id, context, source, active, alerted)
      values (${id}, ${kind}, ${discordId}, ${context}, ${String(body.source ?? "bot").slice(0, 40)}, true, false)`;
    const channelId = await modChannelId();
    if (/^\d{17,22}$/.test(channelId)) {
      const dedupe = `flag:${kind}:${discordId || "x"}:${context.slice(0, 40)}`;
      const embed = {
        title: kind === "automod" ? "Anti-Troll · AutoMod" : "Anti-Troll · Flag",
        description: context || "Server-Flag gesetzt (kein Auto-Ban).",
        fields: discordId ? [{ name: "Nutzer", value: `<@${discordId}> (\`${discordId}\`)` }] : [],
        color: 0xff007f,
      };
      await sql`
        insert into bot_outbox (id, channel_id, content, kind, embed_json, dedupe_key, ref_id)
        values (${newId()}, ${channelId}, ${embed.title}, 'flag', ${JSON.stringify(embed)}, ${dedupe}, ${id})`;
    }
    const auditId = await audit("bot", "flag", { targetId: discordId ?? undefined, detail: `${kind}: ${context.slice(0, 200)}` });
    return bridgeJson({ ok: true, flagId: id, auditId });
  }

  if (action === "moderation-queue") {
    // Discord-Button → Moderation einreihen (Bot als Executor später)
    const actionName = String(body.action ?? "").toLowerCase();
    const targetDiscordId = String(body.targetDiscordId ?? "");
    const moderatorDiscordId = String(body.moderatorDiscordId ?? "");
    const reason = String(body.reason ?? "").trim();
    const durationMs = body.durationMs == null ? null : Math.trunc(Number(body.durationMs));
    if (!["warn", "timeout", "mute", "ban"].includes(actionName)) return bridgeError("Unbekannte Aktion", 400);
    if (!DISCORD_ID.test(targetDiscordId) || !DISCORD_ID.test(moderatorDiscordId)) {
      return bridgeError("Ungültige Discord-ID", 400);
    }
    if (reason.length < 3) return bridgeError("Begründung zu kurz", 400);
    const modUser = await resolveUserIdByDiscord(moderatorDiscordId);
    if (!modUser) return bridgeError("Moderator ohne FurrBox-Konto.", 404);
    const id = newId();
    await sql`
      insert into moderation_request (id, action, moderator_user_id, moderator_discord_id, target_discord_id, reason, duration_ms)
      values (${id}, ${actionName}, ${modUser}, ${moderatorDiscordId}, ${targetDiscordId}, ${reason}, ${durationMs})`;
    return bridgeJson({ ok: true, requestId: id });
  }

  if (action === "duty-empty-alert") {
    // Server signalisiert: Instanz offen, niemand anwesend
    const channelId = await getSetting("duty_channel_id", "1434484156431204382");
    if (!/^\d{17,22}$/.test(channelId)) return bridgeJson({ ok: false, skipped: true });
    const dedupe = `duty-empty:${new Date().toISOString().slice(0, 13)}`; // max 1x/Stunde
    const existing = await sql`select 1 from bot_outbox where dedupe_key = ${dedupe}`;
    if (existing.length) return bridgeJson({ ok: true, deduped: true });
    const headline = String(body.headline ?? "Gruppen-Instanz offen");
    const embed = {
      title: "Duty · Niemand anwesend",
      description: `**${headline}**\nInstanz ist offen, aber niemand ist anwesend (Duty).`,
      color: 0xf59e0b,
    };
    await sql`
      insert into bot_outbox (id, channel_id, content, kind, embed_json, dedupe_key)
      values (${newId()}, ${channelId}, ${'Instanz offen, niemand anwesend'}, 'duty', ${JSON.stringify(embed)}, ${dedupe})`;
    return bridgeJson({ ok: true });
  }

  return null;
}

/** Nach Instanz-öffnen: wenn niemand on_duty → Duty-Empty-Alert. */
export async function maybeEnqueueDutyEmptyAlert(headline: string) {
  const sql = await getSql();
  const onDuty = await sql<{ n: number }>`
    select count(*)::int as n from mod_duty d
    left join furr_presence p on p.user_id = d.user_id
    where d.on_duty and coalesce(d.status, 'off') = 'on'
      and coalesce(p.last_heartbeat_at > now() - interval '15 minutes', false)`;
  if ((onDuty[0]?.n ?? 0) > 0) return;
  await handleIdeenBridge("duty-empty-alert", { headline });
}

