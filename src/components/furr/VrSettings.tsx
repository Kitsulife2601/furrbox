// FurrSettings → FurrBox VR: the panel on your arm in SteamVR – on/off, what it shows, where it sits.
import { useEffect, useState } from "react";
import { Glasses } from "lucide-react";
import { cn } from "@/lib/utils";
import { VR_INFOS, VR_WIDGETS, useVrSettings, type VrInfoPlace } from "@/store/vr";
import { DesktopHint } from "./VRChat";
import { chatboxStatusBridge } from "./useChatboxStatus";
import { Btn } from "./ui";

type Placement = { hand: "left" | "right"; width: number; x: number; y: number; z: number; tilt: number; roll?: number; turn?: number };

/** Ready-made positions (for the left arm; mirrored for the right one). */
const PRESETS: { id: string; label: string; hint: string; place: Omit<Placement, "hand"> }[] = [
  { id: "wrist", label: "Hand bis Handgelenk", hint: "quer und flach auf dem Handrücken", place: { width: 0.2, x: 0, y: 0.05, z: 0.08, tilt: 0, roll: 0, turn: 90 } },
  { id: "watch", label: "Unterarm", hint: "quer, weiter Richtung Ellbogen", place: { width: 0.2, x: 0, y: 0.04, z: 0.22, tilt: 0, roll: 0, turn: 90 } },
  { id: "edge", label: "Handkante", hint: "seitlich außen an der Hand", place: { width: 0.16, x: -0.07, y: 0, z: 0.06, tilt: 0, roll: -90, turn: 0 } },
];
type VrState = {
  status: "off" | "waiting" | "running" | "unsupported";
  error: string | null;
  enabled: boolean;
  installed: boolean;
  /** Hanging on a controller right now (false = waiting for the controller). */
  attached?: boolean;
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
  const infos = useVrSettings((s) => s.infos);
  const setInfo = useVrSettings((s) => s.setInfo);
  const texts = useVrSettings((s) => s.texts);
  const setTexts = useVrSettings((s) => s.setTexts);
  const [draft, setDraft] = useState(texts.join("\n"));
  const buttonMode = useVrSettings((s) => s.buttonMode);
  const setButtonMode = useVrSettings((s) => s.setButtonMode);
  const status = useVrSettings((s) => s.status);
  const setStatus = useVrSettings((s) => s.setStatus);

  useEffect(() => {
    if (!bridge) return;
    void bridge.status().then(setState);
    return bridge.onChange(setState);
  }, [bridge]);

  if (!bridge) {
    return (
      <div className="grid max-w-xl gap-3">
        <Header />
        <DesktopHint what="FurrBox VR (das Fenster am Arm in SteamVR)" version="2.0.18" />
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
            {!state
              ? "Lade…"
              : (state.error ??
                (state.enabled && state.status === "running" && state.attached === false
                  ? "Mit SteamVR verbunden – warte auf den Controller (einschalten und kurz bewegen)."
                  : STATUS_TEXT[state.enabled ? state.status : "off"]))}
          </p>
        </div>
        <Toggle on={Boolean(state?.enabled)} label="FurrBox VR" onChange={(on) => void bridge.enable(on).then(setState)} />
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-elevated/40 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Nur ein kleiner Knopf am Arm</p>
          <p className="text-[12px] text-muted">
            {buttonMode
              ? "Am Arm sitzt nur ein kleiner Pfoten-Knopf. Tippst du ihn an, klappt das Fenster auf. Bei Votekick, neuer Chat-Nachricht oder neuer Gruppen-Instanz öffnet es sich von selbst und schließt sich danach wieder."
              : "Das Fenster ist dauerhaft am Arm zu sehen."}
          </p>
        </div>
        <Toggle on={buttonMode} label="Nur Knopf am Arm" onChange={setButtonMode} />
      </div>

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Seiten am Arm</h3>
        <p className="text-[11px] text-muted">
          Zwischen den Seiten wechselst du in VR durch Wischen (Trigger halten und zur Seite ziehen) oder mit den Pfeilen.
        </p>
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

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Kleine Infos oben und unten</h3>
        <p className="text-[11px] text-muted">Wähle für jede Info, ob sie in der Leiste über oder unter den Seiten steht.</p>
        {VR_INFOS.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg bg-elevated/30 px-3 py-1.5">
            <p className="min-w-0 flex-1 text-[13px]">{item.label}</p>
            <div className="flex rounded-md bg-bg/60 p-0.5 text-[12px]">
              {(
                [
                  ["top", "Oben"],
                  ["bottom", "Unten"],
                  ["off", "Aus"],
                ] as [VrInfoPlace, string][]
              ).map(([place, label]) => (
                <button
                  key={place}
                  type="button"
                  onClick={() => setInfo(item.id, place)}
                  className={cn("rounded px-2.5 py-1", infos[item.id] === place ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-subtle">
          „Wie lange die Instanz offen ist“ weiß FurrBox genau bei Instanzen unserer Gruppe. Bei anderen steht dort, wie lange sie mindestens
          läuft (seit du drin bist).
        </p>
      </section>

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Dauerhaft in der VRChat-Chatbox</h3>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-elevated/40 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">Infos über deinem Kopf anzeigen</p>
            <p className="text-[12px] text-muted">
              {chatboxStatusBridge()
                ? "FurrBox schreibt die gewählten Infos alle 5 Sekunden neu in deine Chatbox – solange du in einer Welt bist. Jeder in der Nähe sieht sie."
                : "Braucht die FurrBox-Desktop-App in der neuesten Version."}
            </p>
          </div>
          <Toggle on={status.enabled} label="Dauerhaft in der Chatbox" onChange={(on) => setStatus({ enabled: on })} />
        </div>
        {status.enabled && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {VR_INFOS.map((item) => {
                const on = status.items.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setStatus({
                        items: on ? status.items.filter((id) => id !== item.id) : VR_INFOS.map((i) => i.id).filter((id) => id === item.id || status.items.includes(id)),
                      })
                    }
                    className={cn("rounded-full px-3 py-1.5 text-[12px]", on ? "bg-accent text-accent-fg" : "bg-elevated/60 text-muted hover:text-fg")}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <input
              value={status.text}
              onChange={(e) => setStatus({ text: e.target.value.slice(0, 60) })}
              placeholder="Eigener Text in der ersten Zeile (optional), z. B. Mod im Dienst"
              className="h-9 rounded-lg border border-border bg-bg/60 px-3 text-[13px] outline-none focus:border-accent"
            />
            <p className="text-[11px] text-subtle">
              In VRChat muss OSC eingeschaltet sein (Aktionsmenü → Optionen → OSC → Aktiviert). Drückst du am Arm einen Schnelltext, bleibt er
              10 Sekunden stehen, danach kommen die Infos zurück.
            </p>
          </>
        )}
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
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  // Mirror left/right for the right arm.
                  const mirror = p.hand === "right" ? -1 : 1;
                  place({
                    ...preset.place,
                    x: preset.place.x * mirror,
                    roll: (preset.place.roll ?? 0) * mirror,
                    turn: (preset.place.turn ?? 0) * mirror,
                  });
                }}
                className="rounded-lg border border-border bg-elevated/40 px-2 py-2 text-left hover:border-accent"
              >
                <span className="block text-[13px] font-medium">{preset.label}</span>
                <span className="block text-[11px] text-muted">{preset.hint}</span>
              </button>
            ))}
          </div>
          <Slider label="Größe (Breite)" value={cm(p.width)} min={8} max={50} step={1} unit="cm" onChange={(v) => place({ width: v / 100 })} />
          <Slider label="Links / Rechts" value={cm(p.x)} min={-30} max={30} step={1} unit="cm" onChange={(v) => place({ x: v / 100 })} />
          <Slider label="Höhe über Hand" value={cm(p.y)} min={-20} max={30} step={1} unit="cm" onChange={(v) => place({ y: v / 100 })} />
          <Slider label="Zum Ellbogen" value={cm(p.z)} min={-20} max={40} step={1} unit="cm" onChange={(v) => place({ z: v / 100 })} />
          <Slider label="Neigung zu dir" value={Math.round(p.tilt)} min={-60} max={90} step={5} unit="°" onChange={(v) => place({ tilt: v })} />
          <Slider label="Seitlich kippen" value={Math.round(p.roll ?? 0)} min={-180} max={180} step={5} unit="°" onChange={(v) => place({ roll: v })} />
          <Slider label="Drehen" value={Math.round(p.turn ?? 0)} min={-180} max={180} step={5} unit="°" onChange={(v) => place({ turn: v })} />
          <p className="text-[11px] text-subtle">
            Steht der Text auf dem Kopf, stell „Drehen“ auf den Wert mit umgekehrtem Vorzeichen (z. B. −90 statt 90).
          </p>
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
        Ein FurrBox-Fenster an deinem Arm in SteamVR – mit Uhr, Instanz-Liste, Votekick-Warnung und Chatbox-Knöpfen. Zeig mit dem anderen
        Controller darauf, dann erscheint der Laser. Sonst stört es VRChat nicht.
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
