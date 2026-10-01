import { canLaunch, getApp, type AppId } from "@/lib/apps";
import { useMe } from "@/lib/furr/client";
import type { WindowPayload } from "@/store/desktop";
import { Accounts } from "@/components/furr/Accounts";
import { Browser } from "@/components/furr/Browser";
import { Evidence } from "@/components/furr/Evidence";
import { FileViewer, Notepad } from "@/components/furr/FileViewer";
import { FurrFS } from "@/components/furr/FurrFS";
import { Presence } from "@/components/furr/Presence";
import { Settings } from "@/components/furr/Settings";
import { TaskManager } from "@/components/furr/TaskManager";
import { Terminal } from "@/components/furr/Terminal";
import { Whitelist } from "@/components/furr/Whitelist";
import { ModLog } from "@/components/furr/ModLog";
import { Empty } from "@/components/furr/ui";

export function AppViews({ appId, windowId, payload }: { appId: AppId; windowId: string; payload?: WindowPayload }) {
  const me = useMe();
  if (!canLaunch(getApp(appId), me.data?.permissions)) {
    return <Empty>{me.isLoading ? "Prüfe Berechtigung…" : "Für diese App fehlt dir die Berechtigung."}</Empty>;
  }
  switch (appId) {
    case "explorer":
      return <FurrFS payload={payload} />;
    case "this-pc":
      return <FurrFS startAtPc />;
    case "terminal":
      return <Terminal windowId={windowId} />;
    case "browser":
      return <Browser payload={payload} />;
    case "evidence":
      return <Evidence />;
    case "presence":
      return <Presence />;
    case "accounts":
      return <Accounts />;
    case "whitelist":
      return <Whitelist />;
    case "modlog":
      return <ModLog />;
    case "settings":
      return <Settings />;
    case "notepad":
      return <Notepad windowId={windowId} />;
    case "viewer":
      return <FileViewer payload={payload} />;
    case "taskmgr":
      return <TaskManager windowId={windowId} />;
    default:
      return null;
  }
}
