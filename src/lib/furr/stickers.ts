// FurrChat stickers: drawn in the app (big emoji on a coloured card with a caption).
export type Sticker = { id: string; emoji: string; label: string; from: string; to: string };

export const STICKERS: Sticker[] = [
  { id: "hallo", emoji: "🦊", label: "Hallo!", from: "#fb923c", to: "#f43f5e" },
  { id: "pfote", emoji: "🐾", label: "Pfote drauf", from: "#4cc2ff", to: "#a78bfa" },
  { id: "kuscheln", emoji: "🫂", label: "Kuscheln?", from: "#f472b6", to: "#c084fc" },
  { id: "danke", emoji: "💖", label: "Danke!", from: "#fb7185", to: "#f472b6" },
  { id: "gutenacht", emoji: "🌙", label: "Gute Nacht", from: "#6366f1", to: "#1e1b4b" },
  { id: "morgen", emoji: "☀️", label: "Guten Morgen", from: "#fbbf24", to: "#fb923c" },
  { id: "lol", emoji: "😹", label: "LOL", from: "#facc15", to: "#f97316" },
  { id: "traurig", emoji: "🥺", label: "Bitte…", from: "#93c5fd", to: "#6366f1" },
  { id: "wow", emoji: "🤯", label: "Wow!", from: "#f97316", to: "#ef4444" },
  { id: "daumen", emoji: "👍", label: "Passt!", from: "#34d399", to: "#059669" },
  { id: "achtung", emoji: "⚠️", label: "Achtung", from: "#fbbf24", to: "#b45309" },
  { id: "bann", emoji: "🔨", label: "Bann-Hammer", from: "#ef4444", to: "#7f1d1d" },
  { id: "schild", emoji: "🛡️", label: "Mod im Dienst", from: "#22d3ee", to: "#2563eb" },
  { id: "kaffee", emoji: "☕", label: "Kaffeepause", from: "#a16207", to: "#451a03" },
  { id: "party", emoji: "🎉", label: "Party!", from: "#e879f9", to: "#6366f1" },
  { id: "afk", emoji: "💤", label: "Bin AFK", from: "#64748b", to: "#1e293b" },
];

export const STICKER_IDS = new Set(STICKERS.map((s) => s.id));

export function getSticker(id: string) {
  return STICKERS.find((s) => s.id === id) ?? null;
}
