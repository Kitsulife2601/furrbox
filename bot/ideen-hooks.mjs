// Dünne Integration der Ideen-Features (Duty/Vote/Alerts/WL/Hint/Sanctions/AutoMod).
// index.mjs ruft nur installIdeenFeatures(...) auf – Konflikte mit messages-v2 / events-calendar vermeiden.
import { GatewayIntentBits, Events } from "discord.js";
import { registerGuildCommands, handleSlash, handleButton } from "./commands.mjs";
import { reconcileSanctions, reportSanction, maybeSuggestTimeout } from "./sanctions.mjs";
import {
  deliverOutboxMessage,
  setQuietHoursConfig,
  buildTimeoutSuggestEmbed,
  inQuietHours,
} from "./mod-channel.mjs";

const EXTRA_INTENTS = [GatewayIntentBits.AutoModerationExecution, GatewayIntentBits.GuildMessageReactions];

/**
 * Zusätzliche Intents für AutoMod (vor Client-Erstellung mergen).
 * @param {number[]} intents
 */
export function withIdeenIntents(intents) {
  const set = new Set(intents);
  for (const i of EXTRA_INTENTS) set.add(i);
  return [...set];
}

/**
 * @param {object} ctx
 * @param {import('discord.js').Client} ctx.client
 * @param {Function} ctx.bridge
 * @param {Function} ctx.guild
 * @param {Function} ctx.mutedRole
 * @param {Function} ctx.log
 * @param {Record<string,string>} ctx.roleIds
 * @param {string} ctx.guildId
 * @param {string} ctx.token
 * @param {string} [ctx.dutyRoleId]
 * @param {Function} [ctx.label]
 */
export function installIdeenFeatures(ctx) {
  const { client, bridge, guild, mutedRole, log, roleIds, guildId, token, dutyRoleId } = ctx;

  client.once("clientReady", () => {
    void (async () => {
      try {
        const settings = await bridge("bot-settings").catch(() => null);
        if (settings?.quietHours) setQuietHoursConfig(settings.quietHours);
        if (settings?.modChannelId) ctx.modChannelId = settings.modChannelId;
      } catch {
        // ignore
      }
      try {
        const clientId = client.user?.id;
        if (clientId) await registerGuildCommands({ token, clientId, guildId, log });
      } catch (err) {
        log("Slash-Register fehlgeschlagen:", err instanceof Error ? err.message : err);
      }
      await reconcileSanctions({ bridge, guild, mutedRole, log, client });
    })();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlash(interaction, { bridge, roleIds, log, dutyRoleId });
        return;
      }
      if (interaction.isButton()) {
        await handleButton(interaction, { bridge, roleIds, log, guild, label: ctx.label });
      }
    } catch (err) {
      log("Interaction-Fehler:", err instanceof Error ? err.message : err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Fehler bei der Ausführung.", ephemeral: true }).catch(() => undefined);
      }
    }
  });

  client.on(Events.AutoModerationActionExecution, async (exec) => {
    try {
      const userId = exec.userId || exec.member?.id;
      const ruleName = exec.ruleTriggerType != null ? String(exec.ruleTriggerType) : "automod";
      await bridge("flag", {
        kind: "automod",
        discordId: userId || null,
        context: `AutoMod Regel ${exec.ruleId || "?"} · ${ruleName} · Kanal ${exec.channelId || "?"}`,
        source: "discord-automod",
      });
      log(`AutoMod-Flag: ${userId || "?"} (${exec.ruleId})`);
    } catch (err) {
      log("AutoMod-Bridge fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  });
}

/** Outbox inkl. Embeds/Vote – ersetzt den einfachen content-only Send. */
export async function deliverIdeenOutbox(client, messages, bridge, log) {
  for (const m of messages ?? []) {
    try {
      const messageId = await deliverOutboxMessage(client, m, log);
      if (messageId && (m.id || m.voteId || m.refId)) {
        await bridge("outbox-ack", {
          outboxId: m.id || null,
          voteId: m.voteId || m.refId || null,
          discordMessageId: messageId,
        }).catch(() => undefined);
      }
    } catch (err) {
      log("Discord-Nachricht fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  }
}

/** Nach erfolgreicher Moderation: Sanction speichern + Warn-Stufe. */
export async function afterModerationSuccess(bridge, log, req, client, modChannelId) {
  try {
    await reportSanction(bridge, req);
  } catch (err) {
    log("Sanction-Upsert fehlgeschlagen:", err instanceof Error ? err.message : err);
  }
  if (req.action === "warn") {
    try {
      const res = await bridge("warn-count", { discordId: req.targetId });
      if (res?.suggestTimeout && modChannelId && client) {
        const channel = await client.channels.fetch(modChannelId).catch(() => null);
        if (channel?.isTextBased?.() && !inQuietHours()) {
          const payload = buildTimeoutSuggestEmbed({
            targetId: req.targetId,
            targetName: res.targetName,
            count: res.count,
            reason: req.reason,
          });
          await channel.send({ ...payload, allowedMentions: { parse: [] } });
        }
      }
      await maybeSuggestTimeout(bridge, log, req.targetId);
    } catch (err) {
      log("Warn-Stufe fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  }
}
