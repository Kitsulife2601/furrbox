// FurrSettings → Töne: notification sounds on/off, volume and "try it".
import { useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import {
  SOUNDS,
  customSound,
  playSound,
  setCustomSound,
  useSounds,
  type SoundKind,
} from "@/lib/furr/sounds";
import { errorMessage } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { Btn } from "./ui";

export function SoundSettings() {
  const enabled = useSounds((s) => s.enabled);
  const volume = useSounds((s) => s.volume);
  const setEnabled = useSounds((s) => s.setEnabled);
  const setVolume = useSounds((s) => s.setVolume);
  const fileRef = useRef<HTMLInputElement>(null);
  const picking = useRef<SoundKind>("chat");
  // Re-render after a file was picked or removed (the files live outside the settings store).
  const [, refresh] = useState(0);
  const [error, setError] = useState("");

  async function choose(kind: SoundKind, file: File | null) {
    setError("");
    try {
      await setCustomSound(kind, file);
      refresh((n) => n + 1);
      if (file) playSound(kind, { force: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="grid max-w-xl gap-4">
      <div className="grid gap-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <Volume2 className="size-5 text-accent" /> Töne
        </p>
        <p className="text-[12px] text-muted">
          Für jede Art von Meldung gibt es einen eigenen Ton, damit du sie ohne Hinschauen erkennst
          – auch in VR.
        </p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (file) void choose(picking.current, file);
        }}
      />
      {SOUNDS.map((sound) => {
        const own = customSound(sound.id);
        return (
          <div
            key={sound.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-elevated/30 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px]">{sound.label}</p>
              <p className="truncate text-[11px] text-muted">
                {own ? `Eigener Ton: ${own.name}` : sound.hint}
              </p>
            </div>
            <Btn
              variant="ghost"
              onClick={() => {
                picking.current = sound.id;
                fileRef.current?.click();
              }}
            >
              Eigener Ton…
            </Btn>
            {own && (
              <Btn variant="ghost" onClick={() => void choose(sound.id, null)}>
                Zurücksetzen
              </Btn>
            )}
            <Btn variant="ghost" onClick={() => playSound(sound.id, { force: true })}>
              Anhören
            </Btn>
            <button
              type="button"
              role="switch"
              aria-checked={enabled[sound.id]}
              aria-label={sound.label}
              onClick={() => setEnabled(sound.id, !enabled[sound.id])}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                enabled[sound.id] ? "bg-accent" : "bg-fg/20",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                  enabled[sound.id] ? "left-[22px]" : "left-0.5",
                )}
              />
            </button>
          </div>
        );
      })}
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <p className="text-[11px] text-subtle">
        Eigene Töne: kurze Tondatei (MP3, WAV, OGG, max. 600 KB). Sie bleibt auf diesem PC
        gespeichert und gilt nur für dich.
      </p>
      <label className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-[12px]">
        <span className="text-muted">Lautstärke</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={() => playSound("chat", { force: true })}
          className="accent-[var(--color-accent)]"
        />
        <span className="text-right tabular-nums text-muted">{volume} %</span>
      </label>
    </div>
  );
}
