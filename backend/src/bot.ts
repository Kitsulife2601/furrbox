import { PrismaClient } from "@prisma/client";
import {
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
};
type DiscordMemberSnapshot = {
  discordId: string;
  username: string;
  displayName: string;
  roles: string[];
  highestPrivilege: DiscordPrivilege;
  isSupporter: boolean;
  isModerator: boolean;
  isOwner: boolean;
  isDev: boolean;
};

const ROLE_IDS = {
  dev: "1517274600487125144",
  owner: "1395506854549000202",
  moderator: "1397883231134547989",
  supporter: "1395506316801343558"
} as const;

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
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
    GatewayIntentBits.DirectMessages
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

function warningProfileVirtualPath(targetId: string) {
  return `Dokumente/Moderation_Beweise/Discord_Logs/profiles/${targetId}.json`;
}

function warningProfilePhysicalPath(targetId: string) {
  return path.join(publicStorageDir(), "Dokumente", "Moderation_Beweise", "Discord_Logs", "profiles", `${targetId}.json`);
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

function snapshotMember(member: GuildMember): DiscordMemberSnapshot {
  const privilege = privilegeFor(member);
  const roles = member.roles.cache.filter((role) => role.id !== member.guild.id).map((role) => role.id);
  return {
    discordId: member.id,
    username: member.user.tag,
    displayName: member.displayName,
    roles,
    highestPrivilege: privilege,
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
      displayName: snapshot.displayName,
      rolesJson: JSON.stringify(snapshot.roles),
      highestPrivilege: snapshot.highestPrivilege,
      isSupporter: snapshot.isSupporter,
      isModerator: snapshot.isModerator,
      isOwner: snapshot.isOwner,
      isDev: snapshot.isDev
    },
    create: {
      discordId: snapshot.discordId,
      username: snapshot.username,
      displayName: snapshot.displayName,
      rolesJson: JSON.stringify(snapshot.roles),
      highestPrivilege: snapshot.highestPrivilege,
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
          displayName: member.displayName,
          rolesJson: JSON.stringify(member.roles),
          highestPrivilege: member.highestPrivilege,
          isSupporter: member.isSupporter,
          isModerator: member.isModerator,
          isOwner: member.isOwner,
          isDev: member.isDev
        },
        create: {
          discordId: member.discordId,
          username: member.username,
          displayName: member.displayName,
          rolesJson: JSON.stringify(member.roles),
          highestPrivilege: member.highestPrivilege,
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

async function appendWarningProfile(request: ModerationRequest) {
  const profilePath = warningProfilePhysicalPath(request.targetId);
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  let profile: { targetId: string; warnings: Array<{ id: string; moderatorId: string; reason: string; createdAt: string }> };
  try {
    profile = JSON.parse(await fs.readFile(profilePath, "utf8"));
  } catch {
    profile = { targetId: request.targetId, warnings: [] };
  }
  const warning = {
    id: request.requestId,
    moderatorId: request.moderatorId,
    reason: request.reason,
    createdAt: new Date().toISOString()
  };
  profile.warnings.push(warning);
  await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
  await prisma.discordWarning.create({
    data: {
      id: warning.id,
      targetId: request.targetId,
      moderatorId: request.moderatorId,
      reason: request.reason
    }
  });

  const stats = await fs.stat(profilePath);
  const existing = await prisma.storedFile.findFirst({ where: { scope: "PUBLIC", name: warningProfileVirtualPath(request.targetId) } });
  if (existing) {
    await prisma.storedFile.update({
      where: { id: existing.id },
      data: { size: stats.size, mimeType: "application/json", originalName: warningProfileVirtualPath(request.targetId) }
    });
  } else {
    await prisma.storedFile.create({
      data: {
        name: warningProfileVirtualPath(request.targetId),
        originalName: warningProfileVirtualPath(request.targetId),
        size: stats.size,
        mimeType: "application/json",
        scope: "PUBLIC",
        ownerId: null
      }
    });
  }
}

async function sendOwnerAlert(request: ModerationRequest, status: "success" | "failed", error?: string) {
  const owner = await client.users.fetch(ROLE_IDS.owner);
  const embed = new EmbedBuilder()
    .setTitle(status === "success" ? "FurrBox moderation executed" : "FurrBox moderation failed")
    .setColor(status === "success" ? 0x00f0ff : 0xff007f)
    .addFields(
      { name: "Action", value: request.action, inline: true },
      { name: "Target", value: request.targetId, inline: true },
      { name: "Moderator", value: request.moderatorId, inline: true },
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
  try {
    await executeModeration(request);
    result = { ...request, status: "success", completedAt: new Date().toISOString() };
    await sendOwnerAlert(request, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown moderation error.";
    result = { ...request, status: "failed", error: message, completedAt: new Date().toISOString() };
    await sendOwnerAlert(request, "failed", message);
  }
  socket.emit("moderation:result", result);
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
