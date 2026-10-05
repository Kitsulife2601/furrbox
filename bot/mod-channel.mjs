// Mod-Channel: Vote-Spiegel (eine Embed-Karte), Alerts mit Dedup + Quiet-Hours, Buttons.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const COLORS = {
  voteOpen: 0xf59e0b,
  voteSuccess: 0x22c55e,
  voteFailed: 0xef4444,
  alert: 0xff007f,
  info: 0x00f0ff,
  warn: 0xfbbf24,
};

/** @type {Map<string, number>} */
const recentAlerts = new Map();
let quietHours = { enabled: false, start: "23:00", end: "07:00", tz: "Europe/Berlin", minIntervalSec: 30 };

export function setQuietHoursConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return;
  quietHours = {
    enabled: Boolean(cfg.enabled),
    start: String(cfg.start || "23:00"),
    end: String(cfg.end || "07:00"),
    tz: String(cfg.tz || "Europe/Berlin"),
    minIntervalSec: Math.max(5, Number(cfg.minIntervalSec) || 30),
  };
}

function berlinParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: quietHours.tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function parseHm(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(now = new Date()) {
  if (!quietHours.enabled) return false;
  const cur = berlinParts(now);
  const start = parseHm(quietHours.start);
  const end = parseHm(quietHours.end);
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

function allowAlert(dedupeKey, force = false) {
  if (!force && inQuietHours()) return false;
  const key = String(dedupeKey || "");
  if (!key) return true;
  const last = recentAlerts.get(key) || 0;
  const minMs = quietHours.minIntervalSec * 1000;
  if (Date.now() - last < minMs) return false;
  recentAlerts.set(key, Date.now());
  // Memory-Cap
  if (recentAlerts.size > 500) {
    const cutoff = Date.now() - 60 * 60_000;
    for (const [k, t] of recentAlerts) if (t < cutoff) recentAlerts.delete(k);
  }
  return true;
}

export function buildVoteEmbed(payload) {
  const result = payload.result; // null | 'succeeded' | 'failed'
  const color = result === "succeeded" ? COLORS.voteSuccess : result === "failed" ? COLORS.voteFailed : COLORS.voteOpen;
  const title =
    result === "succeeded"
      ? "Votekick · Erfolgreich"
      : result === "failed"
        ? "Votekick · Gescheitert"
        : "Votekick · Läuft";
  const endsAt = payload.endsAt ? Date.parse(payload.endsAt) : null;
  const timer =
    !result && endsAt && Number.isFinite(endsAt)
      ? `<t:${Math.floor(endsAt / 1000)}:R>`
      : result
        ? "beendet"
        : "läuft";
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`Ziel: **${String(payload.target || "?").slice(0, 100)}**`)
    .addFields(
      { name: "Gestartet von", value: String(payload.initiator || "unbekannt").slice(0, 100), inline: true },
      { name: "Quorum", value: String(payload.quorum || payload.votesNeeded || "–").slice(0, 40), inline: true },
      { name: "Timer", value: timer, inline: true },
      { name: "Welt", value: String(payload.world || "–").slice(0, 100), inline: true },
      { name: "Ergebnis", value: result ? String(result) : "offen", inline: true },
      { name: "Audit", value: payload.auditId ? `\`${payload.auditId}\`` : "–", inline: true },
    )
    .setTimestamp(payload.at ? new Date(payload.at) : new Date())
    .setFooter({ text: "FurrBox · Votekick-Spiegel" });
  return embed;
}

export function voteComponents(payload) {
  const voteId = String(payload.voteId || payload.id || "").slice(0, 64);
  const auditId = String(payload.auditId || "").slice(0, 64);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:clip:${voteId}:${auditId}`.slice(0, 100))
      .setLabel("Clip anfordern")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(payload.clipRequested)),
    new ButtonBuilder()
      .setCustomId(`fb:case:${voteId}:${auditId}`.slice(0, 100))
      .setLabel("Fall anlegen")
      .setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

export function buildAlertEmbed({ title, description, fields = [], color = COLORS.alert }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(String(title || "FurrBox Alert").slice(0, 256))
    .setDescription(String(description || "–").slice(0, 4000))
    .setTimestamp(new Date())
    .setFooter({ text: "FurrBox · Alert" });
  for (const f of fields.slice(0, 20)) {
    embed.addFields({ name: String(f.name).slice(0, 256), value: String(f.value).slice(0, 1024), inline: Boolean(f.inline) });
  }
  return embed;
}

/**
 * Outbox-Nachricht senden oder bestehende Vote-Message editieren.
 * @returns {Promise<string|null>} discord message id
 */
export async function deliverOutboxMessage(client, m, log) {
  const channel = await client.channels.fetch(m.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("Kanal nicht erreichbar.");

  const kind = m.kind || "plain";
  let embeds = [];
  let components = [];
  let content = m.content ? String(m.content).slice(0, 1900) : undefined;

  if (m.embedJson) {
    try {
      const raw = typeof m.embedJson === "string" ? JSON.parse(m.embedJson) : m.embedJson;
      if (kind === "vote") {
        embeds = [buildVoteEmbed(raw)];
        components = voteComponents(raw);
        content = undefined;
      } else {
        embeds = [buildAlertEmbed(raw)];
        content = content || undefined;
      }
    } catch {
      // plain fallback
    }
  }

  // Dedup / Quiet-Hours nur für Alerts (Votes immer durchlassen)
  if (kind === "alert" || kind === "duty" || kind === "flag") {
    const key = m.dedupeKey || `${kind}:${m.channelId}:${(content || "").slice(0, 40)}`;
    if (!allowAlert(key, Boolean(m.force))) {
      log(`Alert unterdrückt (Quiet-Hours/Dedup): ${key}`);
      return m.discordMessageId || null;
    }
  }

  const payload = {
    content,
    embeds: embeds.length ? embeds : undefined,
    components: components.length ? components : [],
    allowedMentions: m.allowPing ? { parse: ["roles", "users"] } : { parse: [] },
  };

  if (m.discordMessageId) {
    try {
      const msg = await channel.messages.fetch(m.discordMessageId);
      await msg.edit(payload);
      return msg.id;
    } catch {
      // Message weg → neu senden
    }
  }
  const sent = await channel.send(payload);
  return sent.id;
}

/** Timeout-Vorschlag nach 3 Warnungen – mit Confirm-Button. */
export function buildTimeoutSuggestEmbed({ targetId, targetName, count, reason }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle("Stufen-Logik · Timeout vorschlagen")
    .setDescription(
      `**${targetName || targetId}** hat **${count}** Warnungen (30 Tage).\nKein Auto-Timeout – bitte bestätigen.`,
    )
    .addFields(
      { name: "Ziel", value: `<@${targetId}> (\`${targetId}\`)`, inline: false },
      { name: "Letzter Grund", value: String(reason || "–").slice(0, 1024) },
    )
    .setTimestamp(new Date());
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:timeout-suggest:${targetId}`.slice(0, 100))
      .setLabel("Timeout bestätigen (1 h)")
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}
