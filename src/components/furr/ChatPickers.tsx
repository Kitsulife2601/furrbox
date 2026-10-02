// FurrChat: emoji + sticker picker and the attach menu (Fallakte / Datei vom PC).
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileUp, FolderLock, Search, Smile, Sticker as StickerIcon } from "lucide-react";
import { listEvidenceCases } from "@/lib/furr/api/evidence";
import { errorMessage } from "@/lib/furr/client";
import { STICKERS, type Sticker } from "@/lib/furr/stickers";
import { cn } from "@/lib/utils";

const EMOJI_GROUPS: { id: string; label: string; icon: string; emojis: string }[] = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "😀",
    emojis:
      "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👻 👽 🤖",
  },
  {
    id: "tiere",
    label: "Tiere",
    icon: "🦊",
    emojis:
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🦎 🐙 🦑 🦀 🐡 🐠 🐟 🐬 🐳 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐈‍⬛ 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐿️ 🦔 🐾 🐉 🐲",
  },
  {
    id: "gesten",
    label: "Gesten & Leute",
    icon: "👋",
    emojis:
      "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💪 🦾 👀 👁️ 👅 👄 🫦 🧠 🫂 👶 🧒 👦 👧 🧑 👱 👨 👩 🧓 👮 🕵️ 💂 🥷 👷 🤴 👸 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💃 🕺 👯 🧘 🛌",
  },
  {
    id: "herzen",
    label: "Herzen",
    icon: "❤️",
    emojis:
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💌 💋 😻 💑 💏 🌹 🌷 🌸 💐",
  },
  {
    id: "essen",
    label: "Essen",
    icon: "🍕",
    emojis:
      "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🌶️ 🥔 🍞 🥐 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍣 🍱 🥟 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍿 🥤 🧋 ☕ 🍵 🍺 🍻 🥂 🍷 🍹 🧃",
  },
  {
    id: "aktivitaet",
    label: "Aktivitäten",
    icon: "🎮",
    emojis:
      "⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🏸 🥊 🎯 🎳 🎮 🕹️ 🎲 🧩 ♟️ 🎨 🎭 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🎬 📸 🎉 🎊 🎈 🎁 🎀 🏆 🥇 🥈 🥉 🏅 🎖️ 🎃 🎄 🎆 🎇 ✨ 🎐 🪩",
  },
  {
    id: "natur",
    label: "Natur & Wetter",
    icon: "🌙",
    emojis:
      "🌍 🌙 🌛 🌜 🌚 🌝 🌞 ⭐ 🌟 💫 ⚡ 🔥 💥 ☄️ ☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 🌪️ 🌈 ☔ 💧 🌊 🌲 🌳 🌴 🌵 🌱 🌿 ☘️ 🍀 🍁 🍂 🍃 🍄 🌾 🌻 🌼",
  },
  {
    id: "symbole",
    label: "Symbole",
    icon: "✅",
    emojis:
      "✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❔ ❗ ❕ ‼️ ⁉️ 💯 🔞 ⚠️ 🚫 ⛔ 📛 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🔒 🔓 🔑 🔨 🛡️ ⚔️ 📌 📎 📝 📁 📂 🗂️ 📅 ⏰ ⌛ 🔔 🔕 💬 💭 🗯️ ♻️ 🆗 🆕 🆒 🆘 ℹ️ ⬆️ ⬇️ ⬅️ ➡️ 🔄",
  },
];

const RECENT_KEY = "furrbox-chat-recent-emoji";

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 24)));
  } catch {
    // Browser storage blocked – recents are only a convenience.
  }
}

// ---------- Emoji + sticker picker ----------

export function EmojiStickerPicker({
  onEmoji,
  onSticker,
}: {
  onEmoji: (emoji: string) => void;
  onSticker: (sticker: Sticker) => void;
}) {
  const [tab, setTab] = useState<"emoji" | "sticker">("emoji");
  const [group, setGroup] = useState("smileys");
  const [recent, setRecent] = useState(readRecent);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () => [
      ...(recent.length ? [{ id: "zuletzt", label: "Zuletzt benutzt", icon: "🕘", list: recent }] : []),
      ...EMOJI_GROUPS.map((g) => ({ ...g, list: g.emojis.split(" ") })),
    ],
    [recent],
  );

  return (
    <div className="mica absolute bottom-full left-0 z-10 mb-2 flex h-[340px] w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border shadow-2xl">
      <div className="flex gap-1 border-b border-border p-1.5">
        {(
          [
            ["emoji", "Emojis", Smile],
            ["sticker", "Sticker", StickerIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px]",
              tab === id ? "bg-accent/20 font-medium text-accent" : "text-muted hover:bg-fg/8",
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "emoji" ? (
        <>
          <div className="flex gap-0.5 border-b border-border px-1.5 py-1">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                title={g.label}
                onClick={() => {
                  setGroup(g.id);
                  listRef.current?.querySelector(`[data-group="${g.id}"]`)?.scrollIntoView({ block: "start" });
                }}
                className={cn("grid size-7 place-items-center rounded-md text-[16px] hover:bg-fg/10", group === g.id && "bg-fg/10")}
              >
                {g.icon}
              </button>
            ))}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1.5">
            {groups.map((g) => (
              <section key={g.id} data-group={g.id} className="mb-1">
                <p className="sticky top-0 bg-surface/95 px-1 py-1 text-[11px] font-medium text-muted">{g.label}</p>
                <div className="grid grid-cols-8">
                  {g.list.map((e) => (
                    <button
                      key={`${g.id}-${e}`}
                      type="button"
                      onClick={() => {
                        pushRecent(e);
                        setRecent(readRecent());
                        onEmoji(e);
                      }}
                      className="grid aspect-square place-items-center rounded-md text-[22px] transition-transform hover:scale-110 hover:bg-fg/10"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-auto p-2">
          {STICKERS.map((s) => (
            <button key={s.id} type="button" onClick={() => onSticker(s)} className="transition-transform hover:scale-105" title={s.label}>
              <StickerView sticker={s} small />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StickerView({ sticker: s, small }: { sticker: Sticker; small?: boolean }) {
  return (
    <span
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-2xl text-white shadow-lg",
        small ? "aspect-square w-full p-1" : "size-32 p-2",
      )}
      style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})` }}
    >
      <span className="absolute -right-3 -top-3 size-12 rounded-full bg-white/15" />
      <span className={cn("drop-shadow-lg", small ? "text-[34px]" : "furr-sticker-pop text-[58px]")}>{s.emoji}</span>
      <span
        className={cn("font-bold leading-tight", small ? "text-[10px]" : "text-[13px]")}
        style={{ textShadow: "0 1px 3px rgb(0 0 0 / 0.45)" }}
      >
        {s.label}
      </span>
    </span>
  );
}

// ---------- Attach menu ----------

export function AttachMenu({
  canUseEvidence,
  onCase,
  onFile,
  onClose,
}: {
  canUseEvidence: boolean;
  onCase: (c: { path: string; caseId: string; platform: string }) => void;
  onFile: (file: File) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"menu" | "cases">("menu");
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cases = useQuery({
    queryKey: ["furr", "evidence", "cases"],
    queryFn: () => listEvidenceCases(),
    enabled: view === "cases" && canUseEvidence,
  });
  const q = search.trim().toLowerCase();
  const list = (cases.data ?? []).filter((c) => !q || c.caseId.toLowerCase().includes(q) || c.platform.toLowerCase().includes(q));

  return (
    <div className="mica absolute bottom-full left-0 z-10 mb-2 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border shadow-2xl">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
          onClose();
        }}
      />
      {view === "menu" ? (
        <div className="grid p-1.5">
          {canUseEvidence && (
            <button type="button" onClick={() => setView("cases")} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fg/8">
              <span className="grid size-8 place-items-center rounded-lg bg-amber-500/20 text-amber-300">
                <FolderLock className="size-4" />
              </span>
              <span>
                <span className="block text-[13px] font-medium">Fallakte anhängen</span>
                <span className="block text-[11px] text-muted">Einen Fall aus FurrEvidence auswählen</span>
              </span>
            </button>
          )}
          <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fg/8">
            <span className="grid size-8 place-items-center rounded-lg bg-accent/20 text-accent">
              <FileUp className="size-4" />
            </span>
            <span>
              <span className="block text-[13px] font-medium">Datei vom PC</span>
              <span className="block text-[11px] text-muted">Bild, Video, Dokument … (max. 3 MB)</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="flex h-[300px] flex-col">
          <div className="flex items-center gap-2 border-b border-border p-2">
            <button type="button" onClick={() => setView("menu")} className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-fg/8 hover:text-fg">
              ‹ Zurück
            </button>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Fall suchen"
                className="h-7 w-full rounded-md border border-border bg-bg/60 pl-7 pr-2 text-[12px] outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {cases.isError ? (
              <p className="p-2 text-[12px] text-danger">{errorMessage(cases.error)}</p>
            ) : !cases.data ? (
              <p className="p-2 text-[12px] text-muted">Lade Fälle…</p>
            ) : list.length === 0 ? (
              <p className="p-2 text-[12px] text-muted">Keine Fallakten gefunden.</p>
            ) : (
              list.map((c) => (
                <button
                  key={c.path}
                  type="button"
                  onClick={() => {
                    onCase({ path: c.path, caseId: c.caseId, platform: c.platform });
                    onClose();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-fg/8"
                >
                  <FolderLock className="size-4 shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{c.caseId.replace(/_\d{4}-.*$/, "")}</span>
                    <span className="block text-[11px] text-muted">
                      {c.platform} · {new Date(c.createdAt).toLocaleDateString("de-DE")} · {c.fileCount} {c.fileCount === 1 ? "Datei" : "Dateien"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
