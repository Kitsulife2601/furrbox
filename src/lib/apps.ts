import type { LucideIcon } from "lucide-react";
import {
  Activity,
  FileText,
  Folder,
  Globe,
  Monitor,
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
  | "notepad"
  | "viewer"
  | "taskmgr";

export type AppDef = {
  id: AppId;
  name: string;
  subtitle: string;
  icon: LucideIcon;
  pinned: boolean;
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
    pinned: false,
    desktop: true,
    defaultSize: { w: 900, h: 600 },
    minSize: { w: 520, h: 360 },
  },
  {
    id: "terminal",
    name: "FurrTerminal",
    subtitle: "FurrShell für FurrFS",
    icon: TerminalSquare,
    pinned: true,
    desktop: false,
    defaultSize: { w: 720, h: 440 },
    minSize: { w: 420, h: 260 },
  },
  {
    id: "browser",
    name: "FurrBrowser",
    subtitle: "Webseiten öffnen",
    icon: Globe,
    pinned: true,
    desktop: true,
    defaultSize: { w: 960, h: 620 },
    minSize: { w: 480, h: 340 },
  },
  {
    id: "evidence",
    name: "FurrEvidence",
    subtitle: "Beweise und Moderation",
    icon: Shield,
    pinned: true,
    desktop: true,
    requires: "canUseEvidence",
    defaultSize: { w: 900, h: 640 },
    minSize: { w: 520, h: 420 },
  },
  {
    id: "presence",
    name: "FurrPresence",
    subtitle: "Team- und Discord-Status",
    icon: Radio,
    pinned: true,
    desktop: false,
    requires: "canViewPresence",
    defaultSize: { w: 1000, h: 640 },
    minSize: { w: 520, h: 400 },
  },
  {
    id: "accounts",
    name: "FurrAccountManager",
    subtitle: "Accounts, Rollen, Discord-IDs",
    icon: UserCircle2,
    pinned: true,
    desktop: false,
    requires: "canManageAccounts",
    defaultSize: { w: 940, h: 620 },
    minSize: { w: 520, h: 400 },
  },
  {
    id: "modlog",
    name: "Moderationslog",
    subtitle: "Alle Moderationen aus Discord und VRChat",
    icon: ScrollText,
    pinned: true,
    desktop: true,
    requires: "canUseEvidence",
    defaultSize: { w: 1000, h: 640 },
    minSize: { w: 520, h: 400 },
  },
  {
    id: "whitelist",
    name: "FurrWhitelist",
    subtitle: "Wer FurrBox nutzen darf",
    icon: ShieldCheck,
    pinned: true,
    desktop: true,
    requires: "canManageWhitelist",
    defaultSize: { w: 900, h: 600 },
    minSize: { w: 520, h: 400 },
  },
  {
    id: "settings",
    name: "FurrSettings",
    subtitle: "System und Personalisierung",
    icon: Settings,
    pinned: true,
    desktop: false,
    defaultSize: { w: 780, h: 560 },
    minSize: { w: 420, h: 360 },
  },
  {
    id: "notepad",
    name: "Editor",
    subtitle: "Neues Textdokument",
    icon: StickyNote,
    pinned: false,
    desktop: false,
    multi: true,
    defaultSize: { w: 640, h: 460 },
    minSize: { w: 360, h: 240 },
  },
  {
    id: "viewer",
    name: "FurrFS Viewer",
    subtitle: "Datei anzeigen",
    icon: FileText,
    pinned: false,
    desktop: false,
    hidden: true,
    multi: true,
    defaultSize: { w: 720, h: 520 },
    minSize: { w: 360, h: 240 },
  },
  {
    id: "taskmgr",
    name: "Task-Manager",
    subtitle: "Offene Fenster",
    icon: Activity,
    pinned: false,
    desktop: false,
    defaultSize: { w: 560, h: 420 },
    minSize: { w: 360, h: 260 },
  },
];

export function getApp(id: AppId) {
  return APPS.find((a) => a.id === id)!;
}

export function canLaunch(app: AppDef, permissions: Permissions | null | undefined) {
  if (!app.requires) return true;
  return Boolean(permissions?.[app.requires]);
}
