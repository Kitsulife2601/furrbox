// FurrSettings → FurrBox VR: the panel on your arm in SteamVR – on/off, what it shows, where it sits.
import { useEffect, useState } from "react";
import { Glasses } from "lucide-react";
import { cn } from "@/lib/utils";
import { VR_WIDGETS, useVrSettings } from "@/store/vr";
import { DesktopHint } from "./VRChat";
import { Btn } from "./ui";

type Placement = { hand: "left" | "right"; width: number; x: number; y: number; z: number; tilt: number };
type VrState = {
  status: "off" | "waiting" | "running" | "unsupported";
  error: string | null;
  enabled: boolean;
  installed: boolean;
  placement: Placement;
};
type VrBridge = {
  status(): Promise<VrState | null>;
  enable(on: boolean): Promise<VrState | null>;
  setPlacement(p: Partial<Placement>): Promise<VrState | null>;
  onChange(cb: (s: VrState) => void): () => void;
};

function vrBridge(): VrBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { furrbox?: { vr?: VrBridge } }).furrbox?.vr ?? null;
}

const STATUS_TEXT: Record<VrState["status"], string> = {
  off: "Ausgeschaltet",
  waiting: "Wartet auf SteamVR – starte SteamVR, dann erscheint das Fenster am Arm.",
  running: "Verbunden – das Fenster hängt an deinem Arm.",
  unsupported: "Nicht verfügbar",
};

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-fg/20")}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid grid-cols-[110px_1fr_64px] items-center gap-3 text-[12px]">
      <span className="text-muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--color-accent)]" />
      <span className="text-right tabular-nums text-muted">
        {value} {unit}
      </span>
    </label>
  );
}

export function VrSettings() {
  const bridge = vrBridge();
  const [state, setState] = useState<VrState | null>(null);
  const widgets = useVrSettings((s) => s.widgets);
  const setWidget = useVrSettings((s) => s.setWidget);
  const texts = useVrSettings((s) => s.texts);
  const setTexts = useVrSettings((s) => s.setTexts);
  const [draft, setDraft] = useState(texts.join("\n"));

  useEffect(() => {
    if (!bridge) return;
    void bridge.status().then(setState);
    return bridge.onChange(setState);
  }, [bridge]);

  if (!bridge) {
    return (
      <div className="grid max-w-xl gap-3">
        <Header />
        <DesktopHint what="FurrBox VR (das Fenster am Arm in SteamVR)" version="2.0.12" />
      </div>
    );
  }

  const p = state?.placement;
  const cm = (m: number) => Math.round(m * 100);
  const place = (patch: Partial<Placement>) => void bridge.setPlacement(patch).then(setState);

  return (
    <div className="grid max-w-xl gap-5">
      <Header />

      <div className="flex items-center gap-3 rounded-lg border border-border bg-elevated/40 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Fenster am Arm anzeigen</p>
          <p className={cn("text-[12px]", state?.status === "running" ? "text-emerald-300" : "text-muted")}>
            {state ? (state.error ?? STATUS_TEXT[state.enabled ? state.status : "off"]) : "Lade…"}
          </p>
        </div>
        <Toggle on={Boolean(state?.enabled)} label="FurrBox VR" onChange={(on) => void bridge.enable(on).then(setState)} />
      </div>

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Was soll am Arm zu sehen sein?</h3>
        {VR_WIDGETS.map((w) => (
          <div key={w.id} className="flex items-center gap-3 rounded-lg bg-elevated/30 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px]">{w.label}</p>
              <p className="text-[11px] text-muted">{w.hint}</p>
            </div>
            <Toggle on={widgets[w.id]} label={w.label} onChange={(on) => setWidget(w.id, on)} />
          </div>
        ))}
      </section>

      {widgets.chatbox && (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold">Chatbox-Schnelltexte</h3>
          <p className="text-[11px] text-muted">
            Ein Text pro Zeile, höchstens 8. In VRChat muss OSC eingeschaltet sein (Aktionsmenü → Optionen → OSC → Aktiviert).
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            className="rounded-lg border border-border bg-bg/60 p-2.5 text-[13px] outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <Btn variant="primary" onClick={() => setTexts(draft.split("\n"))}>
              Texte speichern
            </Btn>
            <QuickTest />
          </div>
        </section>
      )}

      {p && (
        <section className="grid gap-2.5">
          <h3 className="text-[13px] font-semibold">Position am Arm</h3>
          <p className="text-[11px] text-muted">Änderungen siehst du sofort in VR. Zieh die Regler, bis das Fenster gut sitzt.</p>
          <div className="flex gap-1 rounded-lg bg-bg/60 p-1 text-[12px]">
            {(["left", "right"] as const).map((hand) => (
              <button
                key={hand}
                type="button"
                onClick={() => place({ hand })}
                className={cn("flex-1 rounded-md py-1.5", p.hand === hand ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}
              >
                {hand === "left" ? "Linker Arm" : "Rechter Arm"}
              </button>
            ))}
          </div>
          <Slider label="Größe (Breite)" value={cm(p.width)} min={8} max={50} step={1} unit="cm" onChange={(v) => place({ width: v / 100 })} />
          <Slider label="Links / Rechts" value={cm(p.x)} min={-30} max={30} step={1} unit="cm" onChange={(v) => place({ x: v / 100 })} />
          <Slider label="Höhe über Hand" value={cm(p.y)} min={-20} max={30} step={1} unit="cm" onChange={(v) => place({ y: v / 100 })} />
          <Slider label="Zum Ellbogen" value={cm(p.z)} min={-20} max={40} step={1} unit="cm" onChange={(v) => place({ z: v / 100 })} />
          <Slider label="Neigung zu dir" value={Math.round(p.tilt)} min={-60} max={90} step={5} unit="°" onChange={(v) => place({ tilt: v })} />
          <div>
            <Btn variant="ghost" onClick={() => place({ width: 0.2, x: 0, y: 0.06, z: 0.1, tilt: 0 })}>
              Zurücksetzen
            </Btn>
          </div>
        </section>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <Glasses className="size-5 text-accent" /> FurrBox VR
      </p>
      <p className="text-[12px] text-muted">
        Ein FurrBox-Fenster an deinem Arm in SteamVR – mit Uhr, Instanz-Liste, Votekick-Warnung und Chatbox-Knöpfen. Bedient wird es mit
        dem Laser vom anderen Controller.
      </p>
    </div>
  );
}

/** Sends a test text to the VRChat chatbox via OSC. */
function QuickTest() {
  const [result, setResult] = useState("");
  const osc = (window as { furrbox?: { osc?: { chatbox(text: string): Promise<{ ok: boolean; error?: string }> } } }).furrbox?.osc;
  if (!osc) return null;
  return (
    <>
      <Btn
        variant="ghost"
        onClick={async () => {
          const r = await osc.chatbox("FurrBox-Test 🐾");
          setResult(r.ok ? "Gesendet – steht es über deinem Kopf in VRChat?" : (r.error ?? "Fehler"));
        }}
      >
        Chatbox testen
      </Btn>
      {result && <span className="text-[11px] text-muted">{result}</span>}
    </>
  );
}
