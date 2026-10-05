import { useEffect } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useNow } from "@/lib/furr/live-interval";
import { useDesktop } from "@/store/desktop";
import { DUTY_DOT, DUTY_LABEL, useDuty } from "@/components/furr/useDuty";

/** Sperrbildschirm-sichere Mini-Statuszeile: nur der eigene Anwesenheits-Status, keine Namen/Inhalte. */
function LockDutyLine() {
  const duty = useDuty();
  if (!duty.allowed || duty.loading) return null;
  return (
    <p className="furr-flyout-in flex items-center gap-2 rounded-full bg-bg/45 px-3 py-1 text-[12px] font-medium text-fg/85 backdrop-blur-sm">
      <span className={`size-2 rounded-full ${DUTY_DOT[duty.status]}`} />
      {DUTY_LABEL[duty.status]}
    </p>
  );
}

function LockClock() {
  // Nur HH:mm – 30s-Tick, isoliert vom Rest des Lockscreens.
  const now = useNow(30_000);
  return (
    <>
      <p className="text-7xl font-medium tracking-tight tabular-nums md:text-8xl">{format(now, "HH:mm")}</p>
      <p className="mt-2 text-lg font-medium capitalize text-fg/85">{format(now, "EEEE, d. MMMM", { locale: de })}</p>
    </>
  );
}

export function LockScreen({ userName, style }: { userName: string | null; style?: React.CSSProperties }) {
  const unlock = useDesktop((s) => s.unlock);
  const wallpaper = useDesktop((s) => s.wallpaper);

  useEffect(() => {
    const onKey = () => unlock();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlock]);

  return (
    <button
      type="button"
      onClick={unlock}
      style={style}
      className={`furr-lock-in relative flex h-dvh w-full flex-col items-center justify-end overflow-hidden bg-cover bg-center wallpaper-${wallpaper} text-fg`}
    >
      <div className="pointer-events-none absolute inset-0 bg-bg/25" />
      <div className="relative mb-auto mt-[18vh] flex flex-col items-center text-center">
        <LockClock />
        {/* Nur mit bestehender Sitzung – vor dem Login keine Server-Abfragen. */}
        {userName && (
          <div className="mt-4">
            <LockDutyLine />
          </div>
        )}
      </div>
      <div className="relative mb-16 flex flex-col items-center gap-3">
        <div className="flex size-16 items-center justify-center rounded-full bg-elevated/80 text-lg font-semibold">
          {(userName ?? "F").charAt(0).toUpperCase()}
        </div>
        <p className="text-sm font-medium">{userName ?? "FurrBox"}</p>
        <p className="text-xs text-muted">{userName ? "Klicken oder Taste drücken zum Entsperren" : "Klicken zum Anmelden"}</p>
      </div>
    </button>
  );
}
