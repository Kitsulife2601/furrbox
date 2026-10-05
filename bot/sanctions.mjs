// Dauerhafte Mute/Timeout-Sanctions: beim Start abgleichen, Timer neu setzen.
import { PermissionsBitField } from "discord.js";

/**
 * @param {{ bridge: Function, guild: Function, mutedRole: Function, log: Function, client: import('discord.js').Client }} ctx
 */
export async function reconcileSanctions(ctx) {
  const { bridge, guild, mutedRole, log } = ctx;
  let list = [];
  try {
    const res = await bridge("sanctions");
    list = Array.isArray(res?.sanctions) ? res.sanctions : [];
  } catch (err) {
    log("Sanction-Abgleich fehlgeschlagen:", err instanceof Error ? err.message : err);
    return;
  }
  if (!list.length) {
    log("Sanction-Abgleich: keine aktiven Sanctions.");
    return;
  }
  const g = await guild();
  const role = await mutedRole(g).catch(() => null);
  let restored = 0;
  let cleared = 0;
  for (const s of list) {
    const member = await g.members.fetch(s.discordId).catch(() => null);
    if (!member) continue;
    const expiresAt = s.expiresAt ? Date.parse(s.expiresAt) : null;
    const expired = expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now();
    if (expired || s.active === false) {
      if (s.kind === "mute" && role) await member.roles.remove(role, "FurrBox: Mute abgelaufen (Abgleich)").catch(() => undefined);
      if (s.kind === "timeout" && member.isCommunicationDisabled()) {
        await member.timeout(null, "FurrBox: Timeout abgelaufen (Abgleich)").catch(() => undefined);
      }
      await bridge("sanction-clear", { sanctionId: s.id }).catch(() => undefined);
      cleared += 1;
      continue;
    }
    if (s.kind === "mute" && role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, s.reason || "FurrBox: Mute wiederhergestellt").catch(() => undefined);
      restored += 1;
    }
    if (s.kind === "timeout" && expiresAt) {
      const remaining = Math.max(60_000, expiresAt - Date.now());
      // Discord Timeout max 28 Tage
      await member.timeout(Math.min(remaining, 28 * 24 * 60 * 60_000), s.reason || "FurrBox: Timeout wiederhergestellt").catch(() => undefined);
      restored += 1;
    }
    if (expiresAt) {
      const delay = Math.max(1_000, expiresAt - Date.now());
      setTimeout(() => {
        expireOne(ctx, s, role).catch(() => undefined);
      }, Math.min(delay, 2_147_000_000)).unref();
    }
  }
  log(`Sanction-Abgleich: ${list.length} aktiv, ${restored} wiederhergestellt, ${cleared} beendet.`);
}

async function expireOne(ctx, s, role) {
  const { bridge, guild, log } = ctx;
  const g = await guild();
  const member = await g.members.fetch(s.discordId).catch(() => null);
  if (member) {
    if (s.kind === "mute" && role) await member.roles.remove(role, "FurrBox: Mute abgelaufen").catch(() => undefined);
    if (s.kind === "timeout") await member.timeout(null, "FurrBox: Timeout abgelaufen").catch(() => undefined);
  }
  await bridge("sanction-clear", { sanctionId: s.id }).catch(() => undefined);
  log(`Sanction beendet: ${s.kind} → ${s.discordId}`);
}

/** Nach erfolgreicher Mute/Timeout-Moderation an Server melden. */
export async function reportSanction(bridge, req) {
  if (req.action !== "mute" && req.action !== "timeout") return;
  await bridge("sanction-upsert", {
    discordId: req.targetId,
    kind: req.action,
    reason: req.reason,
    moderatorDiscordId: req.moderatorId,
    moderationRequestId: req.requestId,
    durationMs: req.durationMs ?? null,
  });
}

/** Warn-Zähler: bei ≥3 Warnungen Timeout vorschlagen (kein Auto). */
export async function maybeSuggestTimeout(bridge, log, targetId) {
  try {
    const res = await bridge("warn-count", { discordId: targetId });
    if ((res?.count ?? 0) >= 3 && res?.suggestTimeout) {
      log(`Warn-Stufe: ${res.count} Warnungen für ${targetId} → Timeout-Vorschlag in Mod-Channel.`);
    }
  } catch (err) {
    log("Warn-Zähler fehlgeschlagen:", err instanceof Error ? err.message : err);
  }
}

export { PermissionsBitField };
