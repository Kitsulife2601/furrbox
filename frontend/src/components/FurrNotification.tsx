"use client";

import { BellRing, X } from "lucide-react";
import { useNotificationStore } from "@/store/useNotificationStore";

export function FurrNotification() {
  const notifications = useNotificationStore((state) => state.notifications);
  const dismiss = useNotificationStore((state) => state.dismiss);

  if (!notifications.length) return null;

  return (
    <div className="fixed right-4 top-4 z-[9999] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3 pointer-events-none">
      {notifications.map((notification) => (
        <article
          key={notification.id}
          className="pointer-events-auto relative overflow-hidden rounded-xl border border-cyan-500/40 bg-slate-950/80 p-4 text-slate-100 shadow-[0_0_28px_rgba(0,240,255,0.28),0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl animate-furr-toast"
          style={{ animationDuration: `${notification.durationMs}ms` }}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-cyan-300/35 bg-cyan-300/10 text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.35)]">
              <BellRing size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">{notification.version}</p>
                  <h3 className="mt-1 truncate text-[14px] font-black text-white">{notification.title}</h3>
                </div>
                <button
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-500 transition hover:border-pink-400/40 hover:bg-pink-500/10 hover:text-pink-200"
                  aria-label="Notification schließen"
                  onClick={() => dismiss(notification.id)}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-slate-300">{notification.description}</p>
            </div>
          </div>
          <div
            className="absolute bottom-0 left-0 h-[3px] origin-left bg-gradient-to-r from-[#00f0ff] via-[#8b5cf6] to-[#ff007f] shadow-[0_0_14px_rgba(0,240,255,0.75)] animate-furr-toast-bar"
            style={{ animationDuration: `${notification.durationMs}ms` }}
          />
        </article>
      ))}
    </div>
  );
}
