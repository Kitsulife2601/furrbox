import { useEffect, useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useDesktop } from "@/store/desktop";

export function LockScreen({ userName, style }: { userName: string | null; style?: React.CSSProperties }) {
  const unlock = useDesktop((s) => s.unlock);
  const wallpaper = useDesktop((s) => s.wallpaper);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const onKey = () => unlock();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
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
        <p className="text-7xl font-medium tracking-tight tabular-nums md:text-8xl">{format(now, "HH:mm")}</p>
        <p className="mt-2 text-lg font-medium capitalize text-fg/85">{format(now, "EEEE, d. MMMM", { locale: de })}</p>
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
