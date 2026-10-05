import type { LucideIcon } from "lucide-react";
import {
  Activity,
  LayoutDashboard,
  FileText,
  Folder,
  Globe,
  Monitor,
  Radar,
  Radio,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  StickyNote,
  TerminalSquare,
  UserCircle2,
} from "lucide-react";
import type { Permissions } from "@/lib/furr/roles";

export type AppId =
  | "explorer"
  | "this-pc"
  | "terminal"
  | "settings"
  | "browser"
  | "evidence"
  | "presence"
  | "accounts"
  | "whitelist"
  | "modlog"
  | "worldmap"
  | "notepad"
  | "viewer"
  | "taskmgr"
  | "moddash";

/** Start-menu / catalog groups (Windows-style sections). */
export type AppGroup = "system" | "tools" | "moderation";

export const APP_GROUPS: { id: AppGroup; label: string }[] = [
  { id: "system", label: "System" },
  { id: "tools", label: "Tools" },
  { id: "moderation", label: "Moderation" },
];

export type AppDef = {
  id: AppId;
  name: string;
  subtitle: string;
  icon: LucideIcon;
  group: AppGroup;
  pinned: boolean;
  /** On the desktop until the user changes it (right-click ? Zum Desktop hinzufügen / Vom Desktop entfernen). */
  desktop: boolean;
  /** Hidden from start menu / search (opened by other apps only). */
  hidden?: boolean;
  /** Several windows of this app may be open at once (e.g. one viewer per file). */
  multi?: boolean;
  /** Permission needed to see and launch the app (FurrBox "Admin Edition" tools). */
  requires?: keyof Omit<Permissions, "moderationActions">;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
};

export const APPS: AppDef[] = [
  {
    id: "explorer",
    name: "FurrFS",
    subtitle: "Private und geteilte Dateien",
    icon: Folder,
    group: "system",
    pinned: true,
    desktop: true,
    defaultSize: { w: 900, h: 600 },
    minSize: { w: 520, h: 360 },
  },
  {
    id: "this-pc",
    name: "Dieser PC",
    subtitle: "Privat und Shared Network",
    icon: Monitor,
    group: "system",
    pinned: false,
    desktop: true,
    defaultSize: { w: 900, h: 600 },
    minSize: { w: 520, h: 360 },
  },
  {
    id: "settings",
    name: "Einstellungen",
    subtitle: "System und Personalisierung",
    icon: Settings,
    group: "system",
    pinned: false,
    desktop: false,
    defaultSize: { w: 920, h: 640 },
    minSize: { w: 560, h: 420 },
  },
  {
    id: "taskmgr",
    name: "Tasks",
    subtitle: "Offene Fenster",
    icon: Activity,
    group: "system",
    pinned: false,
    desktop: false,
    defaultSize: { w: 560, h: 420 },
    minSize: { w: 360, h: 260 },
  },
  {
    id: "browser",
    name: "Browser",
    subtitle: "Webseiten öffnen",
    icon: Globe,
    group: "tools",
    pinned: true,
    desktop: false,
    defaultSize: { w: 960, h: 620 },
    minSize: { w: 480, h: 340 },
  },
  {
    id: "terminal",
    name: "Terminal",
    subtitle: "FurrShell für FurrFS",
    icon: TerminalSquare,
    group: "tools",
    pinned: false,
    desktop: false,
    defaultSize: { w: 720, h: 440 },
    minSize: { w: 420, h: 260 },
  },
  {
    id: "notepad",
    name: "Editor",
    subtitle: "Neues Textdokument",
    icon: StickyNote,
    group: "tools",
    pinned: false,
    desktop: false,
    multi: true,
    defaultSize: { w: 640, h: 460 },
    minSize: { w: 360, h: 240 },
  },
  {
    id: "viewer",
    name: "Viewer",
    subtitle: "Datei anzeigen",
    icon: FileText,
    group: "tools",
    pinned: false,
    desktop: false,
    hidden: true,
    multi: true,
    defaultSize: { w: 720, h: 520 },
    minSize: { w: 360, h: 240 },
  },
  {
    id: "evidence",
    name: "Evidence",
    subtitle: "Beweise und Moderation",
    icon: Shield,
    group: "moderation",
    pinned: true,
    desktop: false,
    requires: "canUseEvidence",
    defaultSize: { w: 900, h: 640 },
    minSize: { w: 520, h: 420 },
  },
  {
    id: "presence",
    name: "Presence",
    subtitle: "Team- und Discord-Status",
    icon: Radio,
    group: "moderation",
    pinned: true,
    desktop: false,
    requires: "canViewPresence",
    defaultSize: { w: 1000, h: 640 },
    minSize: { w: 520, h: 400 },
  },
  {
    id: "modlog",
    name: "Modlog",
    subtitle: "Alle Moderationen aus Discord und VRChat",
    icon: ScrollText,
    group: "moderation",
    pinned: false,
    desktop: false,
    requires: "canUseEvidence",
    defaultSize: { w: 1000, h: 640 },
    minSize: { w: 520, h: 400 },
  },
  {
    id: "whitelist",
    name: "Whitelist",
    subtitle: "Wer FurrBox nutzen darf",
    icon: ShieldCheck,
    group: "moderation",
    pinned: false,
    desktop: false,
    requires: "canManageWhitelist",
    defaultSize: { w: 900, h: 600 },
    minSize: { w: 520, h: 400 },
  },
  {
    id: "worldmap",
    name: "Instanzen",
    subtitle: "Wer mit dir in der VRChat-Instanz ist",
    icon: Radar,
    group: "moderation",
    pinned: true,
    desktop: false,
    requires: "canUseEvidence",
    defaultSize: { w: 1080, h: 680 },
    minSize: { w: 520, h: 420 },
  },
  {
    id: "moddash",
    name: "Mod-Dashboard",
    subtitle: "Alerts, Duty, Instanz",
    icon: LayoutDashboard,
    group: "moderation",
    pinned: false,
    desktop: false,
    requires: "canUseEvidence",
    defaultSize: { w: 920, h: 520 },
    minSize: { w: 560, h: 360 },
  },
  {
    id: "accounts",
    name: "Accounts",
    subtitle: "Accounts, Rollen, Discord-IDs",
    icon: UserCircle2,
    group: "moderation",
    pinned: false,
    desktop: false,
    requires: "canManageAccounts",
    defaultSize: { w: 940, h: 620 },
    minSize: { w: 520, h: 400 },
  },
];

export function getApp(id: AppId) {
  return APPS.find((a) => a.id === id)!;
}

/** Apps on the desktop: the user's own choice, otherwise the defaults. */
export function desktopAppIds(saved: AppId[] | null) {
  return saved ?? APPS.filter((a) => a.desktop).map((a) => a.id);
}

export function canLaunch(app: AppDef, permissions: Permissions | null | undefined) {
  if (!app.requires) return true;
  return Boolean(permissions?.[app.requires]);
}

/** Group apps for the Start menu (skips empty groups). */
export function groupApps(apps: AppDef[]) {
  return APP_GROUPS.map((g) => ({
    ...g,
    apps: apps.filter((a) => a.group === g.id),
  })).filter((g) => g.apps.length > 0);
}
