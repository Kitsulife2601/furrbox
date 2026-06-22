"use client";

import { Minus, Square, X } from "lucide-react";
import clsx from "clsx";

declare global {
  interface Window {
    furrboxWindow?: {
      minimize: () => Promise<void>;
      close: () => Promise<void>;
      toggleKiosk: () => Promise<boolean>;
    };
  }
}

type Props = {
  title: string;
  children: React.ReactNode;
  className?: string;
  toolbar?: React.ReactNode;
};

export function WindowFrame({ title, children, className, toolbar }: Props) {
  return (
    <section className={clsx("glass-strong animate-window-in overflow-hidden rounded-[18px] shadow-window", className)}>
      <header className="flex h-12 items-center justify-between border-b border-white/45 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-sky-500 shadow-sm" />
          <h2 className="truncate text-[13px] font-semibold text-slate-800">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          <button
            aria-label="Minimize"
            className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-white/55"
            onClick={() => window.furrboxWindow?.minimize()}
          >
            <Minus size={15} />
          </button>
          <button
            aria-label="Toggle fullscreen"
            className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-white/55"
            onClick={() => window.furrboxWindow?.toggleKiosk()}
          >
            <Square size={13} />
          </button>
          <button
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-red-500 hover:text-white"
            onClick={() => window.furrboxWindow?.close()}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      {children}
    </section>
  );
}
