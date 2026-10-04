// Permanent status in the VRChat chatbox: hands the settings (FurrSettings → FurrBox VR) to the
// desktop app, which writes the text into the chatbox every few seconds via OSC.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listVrchatInstances } from "@/lib/furr/api/vrchat";
import { useVrSettings, type VrInfoId } from "@/store/vr";

type StatusBridge = { status?(config: { enabled: boolean; items: VrInfoId[]; text: string; opened: Record<string, string> }): Promise<boolean> };

export function chatboxStatusBridge() {
  if (typeof window === "undefined") return null;
  const osc = (window as { furrbox?: { osc?: StatusBridge } }).furrbox?.osc;
  return osc?.status ? osc : null;
}

export function useChatboxStatus() {
  const status = useVrSettings((s) => s.status);
  const bridge = chatboxStatusBridge();
  // Since when the instances of our group are open (for "Instanz offen: …").
  const group = useQuery({
    queryKey: ["furr", "vrchat", "instances"],
    queryFn: () => listVrchatInstances(),
    enabled: Boolean(bridge) && status.enabled && status.items.includes("instanceAge"),
    refetchInterval: 60_000,
    retry: false,
  });
  const opened = JSON.stringify(Object.fromEntries((group.data?.instances ?? []).map((i) => [i.location, i.openedAt])));

  useEffect(() => {
    void bridge?.status?.({ ...status, opened: JSON.parse(opened) as Record<string, string> });
  }, [bridge, status, opened]);
}
