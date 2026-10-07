import { getApp } from "@/lib/apps";
import { useDesktop } from "@/store/desktop";
import { useSync } from "./useFurrSync";
import { Btn, Empty } from "./ui";

export function TaskManager({ windowId }: { windowId: string }) {
  const windows = useDesktop((s) => s.windows);
  const closeWindow = useDesktop((s) => s.closeWindow);
  const focusWindow = useDesktop((s) => s.focusWindow);
  const restoreWindow = useDesktop((s) => s.restoreWindow);
  const sync = useSync();
  const others = windows.filter((w) => w.id !== windowId);

  return (
    <div className="flex h-full flex-col bg-bg/40">
      <div className="border-b border-border px-3 py-2 text-[12px] text-muted">
        Sync: {sync.connected ? "verbunden" : "getrennt"}
        {sync.lastSyncAt ? ` · letzter Heartbeat ${new Date(sync.lastSyncAt).toLocaleTimeString("de-DE")}` : ""}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!others.length ? (
          <Empty>Keine weiteren Fenster geöffnet.</Empty>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">App</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {others.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {w.title} <span className="text-muted">({getApp(w.appId).name})</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{w.minimized ? "Minimiert" : w.maximized ? "Maximiert" : "Aktiv"}</td>
                  <td className="flex justify-end gap-1 px-3 py-2">
                    <Btn variant="ghost" onClick={() => (w.minimized ? restoreWindow(w.id) : focusWindow(w.id))}>
                      Wechseln
                    </Btn>
                    <Btn variant="ghost" onClick={() => closeWindow(w.id)}>
                      Task beenden
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
