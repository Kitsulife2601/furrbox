// Slash-Commands: /duty /whitelist /hint + Button-Handler
import {
  ApplicationCommandOptionType,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
} from "discord.js";
import { hintLimit, sendChatbox } from "./osc-hint.mjs";

const STAFF_KEYS = ["dev", "owner", "moderator", "supporter"];
const WL_MANAGE_KEYS = ["dev", "owner"];

export function buildCommandDefs() {
  return [
    {
      name: "duty",
      description: "Anwesenheit setzen (kann moderieren)",
      defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
      options: [
        {
          name: "status",
          description: "on = anwesend, away = kurz weg, off = nicht anwesend",
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: "on – anwesend", value: "on" },
            { name: "away – kurz weg", value: "away" },
            { name: "off – nicht anwesend", value: "off" },
          ],
        },
      ],
    },
    {
      name: "whitelist",
      description: "FurrBox-Whitelist prüfen / verwalten",
      defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
      options: [
        {
          name: "aktion",
          description: "check / add / remove",
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: "check", value: "check" },
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
          ],
        },
        {
          name: "user",
          description: "Discord-Nutzer",
          type: ApplicationCommandOptionType.User,
          required: true,
        },
        {
          name: "username",
          description: "FurrBox-Nutzername (nur bei add)",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
        {
          name: "password",
          description: "Startpasswort (nur bei add, min. 8 Zeichen)",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
        {
          name: "note",
          description: "Notiz (nur bei add)",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
      ],
    },
    {
      name: "hint",
      description: "Text in die VRChat-Chatbox (und Overlay) senden",
      defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
      options: [
        {
          name: "text",
          description: `Hinweis (max. ${hintLimit()} Zeichen)`,
          type: ApplicationCommandOptionType.String,
          required: true,
          max_length: hintLimit(),
        },
      ],
    },
  ];
}

export async function registerGuildCommands({ token, clientId, guildId, log }) {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = buildCommandDefs();
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  log(`Slash-Commands registriert (${body.length}) für Guild ${guildId}.`);
}

function staffOk(member, roleIds, keys = STAFF_KEYS) {
  return keys.some((k) => member.id === roleIds[k] || member.roles.cache.has(roleIds[k]));
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleSlash(interaction, ctx) {
  const { bridge, roleIds, log, dutyRoleId } = ctx;
  const member = interaction.member;
  if (!member || !staffOk(member, roleIds)) {
    await interaction.reply({ content: "Nur Staff darf diesen Befehl nutzen.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "duty") {
    const status = interaction.options.getString("status", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await bridge("duty", { discordId: member.id, status });
    // Optionale Duty-Rolle spiegeln
    if (dutyRoleId && interaction.guild) {
      try {
        const m = await interaction.guild.members.fetch(member.id);
        if (status === "on") await m.roles.add(dutyRoleId, "FurrBox Duty on").catch(() => undefined);
        else await m.roles.remove(dutyRoleId, "FurrBox Duty off/away").catch(() => undefined);
      } catch {
        // ignore
      }
    }
    const label = status === "on" ? "anwesend" : status === "away" ? "kurz weg (away)" : "nicht anwesend";
    await interaction.editReply({
      content: `Duty auf **${label}** gesetzt.${res?.auditId ? ` Audit: \`${res.auditId}\`` : ""}`,
    });
    log(`Duty ${status} von ${member.user?.tag || member.id}`);
    return;
  }

  if (interaction.commandName === "whitelist") {
    const aktion = interaction.options.getString("aktion", true);
    const user = interaction.options.getUser("user", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (aktion === "check") {
      const res = await bridge("whitelist-check", { discordId: user.id });
      const lines = [
        res?.onWhitelist ? "✅ Auf der Whitelist" : "❌ Nicht auf der Whitelist",
        res?.username ? `Nutzername: \`${res.username}\`` : null,
        res?.note ? `Notiz: ${res.note}` : null,
        res?.mustChangePassword ? "⚠️ Muss Startpasswort ändern" : null,
        res?.auditId ? `Audit: \`${res.auditId}\`` : null,
      ].filter(Boolean);
      await interaction.editReply({ content: lines.join("\n") || "Keine Daten." });
      return;
    }
    if (!staffOk(member, roleIds, WL_MANAGE_KEYS)) {
      await interaction.editReply({ content: "Add/Remove nur für Owner/Dev." });
      return;
    }
    if (aktion === "remove") {
      const res = await bridge("whitelist-remove", { discordId: user.id, byDiscordId: member.id });
      await interaction.editReply({
        content: `Entfernt.${res?.auditId ? ` Audit: \`${res.auditId}\`` : ""}`,
      });
      return;
    }
    if (aktion === "add") {
      const username = interaction.options.getString("username");
      const password = interaction.options.getString("password");
      const note = interaction.options.getString("note") || "";
      if (!username || !password) {
        await interaction.editReply({ content: "Für add brauchst du `username` und `password`." });
        return;
      }
      const res = await bridge("whitelist-add", {
        discordId: user.id,
        username,
        password,
        note,
        byDiscordId: member.id,
      });
      await interaction.editReply({
        content: `Freigeschaltet als \`${username}\`.${res?.auditId ? ` Audit: \`${res.auditId}\`` : ""}\n⚠️ Passwort nicht im Chat teilen – nur ephemeral.`,
      });
      return;
    }
  }

  if (interaction.commandName === "hint") {
    const text = interaction.options.getString("text", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await bridge("hint", { text, discordId: member.id });
    let oscOk = false;
    let oscErr = null;
    try {
      await sendChatbox(text);
      oscOk = true;
    } catch (err) {
      oscErr = err instanceof Error ? err.message : String(err);
    }
    await interaction.editReply({
      content: [
        `Hinweis an Server gesendet${res?.hintId ? ` (\`${res.hintId}\`)` : ""}.`,
        oscOk ? "Chatbox (OSC) lokal gesendet." : `OSC nicht gesendet: ${oscErr || "unbekannt"} (Desktop/VRChat OSC prüfen).`,
        res?.auditId ? `Audit: \`${res.auditId}\`` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return;
  }
}

/**
 * Button-Clicks: Clip anfordern / Fall anlegen / Timeout bestätigen
 */
export async function handleButton(interaction, ctx) {
  const { bridge, roleIds, log, guild, label } = ctx;
  const member = interaction.member;
  if (!member || !staffOk(member, roleIds)) {
    await interaction.reply({ content: "Nur Staff.", flags: MessageFlags.Ephemeral });
    return;
  }
  const id = interaction.customId || "";
  // Buttons below the "new group instance" message: mark yourself anwesend / nicht anwesend.
  if (id === "fb:duty:on" || id === "fb:duty:off") {
    const status = id.endsWith(":on") ? "on" : "off";
    let res;
    try {
      res = await bridge("duty", { discordId: member.id, status, withLines: true });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      await interaction.reply({
        content: /HTTP 404/.test(text)
          ? "Du hast noch kein FurrBox-Konto. Melde dich einmal in FurrBox mit Discord an, dann geht der Knopf."
          : "Das hat gerade nicht geklappt. Versuch es gleich noch einmal.",
        flags: MessageFlags.Ephemeral,
      });
      log("Duty-Knopf fehlgeschlagen:", text);
      return;
    }
    // Refresh the list in the message (first line = the instance, last line = the team mark).
    const old = String(interaction.message?.content ?? "").split("\n");
    if (Array.isArray(res?.lines) && old.length) {
      await interaction.update({ content: [old[0], ...res.lines].join("\n").slice(0, 2000), allowedMentions: { parse: [] } });
    } else {
      await interaction.reply({ content: status === "on" ? "Du bist jetzt anwesend." : "Du bist nicht mehr anwesend.", flags: MessageFlags.Ephemeral });
    }
    log(`Duty ${status} (Knopf) von ${member.user?.tag || member.id}`);
    return;
  }
  if (id.startsWith("fb:clip:")) {
    const [, , voteId, auditId] = id.split(":");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await bridge("clip-request", {
      voteId: voteId || null,
      auditId: auditId || null,
      reason: "Discord-Button Clip anfordern",
      discordId: member.id,
    });
    await interaction.editReply({
      content: `Clip angefordert.${res?.requestId ? ` ID: \`${res.requestId}\`` : ""}${res?.auditId ? ` · Audit: \`${res.auditId}\`` : ""}\nAufnahme macht der Clips-Agent.`,
    });
    log(`Clip-Request von ${member.user?.tag}`);
    return;
  }
  if (id.startsWith("fb:case:")) {
    const [, , voteId, auditId] = id.split(":");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await bridge("case-stub", {
      voteId: voteId || null,
      auditId: auditId || null,
      discordId: member.id,
    });
    await interaction.editReply({
      content: res?.ok
        ? `Fall-Stub angelegt.${res.auditId ? ` Audit: \`${res.auditId}\`` : ""}${res.casePath ? `\nPfad: \`${res.casePath}\`` : ""}\nVollständige Akte ggf. in FurrEvidence nachziehen.`
        : `Fall-Stub: ${res?.error || "Server hat noch keine Evidence-Anbindung für diesen Button."}`,
    });
    return;
  }
  if (id.startsWith("fb:timeout-suggest:")) {
    const targetId = id.split(":")[2];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Queued moderation via bridge helper
    const res = await bridge("moderation-queue", {
      action: "timeout",
      targetDiscordId: targetId,
      moderatorDiscordId: member.id,
      reason: "Stufen-Logik: 3 Warnungen – bestätigt per Discord-Button",
      durationMs: 60 * 60_000,
    });
    await interaction.editReply({
      content: res?.requestId
        ? `Timeout (1 h) eingereiht für <@${targetId}>. Request: \`${res.requestId}\``
        : `Konnte nicht einreihen: ${res?.error || "unbekannt"}`,
    });
    return;
  }
  await interaction.reply({ content: "Unbekannter Button.", flags: MessageFlags.Ephemeral });
}
