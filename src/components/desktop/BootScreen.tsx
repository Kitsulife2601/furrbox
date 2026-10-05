// Boot animation (continues the Electron splash): paw logo, boot messages, progress bar,
// then zooms out into the lock screen. Shown once per window session.
// Timings match MOTION (Votekick note gap / spring pop) so boot feels like the rest of the desktop feedback.
import { useEffect, useState } from "react";
import { useDesktop } from "@/store/desktop";
import { MOTION } from "@/lib/furr/motion";

const BOOTED_KEY = "furrbox-booted";
const MESSAGES = ["Kernel wird geladen…", "FurrFS wird eingebunden…", "Discord-Brücke wird verbunden…", "Desktop wird vorbereitet…", "Willkommen"];
const STEP_MS = MOTION.bootStepMs;
const EXIT_MS = MOTION.bootExitMs;
const HOLD_MS = MOTION.bootHoldMs;

function alreadyBooted() {
  try {
    return window.sessionStorage.getItem(BOOTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function BootScreen({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const accent = useDesktop((s) => s.accent);
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  // Reloads (e.g. after the Discord login redirect) skip the animation.
  useEffect(() => {
    if (alreadyBooted()) onDone();
  }, [onDone]);

  useEffect(() => {
    if (step >= MESSAGES.length - 1) return;
    // Hold on the last loading step until the session is known.
    if (step === MESSAGES.length - 2 && !ready) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [step, ready]);

  useEffect(() => {
    if (step !== MESSAGES.length - 1) return;
    const t1 = setTimeout(() => setExiting(true), HOLD_MS);
    const t2 = setTimeout(() => {
      try {
        window.sessionStorage.setItem(BOOTED_KEY, "1");
      } catch {
        /* storage unavailable */
      }
      onDone();
    }, HOLD_MS + EXIT_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [step, onDone]);

  const progress = ((step + 1) / MESSAGES.length) * 100;

  return (
    <div
      className="boot-screen fixed inset-0 z-[10000] grid place-items-center overflow-hidden bg-[#06070b] text-[#f3f4f6]"
      style={{
        ["--boot-accent" as string]: accent,
        opacity: exiting ? 0 : 1,
        transition: `opacity ${EXIT_MS}ms ${MOTION.easeOut}`,
      }}
      aria-live="polite"
    >
      <div className="boot-glow pointer-events-none absolute -inset-[20%]" />
      <div
        className="relative flex flex-col items-center"
        style={{
          transform: exiting ? "scale(1.35)" : "scale(1)",
          transition: `transform ${EXIT_MS}ms ${MOTION.easePop}`,
        }}
      >
        <div className="relative size-[150px]">
          <svg className="boot-ring absolute inset-0" viewBox="0 0 150 150" aria-hidden="true">
            <circle cx="75" cy="75" r="70" />
          </svg>
          <svg className="boot-paw absolute inset-[30px]" viewBox="0 0 100 100" aria-hidden="true">
            <g transform="rotate(-20 20 42)">
              <ellipse cx="20" cy="42" rx="9" ry="12" />
            </g>
            <g transform="rotate(-6 38 24)">
              <ellipse cx="38" cy="24" rx="10" ry="13" />
            </g>
            <g transform="rotate(6 62 24)">
              <ellipse cx="62" cy="24" rx="10" ry="13" />
            </g>
            <g transform="rotate(20 80 42)">
              <ellipse cx="80" cy="42" rx="9" ry="12" />
            </g>
            <path d="M50 48c-13 0-26 13-28 26-2 11 6 17 15 15 5-1 9-3 13-3s8 2 13 3c9 2 17-4 15-15-2-13-15-26-28-26z" />
          </svg>
        </div>
        <p className="boot-word mt-[26px] text-[30px] font-semibold tracking-[0.06em]">FurrBox</p>
        <div className="mt-[26px] h-[3px] w-[220px] overflow-hidden rounded-full bg-white/10">
          <div className="boot-fill h-full rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 min-h-[18px] text-[13px] text-[#9aa1ad]">{MESSAGES[step]}</p>
      </div>
    </div>
  );
}
