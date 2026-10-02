// FurrChat: emoji + sticker picker and the attach menu (Fallakte / Datei vom PC).
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, FolderLock, Plus, Search, Smile, Sticker as StickerIcon, Trash2 } from "lucide-react";
import { listEvidenceCases } from "@/lib/furr/api/evidence";
import { createCustomSticker, deleteCustomSticker, listCustomStickers, readCustomSticker } from "@/lib/furr/api/stickers";
import { errorMessage } from "@/lib/furr/client";
import { STICKERS, getSticker, type Sticker } from "@/lib/furr/stickers";
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
  /** Built-in sticker id, or "custom:<id>" for a sticker the team made. */
  onSticker: (stickerId: string) => void;
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
        <StickerTab onSticker={onSticker} />
      )}
    </div>
  );
}

// Caption outline so it reads on any chat background (stickers have no background of their own).
const CAPTION_OUTLINE =
  "-1px -1px 0 rgb(0 0 0 / .75), 1px -1px 0 rgb(0 0 0 / .75), -1px 1px 0 rgb(0 0 0 / .75), 1px 1px 0 rgb(0 0 0 / .75), 0 2px 6px rgb(0 0 0 / .5)";

/** A sticker as sent in the chat: transparent, no card around it. */
export function StickerView({ sticker: s, small }: { sticker: Sticker; small?: boolean }) {
  return (
    <span className={cn("grid place-items-center text-white", small ? "aspect-square w-full p-1" : "w-36 p-1")}>
      <span
        className={cn(small ? "text-[34px]" : "furr-sticker-pop text-[76px]", "leading-none")}
        style={{ filter: "drop-shadow(0 4px 8px rgb(0 0 0 / .45))" }}
      >
        {s.emoji}
      </span>
      <span
        className={cn("mt-1 text-center font-extrabold leading-tight", small ? "text-[10px]" : "text-[14px]")}
        style={{ textShadow: CAPTION_OUTLINE }}
      >
        {s.label}
      </span>
    </span>
  );
}

/** Built-in or team-made sticker by id. */
export function AnySticker({ stickerId, small }: { stickerId: string; small?: boolean }) {
  const custom = /^custom:(.+)$/.exec(stickerId)?.[1];
  if (custom) return <CustomStickerImage id={custom} small={small} />;
  const sticker = getSticker(stickerId);
  return sticker ? <StickerView sticker={sticker} small={small} /> : <span className="text-[12px] text-muted">Sticker</span>;
}

function CustomStickerImage({ id, small, name }: { id: string; small?: boolean; name?: string }) {
  const q = useQuery({
    queryKey: ["furr", "sticker", id],
    queryFn: () => readCustomSticker({ data: id }),
    staleTime: Infinity,
    retry: false,
  });
  const box = small ? "aspect-square w-full" : "size-36";
  if (q.isError) {
    return <span className={cn(box, "grid place-items-center text-center text-[11px] text-subtle")}>Sticker gelöscht</span>;
  }
  if (!q.data) return <span className={cn(box, "block animate-pulse rounded-xl bg-fg/5")} />;
  return (
    <img
      src={`data:${q.data.mimeType};base64,${q.data.base64}`}
      alt={name ?? "Sticker"}
      className={cn(box, "object-contain", !small && "furr-sticker-pop")}
      style={{ filter: "drop-shadow(0 4px 8px rgb(0 0 0 / .35))" }}
    />
  );
}

function StickerTab({ onSticker }: { onSticker: (stickerId: string) => void }) {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const custom = useQuery({ queryKey: ["furr", "stickers"], queryFn: () => listCustomStickers(), staleTime: 60_000 });
  if (creating) return <CreateSticker onDone={() => setCreating(false)} />;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <p className="px-1 pb-1 text-[11px] font-medium text-muted">Eigene Sticker</p>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={() => setCreating(true)}
          title="Eigenen Sticker erstellen"
          aria-label="Eigenen Sticker erstellen"
          className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-border text-muted hover:border-accent hover:text-accent"
        >
          <Plus className="size-6" />
        </button>
        {(custom.data ?? []).map((s) => (
          <div key={s.id} className="group relative">
            <button
              type="button"
              onClick={() => onSticker(`custom:${s.id}`)}
              title={`${s.name} · von ${s.createdBy}`}
              className="w-full rounded-xl p-1 transition-transform hover:scale-105 hover:bg-fg/8"
            >
              <CustomStickerImage id={s.id} name={s.name} small />
            </button>
            {s.mine && (
              <button
                type="button"
                aria-label={`Sticker ${s.name} löschen`}
                title="Löschen"
                onClick={async () => {
                  if (!window.confirm(`Sticker „${s.name}“ löschen?`)) return;
                  await deleteCustomSticker({ data: s.id }).catch(() => undefined);
                  await queryClient.invalidateQueries({ queryKey: ["furr", "stickers"] });
                }}
                className="absolute -right-1 -top-1 hidden rounded-full bg-danger p-1 text-white shadow group-hover:block"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="px-1 pb-1 pt-3 text-[11px] font-medium text-muted">FurrBox-Sticker</p>
      <div className="grid grid-cols-4 gap-1.5">
        {STICKERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSticker(s.id)}
            className="rounded-xl transition-transform hover:scale-105 hover:bg-fg/8"
            title={s.label}
          >
            <StickerView sticker={s} small />
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateSticker({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<{ mimeType: string; base64: string } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) return setError("Bitte ein Bild auswählen.");
    if (file.size > 1024 * 1024) return setError("Das Bild ist zu groß (max. 1 MB).");
    const reader = new FileReader();
    reader.onload = () => {
      setImage({ mimeType: file.type, base64: String(reader.result).split(",")[1] ?? "" });
      setName((current) => current || file.name.replace(/\.[^.]+$/, "").slice(0, 40));
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!image) return;
    setBusy(true);
    setError("");
    try {
      await createCustomSticker({ data: { name, ...image } });
      await queryClient.invalidateQueries({ queryKey: ["furr", "stickers"] });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/gif,image/webp,image/jpeg"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <p className="text-[13px] font-semibold">Eigenen Sticker erstellen</p>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files?.[0]);
        }}
        className="grid h-32 shrink-0 place-items-center rounded-xl border-2 border-dashed border-border hover:border-accent"
        style={{
          backgroundImage: "repeating-conic-gradient(rgb(255 255 255 / .06) 0 25%, transparent 0 50%)",
          backgroundSize: "16px 16px",
        }}
      >
        {image ? (
          <img src={`data:${image.mimeType};base64,${image.base64}`} alt="" className="max-h-28 max-w-full object-contain" />
        ) : (
          <span className="px-3 text-center text-[12px] text-muted">
            Bild auswählen oder hierher ziehen
            <br />
            <span className="text-[11px] text-subtle">PNG mit durchsichtigem Hintergrund sieht am besten aus · max. 1 MB</span>
          </span>
        )}
      </button>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="Name des Stickers"
        className="h-8 shrink-0 rounded-md border border-border bg-bg/60 px-2.5 text-[12px] outline-none focus:border-accent"
      />
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="mt-auto flex gap-2">
        <button type="button" onClick={onDone} className="flex-1 rounded-md px-3 py-1.5 text-[12px] text-muted hover:bg-fg/8">
          Abbrechen
        </button>
        <button
          type="button"
          disabled={!image || !name.trim() || busy}
          onClick={() => void save()}
          className="flex-1 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? "Speichere…" : "Sticker speichern"}
        </button>
      </div>
      <p className="text-[11px] text-subtle">Eigene Sticker kann das ganze Team benutzen.</p>
    </div>
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
