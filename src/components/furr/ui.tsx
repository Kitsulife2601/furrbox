// Minimal shared building blocks (styling is intentionally plain — design pass comes later).
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Btn({
  variant = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent font-medium text-accent-fg",
        variant === "danger" && "bg-danger/90 font-medium text-white",
        variant === "default" && "bg-elevated hover:bg-fg/10",
        variant === "ghost" && "hover:bg-fg/8",
        className,
      )}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1 text-[12px] text-muted">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-bg/60 px-3 text-[13px] text-fg outline-none focus:border-accent",
        className,
      )}
    />
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-md bg-danger/15 px-3 py-2 text-[12px] text-fg">{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-[13px] text-muted">{children}</p>;
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "good" | "warn" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "muted" && "bg-fg/8 text-muted",
        tone === "accent" && "bg-accent/20 text-accent",
        tone === "good" && "bg-emerald-500/20 text-emerald-300",
        tone === "warn" && "bg-amber-500/20 text-amber-300",
        tone === "bad" && "bg-danger/25 text-fg",
      )}
    >
      {children}
    </span>
  );
}

/** Small in-window prompt (replaces window.prompt). */
export function PromptDialog({
  title,
  initial = "",
  confirmLabel = "OK",
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-bg/50 p-4" onMouseDown={onCancel}>
      <form
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <p className="text-[13px] font-medium">{title}</p>
        <TextInput ref={ref} value={value} onChange={(e) => setValue(e.target.value)} className="mt-3" />
        <div className="mt-3 flex justify-end gap-2">
          <Btn onClick={onCancel}>Abbrechen</Btn>
          <Btn type="submit" variant="primary">
            {confirmLabel}
          </Btn>
        </div>
      </form>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Löschen",
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-bg/50 p-4" onMouseDown={onCancel}>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <p className="text-[13px] font-medium">{title}</p>
        {body && <p className="mt-2 text-[12px] text-muted">{body}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onCancel}>Abbrechen</Btn>
          <Btn variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export type MenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean } | "divider";

export function PopupMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 56) });
  }, [x, y]);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="mica fixed z-[95] min-w-48 overflow-hidden rounded-md py-1 text-[13px]"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={`d${i}`} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            className={cn(
              "flex w-full px-3 py-1.5 text-left hover:bg-fg/8 disabled:opacity-40",
              item.danger && "text-red-300",
            )}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
