// VRChat location strings, e.g. "wrld_x:12345~group(grp_y)~groupAccessType(plus)~region(eu)".

export const VRC_REGION: Record<string, string> = { us: "USA West", use: "USA Ost", eu: "Europa", jp: "Japan" };
export const VRC_ACCESS: Record<string, string> = { public: "Gruppe öffentlich", plus: "Gruppe+", members: "Nur Gruppe" };

export function parseLocation(location: string) {
  const region = /~region\(([^)]+)\)/.exec(location)?.[1] ?? "us";
  const access = /~groupAccessType\(([^)]+)\)/.exec(location)?.[1] ?? "members";
  const [worldId, rest = ""] = location.split(":");
  return { worldId, instanceName: rest.split("~")[0] ?? "", region, access };
}
