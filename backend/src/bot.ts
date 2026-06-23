import { PrismaClient } from "@prisma/client";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Guild,
  GuildMember,
  Partials,
  PermissionsBitField,
  Role
} from "discord.js";
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { io as createSocket, type Socket } from "socket.io-client";

type DiscordPrivilege = "none" | "supporter" | "moderator" | "owner" | "dev";
type ModerationAction = "ban" | "warn" | "timeout" | "mute";
type ModerationRequest = {
  requestId: string;
  source: "dashboard";
  action: ModerationAction;
  moderatorId: string;
  targetId: string;
  reason: string;
  durationMs?: number;
};
type ModerationResult = ModerationRequest & {
  status: "success" | "failed";
  error?: string;
  completedAt: string;
  moderatorName?: string;
  moderatorRoleName?: string;
  targetName?: string;
  targetRoleName?: string;
};
type MessageInspectRequest = {
  requestId: string;
  messageId: string;
};
type MessageInspectResult = MessageInspectRequest & {
  found: boolean;
  content: string;
  authorId?: string;
  authorName?: string;
  channelId?: string;
  channelName?: string;
  createdAt?: string;
  error?: string;
};
type DiscordMemberSnapshot = {
  discordId: string;
  username: string;
  nickname: string | null;
  displayName: string;
  roles: string[];
  roleNames: string[];
  highestPrivilege: DiscordPrivilege;
  discordStatus: "online" | "idle" | "dnd" | "offline";
  isDiscordOnline: boolean;
  lastDiscordPresenceAt: string | null;
  isSupporter: boolean;
  isModerator: boolean;
  isOwner: boolean;
  isDev: boolean;
};
type DiscordPresenceStatus = "online" | "idle" | "dnd" | "offline";
type AccountOnboardingInvitePayload = {
  discordId: string;
  username: string;
  displayName: string;
  roleName: string;
  setupUrl: string;
  expiresAt: string;
};

const ROLE_IDS = {
  dev: "1312104318006071328",
  owner: "1395506854549000202",
  moderator: "1397883231134547989",
  supporter: "1395506316801343558"
} as const;
const ROLE_DISPLAY_NAMES: Record<string, string> = {
  [ROLE_IDS.dev]: "Dev",
  [ROLE_IDS.owner]: "Fish Nagie Owner",
  [ROLE_IDS.moderator]: "Fish Moderator",
  [ROLE_IDS.supporter]: "Supporter"
};
const FISH_GUILD_ID = "1386651125327073470";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID || FISH_GUILD_ID;
const bridgeUrl = process.env.FURRBOX_BACKEND_URL || "http://localhost:4000";
const bridgeToken = process.env.BOT_BRIDGE_TOKEN;
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
const databaseUrl = process.env.DATABASE_URL || `file:${path.join(storageDir, "furrbox.db")}`;
const mutedRoleId = process.env.DISCORD_MUTED_ROLE_ID;
const muteRoleName = process.env.DISCORD_MUTED_ROLE_NAME || "Muted";

if (!token) throw new Error("DISCORD_TOKEN is required.");
if (!bridgeToken) throw new Error("BOT_BRIDGE_TOKEN is required.");

process.env.DATABASE_URL = databaseUrl;

const prisma = new PrismaClient();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Channel]
});
const socket: Socket = createSocket(bridgeUrl, {
  auth: { botToken: bridgeToken },
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelayMax: 8000
});

function sanitizeName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 160);
}

function publicStorageDir() {
  return path.join(storageDir, "public");
}

function displayRoleFor(member: GuildMember | null, userId?: string) {
  if (userId === ROLE_IDS.dev) return "Dev";
  if (!member) return "Unresolved";
  if (member.id === ROLE_IDS.dev) return "Dev";
  if (member.roles.cache.has(ROLE_IDS.owner) || member.id === ROLE_IDS.owner) return "Fish Nagie Owner";
  if (member.roles.cache.has(ROLE_IDS.moderator)) return "Fish Moderator";
  if (member.roles.cache.has(ROLE_IDS.supporter)) return "Supporter";
  return "Member";
}

function moderationClearanceFor(member: GuildMember) {
  if (member.id === ROLE_IDS.dev) return { roleName: "Dev", allowedActions: ["ban", "warn", "timeout", "mute"] as ModerationAction[] };
  if (member.id === ROLE_IDS.owner || member.roles.cache.has(ROLE_IDS.owner)) return { roleName: "Fish Nagie Owner", allowedActions: ["ban", "warn", "timeout", "mute"] as ModerationAction[] };
  if (member.roles.cache.has(ROLE_IDS.moderator)) return { roleName: "Fish Moderator", allowedActions: ["ban", "warn", "timeout", "mute"] as ModerationAction[] };
  if (member.roles.cache.has(ROLE_IDS.supporter)) return { roleName: "Supporter", allowedActions: ["warn", "timeout"] as ModerationAction[] };
  return { roleName: "Member", allowedActions: [] as ModerationAction[] };
}

function reportVirtualPath(targetName: string) {
  return `Dokumente/Moderation_Beweise/Discord_Logs/${sanitizeName(targetName).replace(/\s+/g, "_")}_Report.txt`;
}

function reportPhysicalPath(targetName: string) {
  return path.join(publicStorageDir(), "Dokumente", "Moderation_Beweise", "Discord_Logs", `${sanitizeName(targetName).replace(/\s+/g, "_")}_Report.txt`);
}

function hasRoleOrIdentity(member: GuildMember, id: string) {
  return member.id === id || member.roles.cache.has(id);
}

function privilegeFor(member: GuildMember): DiscordPrivilege {
  if (hasRoleOrIdentity(member, ROLE_IDS.dev)) return "dev";
  if (hasRoleOrIdentity(member, ROLE_IDS.owner)) return "owner";
  if (hasRoleOrIdentity(member, ROLE_IDS.moderator)) return "moderator";
  if (hasRoleOrIdentity(member, ROLE_IDS.supporter)) return "supporter";
  return "none";
}

function presenceFor(member: GuildMember) {
  const rawStatus = member.presence?.status;
  const status: DiscordPresenceStatus = rawStatus === "online" || rawStatus === "idle" || rawStatus === "dnd" ? rawStatus : "offline";
  return {
    discordStatus: status,
    isDiscordOnline: status === "online" || status === "idle" || status === "dnd",
    lastDiscordPresenceAt: new Date().toISOString()
  };
}

function snapshotMember(member: GuildMember): DiscordMemberSnapshot {
  const privilege = privilegeFor(member);
  const roles = member.roles.cache.filter((role) => role.id !== member.guild.id).map((role) => role.id);
  const roleNames = roles.map((roleId) => ROLE_DISPLAY_NAMES[roleId]).filter((roleName): roleName is string => Boolean(roleName));
  if (member.id === ROLE_IDS.dev && !roleNames.includes("Dev")) roleNames.unshift("Dev");
  if (member.id === ROLE_IDS.owner && !roleNames.includes("Fish Nagie Owner")) roleNames.unshift("Fish Nagie Owner");
  const presence = presenceFor(member);
  return {
    discordId: member.id,
    username: member.user.tag,
    nickname: member.nickname,
    displayName: member.displayName,
    roles,
    roleNames,
    highestPrivilege: privilege,
    discordStatus: presence.discordStatus,
    isDiscordOnline: presence.isDiscordOnline,
    lastDiscordPresenceAt: presence.lastDiscordPresenceAt,
    isSupporter: privilege === "supporter" || privilege === "moderator" || privilege === "owner" || privilege === "dev",
    isModerator: privilege === "moderator" || privilege === "owner" || privilege === "dev",
    isOwner: privilege === "owner" || privilege === "dev",
    isDev: privilege === "dev"
  };
}

async function persistMember(member: GuildMember) {
  const snapshot = snapshotMember(member);
  await prisma.discordMember.upsert({
    where: { discordId: snapshot.discordId },
    update: {
      username: snapshot.username,
      nickname: snapshot.nickname,
      displayName: snapshot.displayName,
      rolesJson: JSON.stringify(snapshot.roles),
      roleNamesJson: JSON.stringify(snapshot.roleNames),
      highestPrivilege: snapshot.highestPrivilege,
      discordStatus: snapshot.discordStatus,
      isDiscordOnline: snapshot.isDiscordOnline,
      lastDiscordPresenceAt: snapshot.lastDiscordPresenceAt ? new Date(snapshot.lastDiscordPresenceAt) : null,
      isSupporter: snapshot.isSupporter,
      isModerator: snapshot.isModerator,
      isOwner: snapshot.isOwner,
      isDev: snapshot.isDev
    },
    create: {
      discordId: snapshot.discordId,
      username: snapshot.username,
      nickname: snapshot.nickname,
      displayName: snapshot.displayName,
      rolesJson: JSON.stringify(snapshot.roles),
      roleNamesJson: JSON.stringify(snapshot.roleNames),
      highestPrivilege: snapshot.highestPrivilege,
      discordStatus: snapshot.discordStatus,
      isDiscordOnline: snapshot.isDiscordOnline,
      lastDiscordPresenceAt: snapshot.lastDiscordPresenceAt ? new Date(snapshot.lastDiscordPresenceAt) : null,
      isSupporter: snapshot.isSupporter,
      isModerator: snapshot.isModerator,
      isOwner: snapshot.isOwner,
      isDev: snapshot.isDev
    }
  });
  socket.emit("discord:members:sync", { guildId: member.guild.id, members: [snapshot] });
}

async function syncGuild(guild: Guild) {
  const members = await guild.members.fetch();
  const snapshots = members.filter((member) => !member.user.bot).map(snapshotMember);
  await prisma.$transaction(
    snapshots.map((member) =>
      prisma.discordMember.upsert({
        where: { discordId: member.discordId },
        update: {
          username: member.username,
          nickname: member.nickname,
          displayName: member.displayName,
          rolesJson: JSON.stringify(member.roles),
          roleNamesJson: JSON.stringify(member.roleNames),
          highestPrivilege: member.highestPrivilege,
          discordStatus: member.discordStatus,
          isDiscordOnline: member.isDiscordOnline,
          lastDiscordPresenceAt: member.lastDiscordPresenceAt ? new Date(member.lastDiscordPresenceAt) : null,
          isSupporter: member.isSupporter,
          isModerator: member.isModerator,
          isOwner: member.isOwner,
          isDev: member.isDev
        },
        create: {
          discordId: member.discordId,
          username: member.username,
          nickname: member.nickname,
          displayName: member.displayName,
          rolesJson: JSON.stringify(member.roles),
          roleNamesJson: JSON.stringify(member.roleNames),
          highestPrivilege: member.highestPrivilege,
          discordStatus: member.discordStatus,
          isDiscordOnline: member.isDiscordOnline,
          lastDiscordPresenceAt: member.lastDiscordPresenceAt ? new Date(member.lastDiscordPresenceAt) : null,
          isSupporter: member.isSupporter,
          isModerator: member.isModerator,
          isOwner: member.isOwner,
          isDev: member.isDev
        }
      })
    )
  );
  socket.emit("discord:members:sync", { guildId: guild.id, members: snapshots });
}

async function resolveGuild() {
  if (guildId) return client.guilds.fetch(guildId);
  const guilds = await client.guilds.fetch();
  const firstGuild = guilds.first();
  if (!firstGuild) throw new Error("The bot is not in any guild. Set DISCORD_GUILD_ID after inviting it.");
  return client.guilds.fetch(firstGuild.id);
}

async function findOrCreateMutedRole(guild: Guild): Promise<Role> {
  if (mutedRoleId) {
    const existing = await guild.roles.fetch(mutedRoleId);
    if (existing) return existing;
  }
  const cached = guild.roles.cache.find((role) => role.name.toLowerCase() === muteRoleName.toLowerCase());
  if (cached) return cached;
  if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error("Bot needs Manage Roles permission to create a Muted role.");
  }
  return guild.roles.create({
    name: muteRoleName,
    reason: "FurrBox muted role bootstrap",
    permissions: []
  });
}

async function writeTextReport(result: Required<Pick<ModerationResult, "action" | "moderatorName" | "moderatorRoleName" | "targetName" | "targetRoleName" | "reason" | "completedAt">>) {
  const physicalPath = reportPhysicalPath(result.targetName);
  const virtualPath = reportVirtualPath(result.targetName);
  await fs.mkdir(path.dirname(physicalPath), { recursive: true });
  const document = [
    "FurrBox Discord Moderation Report",
    "------------------------------------------------------------",
    `Date: ${new Date(result.completedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
    `Action: ${result.action.toUpperCase()}`,
    `Moderator Name: ${result.moderatorName} [${result.moderatorRoleName}]`,
    `Target Name: ${result.targetName} [${result.targetRoleName}]`,
    "------------------------------------------------------------",
    "Reason:",
    result.reason,
    "------------------------------------------------------------",
    ""
  ].join("\r\n");
  await fs.writeFile(physicalPath, document, "utf8");
  const stats = await fs.stat(physicalPath);
  const existing = await prisma.storedFile.findFirst({ where: { scope: "PUBLIC", name: virtualPath } });
  if (existing) {
    await prisma.storedFile.update({
      where: { id: existing.id },
      data: { size: stats.size, mimeType: "text/plain", originalName: virtualPath }
    });
  } else {
    await prisma.storedFile.create({
      data: {
        name: virtualPath,
        originalName: virtualPath,
        size: stats.size,
        mimeType: "text/plain",
        scope: "PUBLIC",
        ownerId: null
      }
    });
  }
}

async function appendWarningProfile(request: ModerationRequest) {
  await prisma.discordWarning.create({
    data: {
      id: request.requestId,
      targetId: request.targetId,
      moderatorId: request.moderatorId,
      reason: request.reason
    }
  });
}

async function resolveMemberLabel(guild: Guild, discordId: string) {
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (member) return member.nickname || member.user.tag;
  const user = await client.users.fetch(discordId).catch(() => null);
  return user?.tag || discordId;
}

async function sendOwnerAlert(request: ModerationRequest, status: "success" | "failed", error?: string) {
  const owner = await client.users.fetch(ROLE_IDS.owner);
  const guild = await resolveGuild();
  const moderatorMember = await guild.members.fetch(request.moderatorId).catch(() => null);
  const targetMember = await guild.members.fetch(request.targetId).catch(() => null);
  const targetName = await resolveMemberLabel(guild, request.targetId);
  const moderatorName = await resolveMemberLabel(guild, request.moderatorId);
  const moderatorRoleName = displayRoleFor(moderatorMember, request.moderatorId);
  const targetRoleName = displayRoleFor(targetMember, request.targetId);
  const embed = new EmbedBuilder()
    .setTitle(status === "success" ? "FurrBox moderation executed" : "FurrBox moderation failed")
    .setColor(status === "success" ? 0x00f0ff : 0xff007f)
    .addFields(
      { name: "Action", value: request.action, inline: true },
      { name: "Target", value: `${targetName} [${targetRoleName}]`, inline: true },
      { name: "Moderator", value: `${moderatorName} [${moderatorRoleName}]`, inline: true },
      { name: "Reason", value: request.reason.slice(0, 1024) },
      { name: "Duration", value: request.durationMs ? `${Math.round(request.durationMs / 1000)} seconds` : "Not set", inline: true },
      { name: "Request ID", value: request.requestId, inline: true }
    )
    .setTimestamp(new Date());
  if (error) embed.addFields({ name: "Error", value: error.slice(0, 1024) });
  await owner.send({ embeds: [embed] }).catch(() => undefined);
}

async function executeModeration(request: ModerationRequest) {
  const guild = await resolveGuild();
  const moderatorMember = await guild.members.fetch(request.moderatorId).catch(() => null);
  if (!moderatorMember) throw new Error("Moderator is not in the guild and cannot execute moderation.");
  const clearance = moderationClearanceFor(moderatorMember);
  if (!clearance.allowedActions.includes(request.action)) {
    throw new Error(`${moderatorMember.user.tag} [${clearance.roleName}] is not allowed to execute ${request.action}.`);
  }
  const targetMember = await guild.members.fetch(request.targetId).catch(() => null);

  if (request.action === "ban") {
    await guild.members.ban(request.targetId, { reason: request.reason });
    return;
  }

  if (!targetMember) throw new Error("Target member is not in the guild.");

  if (request.action === "warn") {
    await appendWarningProfile(request);
    return;
  }

  if (request.action === "timeout") {
    await targetMember.timeout(request.durationMs ?? 60 * 60 * 1000, request.reason);
    return;
  }

  if (request.action === "mute") {
    const muteRole = await findOrCreateMutedRole(guild);
    await targetMember.roles.add(muteRole, request.reason);
    if (request.durationMs) {
      setTimeout(() => {
        targetMember.roles.remove(muteRole, "FurrBox mute duration expired").catch(() => undefined);
      }, request.durationMs).unref();
    }
    return;
  }
}

async function handleModerationCommand(request: ModerationRequest) {
  let result: ModerationResult;
  const guild = await resolveGuild();
  const moderatorMember = await guild.members.fetch(request.moderatorId).catch(() => null);
  const targetMember = await guild.members.fetch(request.targetId).catch(() => null);
  const moderatorName = await resolveMemberLabel(guild, request.moderatorId);
  const targetName = await resolveMemberLabel(guild, request.targetId);
  const moderatorRoleName = displayRoleFor(moderatorMember, request.moderatorId);
  const targetRoleName = displayRoleFor(targetMember, request.targetId);
  try {
    await executeModeration(request);
    result = { ...request, status: "success", completedAt: new Date().toISOString(), moderatorName, moderatorRoleName, targetName, targetRoleName };
    await writeTextReport({
      action: result.action,
      moderatorName,
      moderatorRoleName,
      targetName,
      targetRoleName,
      reason: result.reason,
      completedAt: result.completedAt
    });
    await sendOwnerAlert(request, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown moderation error.";
    result = { ...request, status: "failed", error: message, completedAt: new Date().toISOString(), moderatorName, moderatorRoleName, targetName, targetRoleName };
    await sendOwnerAlert(request, "failed", message);
  }
  socket.emit("moderation:result", result);
}

async function inspectMessage(request: MessageInspectRequest): Promise<MessageInspectResult> {
  const guild = await resolveGuild();
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (!channel || !channel.isTextBased()) continue;
    const textChannel = channel as typeof channel & { messages?: { fetch: (id: string) => Promise<{ content: string; author: { id: string; tag: string }; createdAt: Date }> } };
    if (!textChannel.messages) continue;
    try {
      const message = await textChannel.messages.fetch(request.messageId);
      return {
        ...request,
        found: true,
        content: message.content || "[Message content unavailable. Enable Message Content Intent for full proof text.]",
        authorId: message.author.id,
        authorName: message.author.tag,
        channelId: channel.id,
        channelName: "name" in channel && typeof channel.name === "string" ? channel.name : channel.id,
        createdAt: message.createdAt.toISOString()
      };
    } catch {
      // Discord returns 404 or missing access for channels where the message does not exist or the bot cannot read.
    }
  }
  return {
    ...request,
    found: false,
    content: "",
    error: "Message was not found in readable guild text channels."
  };
}

async function sendAccountOnboardingInvite(payload: AccountOnboardingInvitePayload) {
  const expiresAt = new Date(payload.expiresAt);
  const expiresLabel = Number.isNaN(expiresAt.getTime()) ? "in 72 Stunden" : expiresAt.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const user = await client.users.fetch(payload.discordId);
  const embed = new EmbedBuilder()
    .setColor(0x00f0ff)
    .setTitle("FurrBox Passwort optional aendern")
    .setDescription(`Hallo ${payload.displayName}, dein FurrBox Zugang wurde vorbereitet. Das von Kitsulife gesetzte Start-Passwort funktioniert bereits. Wenn du ein eigenes neues Passwort nutzen moechtest, kannst du es ueber den Button ersetzen.`)
    .addFields(
      { name: "Nutzername", value: `\`${payload.username}\``, inline: true },
      { name: "Rolle", value: payload.roleName, inline: true },
      { name: "Gueltig bis", value: expiresLabel, inline: false }
    )
    .setFooter({ text: "FurrBox sendet niemals Passwoerter ueber Discord. Der Link ist nur fuer die optionale Passwortaenderung gedacht." })
    .setTimestamp(new Date());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(payload.setupUrl)
      .setLabel("Eigenes Passwort setzen")
  );

  await user.send({ embeds: [embed], components: [row] });
}

socket.on("connect", () => {
  console.log(`FurrBox Discord bot bridge connected to ${bridgeUrl}.`);
});

socket.on("connect_error", (error) => {
  console.error(`FurrBox bridge connection failed: ${error.message}`);
});

socket.on("moderation:command", (request: ModerationRequest) => {
  handleModerationCommand(request).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown moderation error.";
    socket.emit("moderation:result", {
      ...request,
      status: "failed",
      error: message,
      completedAt: new Date().toISOString()
    } satisfies ModerationResult);
  });
});

socket.on("message:inspect", (request: MessageInspectRequest) => {
  inspectMessage(request)
    .then((result) => socket.emit("message:inspect-result", result))
    .catch((error) => {
      socket.emit("message:inspect-result", {
        ...request,
        found: false,
        content: "",
        error: error instanceof Error ? error.message : "Message inspection failed."
      } satisfies MessageInspectResult);
    });
});

socket.on("account:onboarding-invite", (payload: AccountOnboardingInvitePayload) => {
  sendAccountOnboardingInvite(payload)
    .then(() => console.log(`Sent FurrBox onboarding invite to ${payload.discordId}.`))
    .catch((error) => console.error(`Failed to send FurrBox onboarding invite to ${payload.discordId}: ${error instanceof Error ? error.message : String(error)}`));
});

client.once("ready", async () => {
  console.log(`FurrBox Discord bot logged in as ${client.user?.tag}.`);
  const guild = await resolveGuild();
  await syncGuild(guild);
});

client.on("guildMemberUpdate", async (_oldMember, newMember) => {
  if (!newMember.user.bot) await persistMember(newMember);
});

client.on("guildMemberAdd", async (member) => {
  if (!member.user.bot) await persistMember(member);
});

client.on("presenceUpdate", async (_oldPresence, newPresence) => {
  const member = newPresence.member;
  if (!member || member.user.bot) return;
  const status: DiscordPresenceStatus = newPresence.status === "online" || newPresence.status === "idle" || newPresence.status === "dnd" ? newPresence.status : "offline";
  socket.emit("discord:presence:sync", {
    guildId: member.guild.id,
    presences: [
      {
        discordId: member.id,
        discordStatus: status,
        isDiscordOnline: status === "online" || status === "idle" || status === "dnd",
        updatedAt: new Date().toISOString()
      }
    ]
  });
});

client.on("guildMemberRemove", async (member) => {
  await prisma.discordMember.delete({ where: { discordId: member.id } }).catch(() => undefined);
  const guild = member.guild;
  socket.emit("discord:members:sync", { guildId: guild.id, members: [] });
});

process.on("SIGINT", async () => {
  await client.destroy();
  socket.close();
  await prisma.$disconnect();
  process.exit(0);
});

await client.login(token);
