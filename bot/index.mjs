// FurrBox Discord bot: syncs members / roles / presence to FurrBox and executes moderation
// queued in the FurrBox dashboard. Talks to the server only via HTTP (/api/bridge/*).
// Also runs the VRChat group link (vrchat.mjs) – VRChat only accepts a login from a fixed address.
//
// Env: DISCORD_TOKEN, BOT_BRIDGE_TOKEN (same value as in Vercel),
//      FURRBOX_URL (default https://furrbox-88ir.vercel.app), DISCORD_GUILD_ID (default Fish),
//      DISCORD_MUTED_ROLE_ID / DISCORD_MUTED_ROLE_NAME (optional, for "mute").
import { writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, EmbedBuilder, GatewayIntentBits, Options, Partials, PermissionsBitField } from "discord.js";
import { handleVrchatJobs, setVrchatActive, startVrchat } from "./vrchat.mjs";
import { filesBusy, handleBotFiles } from "./files.mjs";
import { withIdeenIntents, installIdeenFeatures, deliverIdeenOutbox, afterModerationSuccess } from "./ideen-hooks.mjs";

const READY_FILE = join(dirname(fileURLToPath(import.meta.url)), "bot.ready");

const token = process.env.DISCORD_TOKEN;
const bridgeToken = process.env.BOT_BRIDGE_TOKEN;
const baseUrl = (process.env.FURRBOX_URL || "https://furrbox-88ir.vercel.app").replace(/\/+$/, "");
const guildId = process.env.DISCORD_GUILD_ID || "1386651125327073470";
const mutedRoleId = process.env.DISCORD_MUTED_ROLE_ID;
const mutedRoleName = process.env.DISCORD_MUTED_ROLE_NAME || "Muted";
const dutyRoleId = process.env.DISCORD_DUTY_ROLE_ID || "";
const modChannelIdEnv = process.env.DISCORD_MOD_CHANNEL_ID || "";

if (!token) throw new Error("DISCORD_TOKEN fehlt.");
if (!bridgeToken) throw new Error("BOT_BRIDGE_TOKEN fehlt.");

// Same ids as the server-side staff check (src/lib/furr/discord-staff.ts).
const ROLE_IDS = {
  dev: "1312104318006071328",
  owner: "1395506854549000202",
  moderator: "1397883231134547989",
  supporter: "1395506316801343558",
};
const ROLE_NAMES = {
  [ROLE_IDS.dev]: "Dev",
  [ROLE_IDS.owner]: "Fish Nagie Owner",
  [ROLE_IDS.moderator]: "Fish Moderator",
  [ROLE_IDS.supporter]: "Supporter",
};
const ALLOWED = {
  dev: ["ban", "warn", "timeout", "mute"],
  owner: ["ban", "warn", "timeout", "mute"],
  moderator: ["ban", "warn", "timeout", "mute"],
  supporter: ["warn", "timeout"],
  none: [],
};

// Poll fast while someone has FurrBox open, slowly otherwise (lets the database sleep).
// While active: 5 s right after work (moderation, VRChat jobs, files …) or after FurrBox was opened,
// 10 s once the queue stayed empty for 2 minutes.
const ACTIVE_POLL_MS = 5_000;
const ACTIVE_QUIET_POLL_MS = 10_000;
const ACTIVE_HOT_WINDOW_MS = 2 * 60_000;
const IDLE_POLL_MS = 10 * 60_000;
// Bridge errors: retry after 30 s, doubled per failure up to 5 min (no hammering during outages).
const ERROR_POLL_MS = 30_000;
const ERROR_POLL_MAX_MS = 5 * 60_000;
// Member events keep FurrBox current; the full member sync is only a safety net.
const FULL_SYNC_MAX_AGE_MS = 6 * 60 * 60_000;

const client = new Client({
  intents: withIdeenIntents([
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    // No GuildMessages intent: the bot never reacts to new chat messages (inspect reads them via REST),
    // so Discord does not have to stream every message of the server to this PC.
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ]),
  partials: [Partials.Channel],
  // Nothing here needs cached messages / reactions / thread members / stickers – keeps memory flat.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ReactionManager: 0,
    ThreadMemberManager: 0,
    GuildStickerManager: 0,
  }),
});

const log = (...args) => console.log(new Date().toISOString(), ...args);

/** Transient network / DNS / connect-timeout errors (undici ConnectTimeout, ENOTFOUND, …). */
function isNetworkError(err) {
  if (!err) return false;
  const code = err.code || err.cause?.code;
  const name = err.name || err.cause?.name || "";
  const msg = String(err.message || err.cause?.message || err);
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    name === "ConnectTimeoutError" ||
    name === "AbortError" ||
    /connect timeout|fetch failed|getaddrinfo/i.test(msg)
  );
}

async function bridge(path, body) {
  let res;
  try {
    res = await fetch(`${baseUrl}/api/bridge/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${bridgeToken}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(isNetworkError(err) ? `Bridge ${path}: Netzwerk (${msg})` : `Bridge ${path}: ${msg}`);
  }
  if (!res.ok) throw new Error(`Bridge ${path}: HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  return res.json();
}

function has(member, id) {
  return member.id === id || member.roles.cache.has(id);
}

function privilegeFor(member) {
  for (const key of ["dev", "owner", "moderator", "supporter"]) if (has(member, ROLE_IDS[key])) return key;
  return "none";
}

function normStatus(s) {
  return s === "online" || s === "idle" || s === "dnd" ? s : "offline";
}

function statusFor(member) {
  return normStatus(member.presence?.status);
}

function snapshot(member) {
  const roleNames = member.roles.cache.map((r) => ROLE_NAMES[r.id]).filter(Boolean);
  if (member.id === ROLE_IDS.dev && !roleNames.includes("Dev")) roleNames.unshift("Dev");
  if (member.id === ROLE_IDS.owner && !roleNames.includes("Fish Nagie Owner")) roleNames.unshift("Fish Nagie Owner");
  return {
    discordId: member.id,
    username: member.user.tag,
    nickname: member.nickname,
    displayName: member.displayName,
    roleNames,
    highestPrivilege: privilegeFor(member),
    discordStatus: statusFor(member),
  };
}

// Changes are buffered and flushed on the next poll while FurrBox is in use.
const pendingMembers = new Map();
const pendingPresence = new Map();
const pendingRemoved = new Set();
let fullSyncNeeded = true;
let lastFullSyncAt = 0;
let active = false;
let lastWorkAt = 0;
let errorDelay = ERROR_POLL_MS;

async function guild() {
  return client.guilds.fetch(guildId);
}

async function flush() {
  if (fullSyncNeeded || Date.now() - lastFullSyncAt > FULL_SYNC_MAX_AGE_MS) {
    const g = await guild();
    // The GuildMembers intent keeps the member cache current after the first fetch – only ask
    // Discord for the whole list again when the cache is incomplete.
    const members = g.members.cache.size >= g.memberCount ? g.members.cache : await g.members.fetch();
    const list = [...members.values()].filter((m) => !m.user.bot).map(snapshot);
    for (let i = 0; i < list.length; i += 200) await bridge("members", { members: list.slice(i, i + 200) });
    fullSyncNeeded = false;
    lastFullSyncAt = Date.now();
    pendingMembers.clear();
    pendingPresence.clear();
    log(`Vollständiger Sync: ${list.length} Mitglieder.`);
  }
  try {
    if (pendingMembers.size || pendingRemoved.size) {
      const members = [...pendingMembers.values()];
      const removed = [...pendingRemoved];
      pendingMembers.clear();
      pendingRemoved.clear();
      await bridge("members", { members, removed });
    }
    if (pendingPresence.size) {
      const presences = [...pendingPresence.entries()].map(([discordId, discordStatus]) => ({ discordId, discordStatus }));
      pendingPresence.clear();
      await bridge("presence", { presences });
    }
  } catch (err) {
    // The cleared changes are gone – a full sync on the next flush catches up.
    fullSyncNeeded = true;
    throw err;
  }
}

async function label(g, id) {
  const m = await g.members.fetch(id).catch(() => null);
  if (m) return m.nickname || m.user.tag;
  const u = await client.users.fetch(id).catch(() => null);
  return u?.tag || id;
}

async function mutedRole(g) {
  if (mutedRoleId) {
    const role = await g.roles.fetch(mutedRoleId).catch(() => null);
    if (role) return role;
  }
  const found = g.roles.cache.find((r) => r.name.toLowerCase() === mutedRoleName.toLowerCase());
  if (found) return found;
  if (!g.members.me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error("Der Bot braucht die Berechtigung „Rollen verwalten“, um eine Muted-Rolle anzulegen.");
  }
  return g.roles.create({ name: mutedRoleName, reason: "FurrBox Muted-Rolle", permissions: [] });
}

async function moderate(req) {
  const g = await guild();
  const moderator = await g.members.fetch(req.moderatorId).catch(() => null);
  if (!moderator) throw new Error("Moderator ist nicht auf dem Server.");
  const privilege = privilegeFor(moderator);
  if (!ALLOWED[privilege].includes(req.action)) {
    throw new Error(`${moderator.user.tag} darf „${req.action}“ nicht ausführen.`);
  }
  if (req.action === "ban") {
    await g.members.ban(req.targetId, { reason: req.reason });
    return;
  }
  const target = await g.members.fetch(req.targetId).catch(() => null);
  if (!target) throw new Error("Ziel ist nicht auf dem Server.");
  if (req.action === "warn") {
    await target
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfbbf24)
            .setTitle(`Verwarnung auf ${g.name}`)
            .setDescription(req.reason.slice(0, 4000))
            .setTimestamp(new Date()),
        ],
      })
      .catch(() => undefined); // closed DMs still count as a recorded warning
    return;
  }
  if (req.action === "timeout") {
    await target.timeout(req.durationMs ?? 60 * 60_000, req.reason);
    return;
  }
  if (req.action === "mute") {
    const role = await mutedRole(g);
    await target.roles.add(role, req.reason);
    if (req.durationMs) {
      setTimeout(() => target.roles.remove(role, "FurrBox: Mute abgelaufen").catch(() => undefined), req.durationMs).unref();
    }
    return;
  }
  throw new Error(`Unbekannte Aktion: ${req.action}`);
}

async function alertOwner(req, status, error) {
  const g = await guild();
  const owner = await client.users.fetch(ROLE_IDS.owner).catch(() => null);
  if (!owner) return;
  const embed = new EmbedBuilder()
    .setTitle(status === "success" ? "FurrBox: Moderation ausgeführt" : "FurrBox: Moderation fehlgeschlagen")
    .setColor(status === "success" ? 0x00f0ff : 0xff007f)
    .addFields(
      { name: "Aktion", value: req.action, inline: true },
      { name: "Ziel", value: await label(g, req.targetId), inline: true },
      { name: "Moderator", value: await label(g, req.moderatorId), inline: true },
      { name: "Grund", value: String(req.reason || "–").slice(0, 1024) },
    )
    .setTimestamp(new Date());
  if (error) embed.addFields({ name: "Fehler", value: error.slice(0, 1024) });
  await owner.send({ embeds: [embed] }).catch(() => undefined);
}

async function handleModeration(req) {
  try {
    await moderate(req);
    await bridge("moderation-result", { requestId: req.requestId, status: "success" });
    await alertOwner(req, "success");
    log(`Moderation ${req.action} gegen ${req.targetId} ausgeführt.`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await bridge("moderation-result", { requestId: req.requestId, status: "failed", error }).catch(() => undefined);
    await alertOwner(req, "failed", error);
    log(`Moderation ${req.action} fehlgeschlagen: ${error}`);
  }
}

async function inspect(req) {
  const g = await guild();
  const channels = await g.channels.fetch();
  for (const channel of channels.values()) {
    if (!channel?.isTextBased?.() || !channel.messages) continue;
    try {
      const msg = await channel.messages.fetch(req.messageId);
      return {
        requestId: req.requestId,
        messageId: req.messageId,
        found: true,
        content: msg.content || "[Kein Inhalt lesbar – „Message Content Intent“ im Developer Portal aktivieren.]",
        authorId: msg.author.id,
        authorName: msg.author.tag,
        channelId: channel.id,
        channelName: channel.name ?? channel.id,
        createdAt: msg.createdAt.toISOString(),
      };
    } catch {
      // not in this channel / no access
    }
  }
  return { requestId: req.requestId, messageId: req.messageId, found: false, content: "", error: "Nachricht in keinem lesbaren Kanal gefunden." };
}

async function poll() {
  let delay = active ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  try {
    const queue = await bridge("queue");
    const wasActive = active;
    active = Boolean(queue.active);
    setVrchatActive(active);
    // Member data stays current through Discord events (buffered while idle) – no full sync needed on
    // every opening of FurrBox. Opening FurrBox or any queued work keeps the fast poll for 2 minutes.
    const hadWork = Boolean(
      queue.moderation?.length ||
        queue.inspections?.length ||
        queue.vrchatJobs?.length ||
        queue.discordMessages?.length ||
        queue.botFiles?.uploads?.length ||
        queue.botFiles?.downloads?.length,
    );
    if (hadWork || (active && !wasActive)) lastWorkAt = Date.now();
    for (const req of queue.moderation ?? []) await handleModeration(req);
    for (const req of queue.inspections ?? []) {
      const result = await inspect(req).catch((err) => ({
        requestId: req.requestId,
        messageId: req.messageId,
        found: false,
        content: "",
        error: err instanceof Error ? err.message : String(err),
      }));
      await bridge("inspect-result", result);
    }
    await handleVrchatJobs(queue.vrchatJobs);
    handleBotFiles(bridge, log, queue.botFiles);
    // Messages FurrBox wants posted (e.g. "instance opened – who is anwesend"). No pings.
    for (const m of queue.discordMessages ?? []) {
      try {
        const channel = await client.channels.fetch(m.channelId);
        if (channel?.isTextBased()) await channel.send({ content: String(m.content).slice(0, 1900), allowedMentions: { parse: [] } });
      } catch (err) {
        log("Discord-Nachricht fehlgeschlagen:", err instanceof Error ? err.message : err);
      }
    }
    if (active) await flush();
    errorDelay = ERROR_POLL_MS;
    delay = filesBusy()
      ? 2_000
      : !active
        ? IDLE_POLL_MS
        : Date.now() - lastWorkAt < ACTIVE_HOT_WINDOW_MS
          ? ACTIVE_POLL_MS
          : ACTIVE_QUIET_POLL_MS;
  } catch (err) {
    delay = errorDelay;
    errorDelay = Math.min(errorDelay * 2, ERROR_POLL_MAX_MS);
    log("Bridge-Fehler:", err instanceof Error ? err.message : err, `(nächster Versuch in ${Math.round(delay / 1000)} s)`);
  }
  setTimeout(poll, delay);
}

client.once("clientReady", () => {
  try {
    writeFileSync(READY_FILE, new Date().toISOString());
  } catch {
    // marker only used by start-bot.cmd backoff reset
  }
  log(`Eingeloggt als ${client.user?.tag}. FurrBox: ${baseUrl}`);
  poll();
  startVrchat(bridge, log);
});

// A brand-new gateway session (not a resume) may have missed member events → full sync on next flush.
let shardReadyOnce = false;
client.on("shardReady", () => {
  if (shardReadyOnce) fullSyncNeeded = true;
  shardReadyOnce = true;
});

client.on("error", (err) => log("Discord-Client-Fehler:", err instanceof Error ? err.message : err));
client.on("shardError", (err) => log("Discord-Shard-Fehler:", err instanceof Error ? err.message : err));

client.on("guildMemberAdd", (m) => {
  if (m.guild.id === guildId && !m.user.bot) pendingMembers.set(m.id, snapshot(m));
});
/** Fields FurrBox stores for a member (status is synced separately). */
const memberKey = (s) => JSON.stringify([s.username, s.nickname, s.displayName, s.roleNames, s.highestPrivilege]);
client.on("guildMemberUpdate", (old, m) => {
  if (m.guild.id !== guildId || m.user.bot) return;
  const next = snapshot(m);
  // Skip changes FurrBox does not store (avatar, boost, timeout, …).
  if (old && !old.partial && old.user && memberKey(snapshot(old)) === memberKey(next)) return;
  pendingMembers.set(m.id, next);
});
client.on("guildMemberRemove", (m) => {
  if (m.guild.id !== guildId) return;
  pendingMembers.delete(m.id);
  pendingRemoved.add(m.id);
});
client.on("presenceUpdate", (old, p) => {
  const m = p.member;
  if (!m || m.guild.id !== guildId || m.user.bot) return;
  const status = statusFor(m);
  // Activity changes (games, Spotify, …) fire constantly – only real status changes matter.
  if (old && normStatus(old.status) === status) return;
  pendingPresence.set(m.id, status);
});


// Ideen-Features (Slash, Sanctions, AutoMod, Alerts) – dünner Hook, siehe ideen-hooks.mjs
installIdeenFeatures({
  client,
  bridge,
  guild,
  mutedRole,
  log,
  roleIds: ROLE_IDS,
  guildId,
  token,
  dutyRoleId: dutyRoleId || undefined,
  label,
});

process.on("SIGINT", async () => {
  try {
    unlinkSync(READY_FILE);
  } catch {
    // ignore
  }
  await client.destroy();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  log("Uncaught:", err instanceof Error ? err.message : err);
  if (isNetworkError(err)) log("Netzwerkfehler – Prozess endet für Backoff-Neustart.");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log("Unhandled rejection:", err.message);
  if (isNetworkError(err)) {
    log("Netzwerkfehler – Prozess endet für Backoff-Neustart.");
    process.exit(1);
  }
});

try {
  await client.login(token);
} catch (err) {
  log("Discord-Login fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exit(1);
}
