import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type express from "express";
import type { Server } from "socket.io";

type JavisAuthUser = {
  id: string;
  username: string;
  displayName: string;
};

type JavisRequest = express.Request & { user?: JavisAuthUser };

type JavisDeps = {
  app: express.Express;
  io: Server;
  prisma: PrismaClient;
  requireAuth: express.RequestHandler;
};

type JavisHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

type JavisReminder = {
  id: string;
  userId: string;
  text: string;
  dueAt: number;
  timer: NodeJS.Timeout;
};

const llmUrl = (process.env.JAVIS_LLM_URL || "").trim().replace(/\/+$/, "");
const llmModel = (process.env.JAVIS_LLM_MODEL || "llama3.2").trim();
const llmApiKey = (process.env.JAVIS_LLM_API_KEY || "").trim();
const llmTimeoutMs = Math.min(Math.max(Number(process.env.JAVIS_LLM_TIMEOUT_MS || 30000), 3000), 120000);
const llmSystemPrompt =
  (process.env.JAVIS_SYSTEM_PROMPT || "").trim() ||
  "Du bist Javis, der eingebaute FurrBox Desktop-Assistent. Antworte kurz, freundlich und auf Deutsch, außer der Nutzer schreibt in einer anderen Sprache.";

const maxRemindersPerUser = 25;
const maxReminderMs = 7 * 24 * 60 * 60 * 1000;
const remindersByUser = new Map<string, JavisReminder[]>();

function listReminders(userId: string) {
  return (remindersByUser.get(userId) || []).slice().sort((a, b) => a.dueAt - b.dueAt);
}

function removeReminder(userId: string, reminderId: string) {
  const entries = remindersByUser.get(userId);
  if (!entries) return;
  const next = entries.filter((entry) => entry.id !== reminderId);
  if (next.length) remindersByUser.set(userId, next);
  else remindersByUser.delete(userId);
}

function clearReminders(userId: string) {
  const entries = remindersByUser.get(userId) || [];
  for (const entry of entries) clearTimeout(entry.timer);
  remindersByUser.delete(userId);
  return entries.length;
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number) {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} Sekunde(n)`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} Minute(n)`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} Stunde(n) ${minutes} Minute(n)` : `${hours} Stunde(n)`;
}

function parseReminderDuration(unitRaw: string, amount: number) {
  const unit = unitRaw.toLowerCase();
  if (unit.startsWith("sek") || unit.startsWith("sec")) return amount * 1000;
  if (unit.startsWith("min")) return amount * 60 * 1000;
  if (unit.startsWith("stund") || unit.startsWith("hour") || unit === "h") return amount * 60 * 60 * 1000;
  if (unit.startsWith("tag") || unit.startsWith("day") || unit === "d") return amount * 24 * 60 * 60 * 1000;
  return null;
}

// Whitelist strictly limits the expression to numeric literals and arithmetic
// operators, so no identifiers or property access can reach the evaluator.
function evaluateMath(expression: string): number | null {
  const cleaned = expression.replace(/,/g, ".").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 120) return null;
  if (!/^[0-9+\-*/().%^ ]+$/.test(cleaned)) return null;
  if (!/[0-9]/.test(cleaned)) return null;
  try {
    const result = new Function(`"use strict"; return (${cleaned.replace(/\^/g, "**")});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6);
}

async function askLlm(message: string, history: JavisHistoryEntry[]): Promise<string> {
  const messages = [
    { role: "system", content: llmSystemPrompt },
    ...history.slice(-10).map((entry) => ({ role: entry.role, content: entry.content.slice(0, 2000) })),
    { role: "user", content: message }
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmTimeoutMs);
  try {
    const response = await fetch(`${llmUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(llmApiKey ? { Authorization: `Bearer ${llmApiKey}` } : {})
      },
      body: JSON.stringify({ model: llmModel, messages, stream: false })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`LLM antwortete mit Status ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("LLM lieferte keine Antwort.");
    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

export function registerJavis({ app, io, prisma, requireAuth }: JavisDeps) {
  function scheduleReminder(user: JavisAuthUser, text: string, delayMs: number) {
    const id = crypto.randomUUID();
    const dueAt = Date.now() + delayMs;
    const timer = setTimeout(() => {
      removeReminder(user.id, id);
      io.to(`user:${user.id}`).emit("javis:reminder", { id, text, dueAt });
    }, delayMs);
    timer.unref?.();
    const entries = remindersByUser.get(user.id) || [];
    entries.push({ id, userId: user.id, text, dueAt, timer });
    remindersByUser.set(user.id, entries);
    return { id, dueAt };
  }

  async function searchFiles(userId: string, query: string) {
    return prisma.storedFile.findMany({
      where: {
        originalName: { contains: query },
        OR: [{ scope: "PUBLIC" }, { scope: "PRIVATE", ownerId: userId }]
      },
      select: { originalName: true, scope: true, size: true },
      orderBy: { uploadedAt: "desc" },
      take: 8
    });
  }

  async function handleIntent(user: JavisAuthUser, message: string): Promise<string | null> {
    const text = message.trim();
    const lower = text.toLowerCase();

    if (/^(hallo|hi|hey|moin|servus|guten (morgen|tag|abend))\b/.test(lower)) {
      return `Hallo ${user.displayName || user.username}! Ich bin Javis, dein FurrBox-Assistent. Schreib "hilfe", um zu sehen, was ich kann.`;
    }

    if (/\b(hilfe|help)\b/.test(lower) || lower.includes("was kannst du")) {
      return [
        "Ich bin Javis und laufe direkt im FurrBox-Backend - ganz ohne n8n. Das kann ich:",
        '- "Wie spät ist es?" / "Welches Datum haben wir?"',
        '- "Erinnere mich in 10 Minuten an Kaffee" oder "Timer 5 min"',
        '- "Meine Erinnerungen" anzeigen, "Erinnerungen löschen"',
        '- "Suche datei urlaub" durchsucht dein FurrFS',
        '- Rechnen: "Was ist 128*4?"',
        '- "Status" zeigt meine Konfiguration',
        "Alles andere beantworte ich über das angebundene Sprachmodell, falls eines konfiguriert ist."
      ].join("\n");
    }

    if (/\b(wie spät|wie viel uhr|uhrzeit)\b/.test(lower) || /^time\??$/.test(lower)) {
      return `Es ist ${formatClock(new Date())} Uhr.`;
    }

    if (/\b(datum|welcher tag|welchen tag)\b/.test(lower) || /^date\??$/.test(lower)) {
      return `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}.`;
    }

    if (/\b(erinnerungen|timer) (löschen|loeschen|stopp?en|abbrechen)\b/.test(lower) || /\b(lösche|loesche) (alle )?(erinnerungen|timer)\b/.test(lower)) {
      const count = clearReminders(user.id);
      return count ? `Alles klar, ich habe ${count} Erinnerung(en) gelöscht.` : "Du hast gerade keine aktiven Erinnerungen.";
    }

    if (/\b(meine|aktive|welche) (erinnerungen|timer)\b/.test(lower) || /^(erinnerungen|timer)\??$/.test(lower)) {
      const entries = listReminders(user.id);
      if (!entries.length) return "Du hast gerade keine aktiven Erinnerungen.";
      const lines = entries.map((entry, index) => `${index + 1}. ${formatClock(new Date(entry.dueAt))} Uhr - ${entry.text}`);
      return `Deine aktiven Erinnerungen:\n${lines.join("\n")}`;
    }

    const reminderMatch =
      lower.match(/erinner(?:e|ung)?(?:\s+mich)?\s+in\s+(\d+)\s*(sekunden?|sek|minuten?|min|stunden?|std|h|tagen?|tag|d)\b/) ||
      lower.match(/\btimer\s+(?:für\s+)?(\d+)\s*(sekunden?|sek|minuten?|min|stunden?|std|h)\b/);
    if (reminderMatch) {
      const amount = Number(reminderMatch[1]);
      const delayMs = parseReminderDuration(reminderMatch[2] === "std" ? "stunden" : reminderMatch[2], amount);
      if (!amount || !delayMs || delayMs < 5000) return "Die Erinnerung muss mindestens 5 Sekunden in der Zukunft liegen.";
      if (delayMs > maxReminderMs) return "Erinnerungen kann ich höchstens 7 Tage im Voraus planen.";
      if (listReminders(user.id).length >= maxRemindersPerUser) return `Du hast schon ${maxRemindersPerUser} aktive Erinnerungen - lösche erst welche.`;
      const afterMatch = text.slice((reminderMatch.index || 0) + reminderMatch[0].length);
      const reminderText = afterMatch.replace(/^\s*(an|dass|zu|:)\s*/i, "").trim() || "Deine Javis-Erinnerung ist fällig!";
      const { dueAt } = scheduleReminder(user, reminderText, delayMs);
      return `Alles klar! Ich erinnere dich in ${formatDuration(delayMs)} (${formatClock(new Date(dueAt))} Uhr) an: ${reminderText}`;
    }

    const fileMatch = lower.match(/\b(?:suche?|finde?|search)\s+(?:die\s+|nach\s+)?(?:datei(?:en)?\s+)?(.{2,})$/);
    if (fileMatch && /\b(such|find|search)/.test(lower)) {
      const query = text.slice((fileMatch.index || 0) + fileMatch[0].length - fileMatch[1].length).trim().replace(/[?.!]+$/, "");
      if (query.length < 2) return "Wonach soll ich suchen? Beispiel: \"Suche datei urlaub\"";
      const files = await searchFiles(user.id, query);
      if (!files.length) return `Ich habe in FurrFS nichts zu "${query}" gefunden.`;
      const lines = files.map((file) => `- ${file.originalName} (${file.scope === "PUBLIC" ? "Shared Network" : "My Files"})`);
      return `Ich habe ${files.length} Treffer zu "${query}" gefunden:\n${lines.join("\n")}`;
    }

    const mathMatch = lower.match(/^(?:was ist|rechne|berechne|calc(?:ulate)?)\s+(.+)$/);
    const mathCandidate = mathMatch ? text.slice((mathMatch.index || 0) + mathMatch[0].length - mathMatch[1].length) : text;
    const mathResult = evaluateMath(mathCandidate.replace(/[?=]+\s*$/, ""));
    if (mathResult !== null && (mathMatch || /[+\-*/^%]/.test(mathCandidate))) {
      return `Das Ergebnis ist ${formatNumber(mathResult)}.`;
    }

    if (/^status\??$/.test(lower) || lower.includes("javis status")) {
      const reminders = listReminders(user.id);
      return [
        "Javis läuft direkt im FurrBox-Backend (kein n8n nötig).",
        llmUrl ? `Sprachmodell: verbunden mit ${llmModel} (${llmUrl})` : "Sprachmodell: nicht konfiguriert - ich antworte regelbasiert.",
        `Aktive Erinnerungen: ${reminders.length}`
      ].join("\n");
    }

    return null;
  }

  app.get("/api/javis/status", requireAuth, (req: JavisRequest, res) => {
    const reminders = listReminders(req.user!.id).map((entry) => ({ id: entry.id, text: entry.text, dueAt: entry.dueAt }));
    res.json({ llmConfigured: Boolean(llmUrl), model: llmUrl ? llmModel : null, reminders });
  });

  app.post("/api/javis/chat", requireAuth, async (req: JavisRequest, res, next) => {
    try {
      const message = String(req.body.message || "").trim();
      if (!message) {
        res.status(400).json({ error: "Eine Nachricht wird benötigt." });
        return;
      }
      if (message.length > 4000) {
        res.status(400).json({ error: "Die Nachricht ist zu lang (max. 4000 Zeichen)." });
        return;
      }

      const intentReply = await handleIntent(req.user!, message);
      if (intentReply !== null) {
        res.json({ reply: intentReply, source: "javis" });
        return;
      }

      if (!llmUrl) {
        res.json({
          reply:
            'Das habe ich leider nicht verstanden. Schreib "hilfe" für meine eingebauten Befehle - oder verbinde ein lokales Sprachmodell (z. B. Ollama) über JAVIS_LLM_URL, dann kann ich freie Fragen beantworten.',
          source: "javis"
        });
        return;
      }

      const historyInput = Array.isArray(req.body.history) ? (req.body.history as Array<{ role?: unknown; content?: unknown }>) : [];
      const history: JavisHistoryEntry[] = historyInput
        .filter((entry) => (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string")
        .map((entry) => ({ role: entry.role as "user" | "assistant", content: entry.content as string }));

      try {
        const reply = await askLlm(message, history);
        res.json({ reply, source: "llm" });
      } catch (error) {
        const reason = error instanceof Error && error.name === "AbortError" ? "Zeitüberschreitung" : error instanceof Error ? error.message : "Unbekannter Fehler";
        res.json({
          reply: `Ich konnte das Sprachmodell gerade nicht erreichen (${reason}). Meine eingebauten Befehle funktionieren weiterhin - schreib "hilfe".`,
          source: "javis"
        });
      }
    } catch (error) {
      next(error);
    }
  });
}
