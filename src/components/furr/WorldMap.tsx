// Weltenkarte: which VRChat world everyone is in. Three sources:
// - team members who share their location from their desktop app (opt-in, seen by the team),
// - your own VRChat friends (read by your desktop app, only ever shown to you),
// - open group instances (Discord bot).
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, ExternalLink, Globe2, Plane, RefreshCw, Search, UserRound, Users } from "lucide-react";
import { listVrchatInstances, type VrchatInstance } from "@/lib/furr/api/vrchat";
import { listTeamLocations, shareVrchatLocation, stopSharingVrchatLocation } from "@/lib/furr/api/worldmap";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { VRC_REGION, VRC_SPECIAL_LOCATION, instanceType, joinUrl, parseLocation } from "@/lib/furr/vrchat-location";
import { cn } from "@/lib/utils";
import { DesktopHint, VrcAvatar, desktopVrchat, unwrap, useMyVrchat } from "./VRChat";
import { Badge, ErrorText, TextInput } from "./ui";

// ---------- Sharing your own location (runs in the background while FurrBox is open) ----------

export const useLocationShare = create<{ on: boolean; setOn: (on: boolean) => void }>()(
  persist((set) => ({ on: false, setOn: (on) => set({ on }) }), { name: "furrbox-vrchat-share" }),
);

/** Mounted on the desktop: sends your VRChat location to the team once a minute while sharing is on. */
export function useVrchatLocationShare() {
  const on = useLocationShare((s) => s.on);
  useEffect(() => {
    const bridge = desktopVrchat();
    if (!on || !bridge?.where) return;
    let stopped = false;
    async function tick() {
      try {
        const me = await unwrap(bridge!.where!());
        if (stopped) return;
        await shareVrchatLocation({
          data: {
            vrchatUserId: me.id,
            vrchatName: me.displayName,
            image: me.image,
            location: me.location,
            worldName: me.worldName,
            worldImage: me.worldImage,
          },
        });
      } catch {
        // Not logged in to VRChat or offline – try again next minute.
      }
    }
    void tick();
    const timer = window.setInterval(tick, 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [on]);
}

// ---------- Map model ----------

type Source = "me" | "team" | "friend";
type Person = { vrchatId: string; name: string; sub: string | null; image: string | null; sources: Source[]; location: string };
type Island = {
  location: string;
  worldName: string;
  worldImage: string | null;
  capacity: number;
  region: string;
  type: ReturnType<typeof instanceType>;
  people: Person[];
  group: VrchatInstance | null;
};
type Filter = "all" | "team" | "friend" | "group";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "team", label: "Team" },
  { id: "friend", label: "Meine Freunde" },
  { id: "group", label: "Gruppe" },
];

const SOURCE_RING: Record<Source, string> = {
  me: "ring-amber-300",
  team: "ring-accent",
  friend: "ring-emerald-400",
};

const isWorld = (location: string) => /^wrld_/.test(location);

function personMatches(p: Person, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "team") return p.sources.includes("team") || p.sources.includes("me");
  if (filter === "friend") return p.sources.includes("friend");
  return false;
}

// ---------- App ----------

export function WorldMap() {
  const queryClient = useQueryClient();
  const me = useMe();
  const bridge = desktopVrchat();
  const mine = useMyVrchat();
  const canReadFriends = Boolean(bridge?.locations && mine.data?.loggedIn);

  const team = useQuery({ queryKey: ["furr", "worldmap", "team"], queryFn: () => listTeamLocations(), refetchInterval: 30_000 });
  const group = useQuery({ queryKey: ["furr", "vrchat", "instances"], queryFn: () => listVrchatInstances(), refetchInterval: 45_000 });
  const friends = useQuery({
    queryKey: ["furr", "worldmap", "friends"],
    queryFn: () => unwrap(desktopVrchat()!.locations!()),
    enabled: canReadFriends,
    refetchInterval: 60_000,
    retry: false,
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const { islands, special, people } = useMemo(() => {
    const byId = new Map<string, Person>();
    const worldInfo = new Map<string, { name: string; image: string | null; capacity: number }>();
    const add = (p: Omit<Person, "sources">, source: Source) => {
      const existing = byId.get(p.vrchatId);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        existing.sub ??= p.sub;
        return;
      }
      byId.set(p.vrchatId, { ...p, sources: [source] });
    };

    const f = friends.data;
    if (f) {
      for (const [id, w] of Object.entries(f.worlds)) worldInfo.set(id, w);
      add({ vrchatId: f.me.id, name: f.me.displayName, sub: "Du", image: f.me.image, location: f.me.location }, "me");
      for (const fr of f.friends) add({ vrchatId: fr.id, name: fr.displayName, sub: null, image: fr.image, location: fr.location }, "friend");
    }
    for (const t of team.data ?? []) {
      const worldId = t.location.split(":")[0];
      if (t.worldName && !worldInfo.has(worldId)) worldInfo.set(worldId, { name: t.worldName, image: t.worldImage, capacity: 0 });
      const isMe = t.userId === me.data?.userId;
      add(
        { vrchatId: t.vrchatUserId, name: t.vrchatName, sub: isMe ? "Du" : t.furrName, image: t.image, location: t.location },
        isMe ? "me" : "team",
      );
    }

    const islandMap = new Map<string, Island>();
    const island = (location: string) => {
      let it = islandMap.get(location);
      if (!it) {
        const { worldId, region } = parseLocation(location);
        const w = worldInfo.get(worldId);
        it = {
          location,
          worldName: w?.name ?? "Unbekannte Welt",
          worldImage: w?.image ?? null,
          capacity: w?.capacity ?? 0,
          region,
          type: instanceType(location),
          people: [],
          group: null,
        };
        islandMap.set(location, it);
      }
      return it;
    };
    for (const g of group.data?.instances ?? []) {
      const it = island(g.location);
      it.group = g;
      it.worldName = g.worldName;
      it.worldImage ??= g.worldImage;
      it.capacity ||= g.capacity;
    }
    const specialMap: Record<string, Person[]> = {};
    const all = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
    for (const p of all) {
      if (isWorld(p.location)) island(p.location).people.push(p);
      else (specialMap[VRC_SPECIAL_LOCATION[p.location] ? p.location : "private"] ??= []).push(p);
    }
    const list = [...islandMap.values()].sort(
      (a, b) => b.people.length - a.people.length || (b.group?.memberCount ?? 0) - (a.group?.memberCount ?? 0),
    );
    return { islands: list, special: specialMap, people: all };
  }, [friends.data, team.data, group.data, me.data?.userId]);

  const q = search.trim().toLowerCase();
  const visiblePeople = (list: Person[]) =>
    list.filter((p) => personMatches(p, filter) && (!q || p.name.toLowerCase().includes(q) || p.sub?.toLowerCase().includes(q)));
  const visibleIslands = islands.filter((i) =>
    filter === "group" ? Boolean(i.group) : visiblePeople(i.people).length > 0 || (filter === "all" && !q && Boolean(i.group)),
  );
  const shownPeople = visiblePeople(people);

  const regions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of islands) counts[i.region] = (counts[i.region] ?? 0) + Math.max(i.people.length, i.group?.memberCount ?? 0);
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [islands]);
  const regionTotal = regions.reduce((s, [, n]) => s + n, 0);

  function focus(location: string) {
    setSelected(location);
    const el = mapRef.current?.querySelector(`[data-loc="${CSS.escape(location)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const refreshing = team.isFetching || group.isFetching || friends.isFetching;

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-elevated/40 px-4 py-3">
        <Compass className="size-5 text-accent" />
        <div className="mr-auto min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">Weltenkarte</h2>
          <p className="text-[11px] text-muted">
            {visibleIslands.length} {visibleIslands.length === 1 ? "Welt" : "Welten"} · {shownPeople.length}{" "}
            {shownPeople.length === 1 ? "Person" : "Personen"} sichtbar
          </p>
        </div>
        <div className="flex rounded-lg bg-bg/60 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px]",
                filter === f.id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-44">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person suchen" className="h-8 pl-8 text-[12px]" />
        </div>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["furr", "worldmap"] })}
          className="rounded-md p-1.5 text-muted hover:bg-fg/8 hover:text-fg"
          aria-label="Aktualisieren"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 @3xl:grid-cols-[1fr_280px]">
        <div ref={mapRef} className="min-h-0 overflow-auto p-4">
          <SharePanel loggedIn={Boolean(mine.data?.loggedIn)} />
          {friends.isError && <ErrorText>{errorMessage(friends.error)}</ErrorText>}

          {regionTotal > 0 && (
            <div className="mb-4 grid gap-1.5">
              <div className="flex h-2 overflow-hidden rounded-full bg-fg/8">
                {regions.map(([r, n], idx) => (
                  <div
                    key={r}
                    className={cn("h-full", ["bg-accent", "bg-violet-400", "bg-emerald-400", "bg-amber-300"][idx % 4])}
                    style={{ width: `${(n / regionTotal) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                {regions.map(([r, n], idx) => (
                  <span key={r} className="flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", ["bg-accent", "bg-violet-400", "bg-emerald-400", "bg-amber-300"][idx % 4])} />
                    {VRC_REGION[r] ?? r.toUpperCase()} · {n}
                  </span>
                ))}
              </div>
            </div>
          )}

          {visibleIslands.length === 0 ? (
            <div className="grid place-items-center gap-1 rounded-xl border border-dashed border-border py-14 text-center">
              <Globe2 className="size-8 text-subtle" />
              <p className="text-[13px] font-medium">Hier ist gerade niemand zu sehen</p>
              <p className="max-w-sm text-[12px] text-muted">
                Sobald jemand aus dem Team seinen Standort teilt, deine Freunde in einer Welt sind oder eine Gruppen-Instanz offen ist,
                erscheint sie hier.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 @xl:grid-cols-2 @6xl:grid-cols-3">
              {visibleIslands.map((i) => (
                <IslandCard
                  key={i.location}
                  island={i}
                  people={visiblePeople(i.people)}
                  selected={selected === i.location}
                  onSelect={() => setSelected(i.location)}
                />
              ))}
            </div>
          )}

          {filter !== "group" && (
            <div className="mt-4 grid gap-2 @xl:grid-cols-3">
              {Object.entries(VRC_SPECIAL_LOCATION).map(([key, label]) => {
                const list = visiblePeople(special[key] ?? []);
                if (!list.length) return null;
                return (
                  <div key={key} className="rounded-xl border border-border bg-elevated/30 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted">
                      {key === "traveling" ? <Plane className="size-3.5" /> : <UserRound className="size-3.5" />} {label} · {list.length}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((p) => (
                        <PersonDot key={p.vrchatId} person={p} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="hidden min-h-0 overflow-auto border-l border-border bg-elevated/20 p-3 @3xl:block">
          <PeopleList title="Team" people={shownPeople.filter((p) => p.sources.some((s) => s !== "friend"))} onFocus={focus} islands={islands} />
          <PeopleList
            title="Meine Freunde"
            hint={!bridge?.locations ? "Nur in der Desktop-App" : !mine.data?.loggedIn ? "VRChat-Anmeldung nötig" : "nur für dich sichtbar"}
            people={shownPeople.filter((p) => p.sources.length === 1 && p.sources[0] === "friend")}
            onFocus={focus}
            islands={islands}
          />
        </aside>
      </div>
    </div>
  );
}

function SharePanel({ loggedIn }: { loggedIn: boolean }) {
  const { on, setOn } = useLocationShare();
  const queryClient = useQueryClient();
  const bridge = desktopVrchat();
  if (!bridge?.where) {
    return (
      <div className="mb-4">
        <DesktopHint what="Die Weltenkarte mit deinen Freunden und deinem Standort" version="2.0.9" />
      </div>
    );
  }
  if (!loggedIn) {
    return (
      <p className="mb-4 rounded-lg border border-border bg-elevated/40 p-3 text-[12px] text-muted">
        Melde dich unter FurrEvidence → VRChat → „Dein VRChat-Konto“ an. Dann siehst du hier, wo deine VRChat-Freunde sind, und
        kannst deinen Standort mit dem Team teilen.
      </p>
    );
  }
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-elevated/40 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">Meinen Standort mit dem Team teilen</p>
        <p className="text-[11px] text-muted">
          {on
            ? "Das Team sieht, in welcher Welt du bist – solange FurrBox läuft, jede Minute aktualisiert."
            : "Aus: Niemand im Team sieht, wo du bist. Deine Freunde siehst nur du."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Standort teilen"
        onClick={async () => {
          setOn(!on);
          if (on) await stopSharingVrchatLocation().catch(() => undefined);
          window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["furr", "worldmap", "team"] }), 1500);
        }}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-fg/20")}
      >
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}

function IslandCard({
  island: i,
  people,
  selected,
  onSelect,
}: {
  island: Island;
  people: Person[];
  selected: boolean;
  onSelect: () => void;
}) {
  const count = Math.max(people.length, i.group?.memberCount ?? 0);
  const shown = people.slice(0, 10);
  return (
    <article
      data-loc={i.location}
      onClick={onSelect}
      className={cn(
        "relative cursor-pointer overflow-hidden rounded-xl border bg-elevated/40 transition-shadow",
        selected ? "border-accent shadow-[0_0_0_2px_var(--color-accent)]" : "border-border hover:border-fg/25",
      )}
    >
      <div className="relative h-28">
        {i.worldImage ? (
          <img src={i.worldImage} alt="" className="absolute inset-0 size-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-accent/30 via-elevated to-violet-500/25" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <Badge tone="accent">{VRC_REGION[i.region] ?? i.region.toUpperCase()}</Badge>
          <Badge>{i.type.label}</Badge>
          {i.group && <Badge tone="good">Gruppen-Instanz</Badge>}
        </div>
        <div className="absolute bottom-2 left-3 right-3 flex items-end gap-2">
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={i.worldName}>
            {i.worldName}
          </p>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[12px] font-medium tabular-nums">
            <Users className="size-3.5" />
            <span>
              {count}
              {i.capacity ? <span className="text-muted"> / {i.capacity}</span> : null}
            </span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 p-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {shown.length ? (
            shown.map((p) => <PersonDot key={p.vrchatId} person={p} />)
          ) : (
            <span className="text-[12px] text-muted">
              {i.group ? `${i.group.memberCount} in der Gruppen-Instanz · offen seit ${timeAgo(i.group.openedAt).replace("vor ", "")}` : ""}
            </span>
          )}
          {people.length > shown.length && (
            <span className="grid size-8 place-items-center rounded-full bg-fg/10 text-[11px] text-muted">+{people.length - shown.length}</span>
          )}
        </div>
        {i.type.joinable && (
          <a
            href={i.group?.joinUrl ?? joinUrl(i.location)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center gap-1 rounded-md bg-elevated px-2 py-1 text-[11px] hover:bg-fg/10"
            title="Instanz auf vrchat.com öffnen (dort „Launch“)"
          >
            <ExternalLink className="size-3" /> Beitreten
          </a>
        )}
      </div>
    </article>
  );
}

function PersonDot({ person: p }: { person: Person }) {
  const source = p.sources.includes("me") ? "me" : p.sources.includes("team") ? "team" : "friend";
  return (
    <span title={p.sub && p.sub !== "Du" ? `${p.name} (${p.sub})` : p.name} className={cn("rounded-full ring-2 ring-offset-1 ring-offset-surface", SOURCE_RING[source])}>
      <VrcAvatar user={{ displayName: p.name, image: p.image }} small />
    </span>
  );
}

function PeopleList({
  title,
  hint,
  people,
  islands,
  onFocus,
}: {
  title: string;
  hint?: string;
  people: Person[];
  islands: Island[];
  onFocus: (location: string) => void;
}) {
  const worldName = (location: string) =>
    isWorld(location)
      ? (islands.find((i) => i.location === location)?.worldName ?? "Unbekannte Welt")
      : (VRC_SPECIAL_LOCATION[location] ?? VRC_SPECIAL_LOCATION.private);
  return (
    <section className="mb-4">
      <p className="mb-1.5 flex items-baseline gap-2 px-1 text-[12px] font-semibold">
        {title} <span className="font-normal text-subtle">{people.length}</span>
        {hint && <span className="ml-auto text-[10px] font-normal text-subtle">{hint}</span>}
      </p>
      {people.length === 0 ? (
        <p className="px-1 text-[11px] text-subtle">Niemand online.</p>
      ) : (
        <div className="grid gap-0.5">
          {people.map((p) => (
            <button
              key={p.vrchatId}
              type="button"
              disabled={!isWorld(p.location)}
              onClick={() => onFocus(p.location)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left enabled:hover:bg-fg/8"
            >
              <PersonDot person={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">
                  {p.name}
                  {p.sub && <span className="font-normal text-subtle"> · {p.sub}</span>}
                </span>
                <span className="block truncate text-[11px] text-muted">{worldName(p.location)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
