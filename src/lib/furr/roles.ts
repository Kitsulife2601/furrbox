// Role model ported from FurrBox (Discord privileges + account roles).

export const ROLES = ["member", "supporter", "moderator", "owner", "dev"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  dev: "Dev",
  owner: "Fish Nagie Owner",
  moderator: "Fish Moderator",
  supporter: "Supporter",
  member: "Member",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleRank(role: Role) {
  return ROLES.indexOf(role);
}

/** Highest of the account role and the privilege synced from Discord. */
export function effectiveRole(accountRole: string | null | undefined, discordPrivilege?: string | null): Role {
  const a = isRole(accountRole) ? accountRole : "member";
  const d = isRole(discordPrivilege) ? discordPrivilege : "member";
  return roleRank(a) >= roleRank(d) ? a : d;
}

export type Permissions = {
  isTeam: boolean;
  canViewPresence: boolean;
  canUseEvidence: boolean;
  canManageAccounts: boolean;
  canConfigureChat: boolean;
  /** Add / remove people on the whitelist (Supporter and up). */
  canManageWhitelist: boolean;
  /** Switch the whole whitelist on or off (Owner and Dev). */
  canToggleWhitelist: boolean;
  moderationActions: ModerationAction[];
};

export const MODERATION_ACTIONS = ["warn", "timeout", "mute", "ban"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export function permissionsFor(role: Role): Permissions {
  const rank = roleRank(role);
  const isTeam = rank >= roleRank("supporter");
  return {
    isTeam,
    canViewPresence: isTeam,
    canUseEvidence: isTeam,
    canManageAccounts: role === "dev",
    canConfigureChat: role === "dev",
    canManageWhitelist: isTeam,
    canToggleWhitelist: rank >= roleRank("owner"),
    moderationActions:
      rank >= roleRank("moderator") ? [...MODERATION_ACTIONS] : isTeam ? ["warn", "timeout"] : [],
  };
}
