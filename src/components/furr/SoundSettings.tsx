// FurrSettings → Töne: notification sounds on/off, volume and "try it".
import { Volume2 } from "lucide-react";
import { SOUNDS, playSound, useSounds } from "@/lib/furr/sounds";
import { cn } from "@/lib/utils";
import { Btn } from "./ui";

export function SoundSettings() {
  const enabled = useSounds((s) => s.enabled);
  const volume = useSounds((s) => s.volume);
  const setEnabled = useSounds((s) => s.setEnabled);
  const setVolume = useSounds((s) => s.setVolume);
  return (
    <div className="grid max-w-xl gap-4">
      <div className="grid gap-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <Volume2 className="size-5 text-accent" /> Töne
        </p>
        <p className="text-[12px] text-muted">Für jede Art von Meldung gibt es einen eigenen Ton, damit du sie ohne Hinschauen erkennst – auch in VR.</p>
      </div>
      {SOUNDS.map((sound) => (
        <div key={sound.id} className="flex items-center gap-3 rounded-lg bg-elevated/30 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px]">{sound.label}</p>
            <p className="text-[11px] text-muted">{sound.hint}</p>
          </div>
          <Btn variant="ghost" onClick={() => playSound(sound.id, { force: true })}>
            Anhören
          </Btn>
          <button
            type="button"
            role="switch"
            aria-checked={enabled[sound.id]}
            aria-label={sound.label}
            onClick={() => setEnabled(sound.id, !enabled[sound.id])}
            className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", enabled[sound.id] ? "bg-accent" : "bg-fg/20")}
          >
            <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", enabled[sound.id] ? "left-[22px]" : "left-0.5")} />
          </button>
        </div>
      ))}
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
