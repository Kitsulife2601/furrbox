"use client";

import { SendHorizonal, Terminal } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

export function TerminalWindow({ windowState }: { windowState: FurrWindowState }) {
  const { terminal, socket } = useFurrBoxStore();
  const [command, setCommand] = useState("");
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [terminal]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    socket?.emit("terminal:input", `${command}\r`);
    setCommand("");
  }

  return (
    <FurrWindow windowState={windowState} icon={<Terminal size={15} />}>
      <div className="flex h-full flex-col bg-slate-950/92 text-slate-100">
        <div ref={outputRef} className="scroll-soft flex-1 overflow-auto p-4 font-mono text-[12px] leading-5">
          {terminal.map((chunk, index) => (
            <span key={`${index}-${chunk.slice(0, 8)}`} className="whitespace-pre-wrap">
              {chunk}
            </span>
          ))}
        </div>
        <form onSubmit={submit} className="flex h-12 items-center gap-2 border-t border-white/10 px-3">
          <span className="font-mono text-[12px] text-emerald-300">furrbox$</span>
          <input
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-white outline-none"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Type a shared terminal command"
          />
          <button className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20" aria-label="Send command">
            <SendHorizonal size={15} />
          </button>
        </form>
      </div>
    </FurrWindow>
  );
}
