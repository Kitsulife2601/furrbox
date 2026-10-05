/**
 * Schmales Mod-Dashboard (P2) – max. 3 Widgets: Alerts, Duty, Instance.
 * Idle-sparsam: nutzt vorhandene Stores/Queries, kein Extra-Polling.
 */
import type { ReactNode } from "react";
import { AlertTriangle, MapPin, ShieldCheck, UserCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { desktopVrchat, unwrap, type VrcInstanceState } from "@/components/furr/VRChat";
import { DUTY_DOT, DUTY_LABEL, useDuty } from "@/components/furr/useDuty";
import { useVoteStore } from "@/components/furr/useVoteWatch";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { MOTION } from "@/lib/furr/motion";
import { cn } from "@/lib/utils";
import { kindOf, NOTIFY_KIND_LABEL, useNotifications } from "@/store/notifications";
import { useDesktop } from "@/store/desktop";

function Widget({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      className="furr-flyout-in flex min-h-0 flex-col rounded-xl border border-border/80 bg-elevated/35"
      style={{ animationDuration: `${MOTION.enterMs}ms` }}
    >
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <span className="text-accent">{icon}</span>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="min-h-0 flex-1 p-3">{children}</div>
    </section>
  );
}

function AlertsWidget() {
  const history = useNotifications((s) => s.history);
  const setTray = useDesktop((s) => s.setTray);
  const recent = history.slice(0, 6);
  return (
    <Widget
      title="Alerts"
      icon={<AlertTriangle className="size-3.5" />}
      action={
        <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setTray("info")}>
          Info-Center
        </button>
      }
    >
      {!recent.length && <p className="text-[12px] text-muted">Keine Benachrichtigungen.</p>}
      <ul className="space-y-1.5">
        {recent.map((t) => (
          <li key={t.id} className="rounded-lg bg-bg/40 px-2.5 py-1.5">
            <p className="truncate text-[12px] font-medium">{t.title}</p>
            <p className="truncate text-[10px] text-muted">
              {NOTIFY_KIND_LABEL[kindOf(t)]} · {t.description}
            </p>
          </li>
        ))}
      </ul>
    </Widget>
  );
}

function DutyWidget() {
  const duty = useDuty(20_000);
  const setTray = useDesktop((s) => s.setTray);
  if (!duty.allowed) {
    return (
      <Widget title="Duty" icon={<UserCheck className="size-3.5" />}>
        <p className="text-[12px] text-muted">Nur für Staff.</p>
      </Widget>
    );
  }
  return (
    <Widget
      title="Duty"
      icon={<UserCheck className="size-3.5" />}
      action={
        <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setTray("staff")}>
          Tray
        </button>
      }
    >
      <div className="flex items-center gap-3">
        <span className={cn("size-3 rounded-full ring-2 ring-bg", DUTY_DOT[duty.status])} />
        <div>
          <p className="text-[14px] font-semibold">{DUTY_LABEL[duty.status]}</p>
          <p className="text-[11px] text-muted">{duty.teamOn} im Team anwesend</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["on", "away", "off"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={duty.busy || duty.status === s}
            onClick={() => void duty.setStatus(s)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-[180ms]",
              duty.status === s ? "bg-accent text-accent-fg" : "bg-fg/8 hover:bg-fg/12",
            )}
          >
            {DUTY_LABEL[s]}
          </button>
        ))}
      </div>
      {duty.error && <p className="mt-2 text-[11px] text-red-300">{duty.error}</p>}
    </Widget>
  );
}

function InstanceWidget() {
  const bridge = desktopVrchat();
  const votes = useVoteStore((s) => s.active.length);
  const setCollapsed = useVoteStore((s) => s.setCollapsed);
  const live = useLiveInterval(8_000, Boolean(bridge?.instance));
  const inst = useQuery({
    queryKey: ["furr", "votewatch"],
    queryFn: () => unwrap(desktopVrchat()!.instance!()),
    enabled: Boolean(bridge?.instance),
    refetchInterval: live,
    staleTime: 4_000,
  });
  const s = inst.data as VrcInstanceState | undefined;
  const openApp = useDesktop((s) => s.openApp);

  return (
    <Widget
      title="Instanz"
      icon={<MapPin className="size-3.5" />}
      action={
        <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => openApp("worldmap")}>
          Tracker
        </button>
      }
    >
      {!bridge?.instance && <p className="text-[12px] text-muted">Nur in der Desktop-App (VRChat-Log).</p>}
      {bridge?.instance && !s?.inInstance && (
        <p className="text-[12px] text-muted">{inst.isLoading ? "Lade…" : "Nicht in einer Instanz."}</p>
      )}
      {s?.inInstance && (
        <div className="space-y-1">
          <p className="truncate text-[13px] font-semibold" title={s.worldName ?? undefined}>
            {s.worldName || "Unbekannte Welt"}
          </p>
          <p className="text-[11px] text-muted">
            {s.players?.length ?? 0} Spieler
            {s.location ? ` · ${s.location}` : ""}
          </p>
        </div>
      )}
      {votes > 0 && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-left text-[12px] font-medium text-red-200"
        >
          <ShieldCheck className="size-3.5" />
          {votes} aktiver Votekick – Panel zeigen
        </button>
      )}
    </Widget>
  );
}

export function ModDashboard() {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-3 p-3">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">Mod-Dashboard</h2>
        <p className="text-[12px] text-muted">Alerts · Duty · Instanz — schmal und idle-sparsam.</p>
      </div>
      <div className="grid min-h-0 gap-3 lg:grid-cols-3">
        <AlertsWidget />
        <DutyWidget />
        <InstanceWidget />
      </div>
    </div>
  );
}
