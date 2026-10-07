// Instanz-Tracker: who is in the VRChat instance you are in right now. The desktop app reads the
// VRChat log on this PC (joins / leaves with time) and, with your VRChat login, adds pictures and –
// for your friends – where people went after leaving. VRChat does not reveal positions inside a world.
import { useMemo, useState } from "react";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Clock, Copy, ExternalLink, Eye, Globe2, LogIn, LogOut, Map as MapIcon, Radar, Search, Users } from "lucide-react";
import { getVrchatStatus } from "@/lib/furr/api/vrchat";
import { addToWatchlist, listWatchlist } from "@/lib/furr/api/watchlist";
import { errorMessage } from "@/lib/furr/client";
import { VRC_REGION, VRC_SPECIAL_LOCATION, instanceType, joinUrl, parseLocation } from "@/lib/furr/vrchat-location";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/store/notifications";
import { DesktopHint, VrcAvatar, desktopVrchat, unwrap, useMyVrchat, type VrcInstanceState, type VrcLogPlayer, type VrcPersonInfo } from "./VRChat";
import { Badge, ErrorText, TextInput } from "./ui";

function clock(at: string | null) {
  return at ? new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–";
}

function duration(from: string | null, to: string | number = Date.now()) {
  if (!from) return null;
  const min = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (min < 1) return "gerade eben";
  if (min < 60) return `${min} Min.`;
  return `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

export function InstanceTracker() {
  const liveMap = useLiveInterval(2_000);
  const live60 = useLiveInterval(60_000);
  const bridge = desktopVrchat();
  const mine = useMyVrchat();
  const loggedIn = Boolean(mine.data?.loggedIn);
  const [search, setSearch] = useState("");

  const inst = useQuery({
    queryKey: ["furr", "tracker", "instance"],
    queryFn: () => unwrap(desktopVrchat()!.instance!()),
    enabled: Boolean(bridge?.instance),
    // Faster while the world sends live positions; stop when tab hidden.
    refetchInterval: (query) => {
      if (liveMap === false) return false;
      return query.state.data?.map ? 2_000 : 4_000;
    },
  });
  const s = inst.data;
  const worldId = s?.location ? parseLocation(s.location).worldId : null;

  const world = useQuery({
    queryKey: ["furr", "tracker", "world", worldId],
    queryFn: () => unwrap(desktopVrchat()!.world!(worldId!)),
    enabled: Boolean(worldId && loggedIn && bridge?.world),
    staleTime: 60 * 60_000,
  });

  const ids = useMemo(
    () => [...new Set([...(s?.players ?? []), ...(s?.left ?? [])].map((p) => p.id).filter((id): id is string => Boolean(id)))].sort(),
    [s],
  );
  const people = useQuery({
    queryKey: ["furr", "tracker", "people", ids.join(",")],
    queryFn: () => unwrap(desktopVrchat()!.people!(ids)),
    enabled: Boolean(ids.length && loggedIn && bridge?.people),
    refetchInterval: live60,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const group = useQuery({ queryKey: ["furr", "vrchat", "status"], queryFn: () => getVrchatStatus(), staleTime: 60_000 });

  if (!bridge?.instance) {
    return (
      <div className="mx-auto grid max-w-xl gap-3 p-6">
        <Intro />
        <DesktopHint what="Der Instanz-Tracker" version="2.0.9" />
      </div>
    );
  }
  if (inst.isError) return <div className="p-6"><ErrorText>{errorMessage(inst.error)}</ErrorText></div>;
  if (!s) return <p className="p-6 text-[13px] text-muted">Lese das VRChat-Protokoll…</p>;

  if (!s.inInstance) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="grid max-w-md justify-items-center gap-2 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-accent/15 text-accent">
            <Radar className="size-8" />
          </span>
          <p className="text-[15px] font-semibold">
            {!s.logFound ? "VRChat wurde auf diesem PC noch nicht gefunden" : s.vrchatClosed ? "VRChat ist geschlossen" : "Du bist gerade in keiner Instanz"}
          </p>
          <p className="text-[12px] text-muted">
            Starte VRChat und betritt eine Welt – sobald du in einer Instanz bist, siehst du hier, wer drin ist, wer kommt und wer geht.
          </p>
          {s.left.length > 0 && <p className="text-[11px] text-subtle">Zuletzt: {s.worldName}</p>}
        </div>
      </div>
    );
  }

  const info = people.data ?? {};
  const q = search.trim().toLowerCase();
  const match = (p: { name: string }) => !q || p.name.toLowerCase().includes(q);
  const players = s.players.filter(match).sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""));
  const left = s.left.filter(match);
  const type = instanceType(s.location!);
  const { region } = parseLocation(s.location!);
  const isGroup = Boolean(group.data?.groupId && s.location!.includes(group.data.groupId));
  const capacity = world.data?.capacity ?? 0;

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <header className="relative shrink-0 overflow-hidden border-b border-border">
        {world.data?.image ? (
          <img src={world.data.image} alt="" className="absolute inset-0 size-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-r from-accent/25 via-elevated to-violet-500/20" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/75 to-surface/20" />
        <div className="relative flex flex-wrap items-end gap-3 p-4 pt-12">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap gap-1">
              <Badge tone="accent">{VRC_REGION[region] ?? region.toUpperCase()}</Badge>
              <Badge>{type.label}</Badge>
              {isGroup && <Badge tone="good">{group.data?.group?.name ?? "Unsere Gruppe"}</Badge>}
            </div>
            <p className="truncate text-[19px] font-bold leading-tight" title={s.worldName ?? ""}>
              {s.worldName ?? world.data?.name ?? "Unbekannte Welt"}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
              <span className="flex items-center gap-1">
                <Users className="size-3.5" /> {s.players.length}
                {capacity ? ` / ${capacity}` : ""} in der Instanz
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" /> du bist seit {clock(s.joinedAt)} hier ({duration(s.joinedAt)})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> live
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-44">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
              <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person suchen" className="h-8 pl-8 text-[12px]" />
            </div>
            {type.joinable && (
              <a
                href={joinUrl(s.location!)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-md bg-elevated px-2.5 py-1.5 text-[12px] hover:bg-fg/10"
                title="Instanz-Link auf vrchat.com (zum Teilen)"
              >
                <ExternalLink className="size-3.5" /> Instanz-Link
              </a>
            )}
          </div>
        </div>
      </header>

      {!loggedIn && (
        <p className="mx-4 mt-3 rounded-lg border border-border bg-elevated/40 p-2.5 text-[12px] text-muted">
          Tipp: Mit deinem VRChat-Konto (FurrEvidence → VRChat → „Dein VRChat-Konto“) siehst du auch Profilbilder und wohin
          deine Freunde gehen.
        </p>
      )}
      {people.isError && <div className="mx-4 mt-3"><ErrorText>{errorMessage(people.error)}</ErrorText></div>}

      <div className="grid min-h-0 flex-1 @3xl:grid-cols-[1fr_300px]">
        <section className="min-h-0 overflow-auto p-4">
          {s.map ? (
            <LiveMap state={s} info={info} myId={mine.data?.userId ?? null} />
          ) : (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-dashed border-border p-2.5 text-[12px] text-muted">
              <MapIcon className="mt-0.5 size-4 shrink-0 text-subtle" />
              <span>
                Diese Welt hat keine FurrBox-Karte. VRChat verrät die Positionen von Spielern nur, wenn die Welt sie selbst meldet –{" "}
                <a
                  href="https://github.com/Kitsulife2601/furrbox/blob/main/vrchat-world/ANLEITUNG.md"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  so baut man die Karte in eine Welt ein
                </a>
                .
              </span>
            </p>
          )}
          <h3 className="mb-2 text-[12px] font-semibold text-muted">Jetzt in der Instanz · {players.length}</h3>
          {players.length === 0 ? (
            <p className="text-[12px] text-subtle">{q ? "Niemand gefunden." : "Noch niemand erfasst."}</p>
          ) : (
            <div className="grid gap-2 @lg:grid-cols-2 @5xl:grid-cols-3">
              {players.map((p) => (
                <PersonCard key={p.id ?? p.name} player={p} info={p.id ? info[p.id] : undefined} isMe={p.id === mine.data?.userId} />
              ))}
            </div>
          )}

          <h3 className="mb-2 mt-5 text-[12px] font-semibold text-muted">Gegangen · {left.length}</h3>
          {left.length === 0 ? (
            <p className="text-[12px] text-subtle">Seit du hier bist, ist noch niemand gegangen.</p>
          ) : (
            <div className="grid gap-1">
              {left.map((p) => (
                <LeftRow key={`${p.id ?? p.name}-${p.leftAt}`} player={p} info={p.id ? info[p.id] : undefined} loggedIn={loggedIn} />
              ))}
            </div>
          )}
        </section>

        <aside className="hidden min-h-0 overflow-auto border-l border-border bg-elevated/20 p-3 @3xl:block">
          <h3 className="mb-2 px-1 text-[12px] font-semibold text-muted">Verlauf</h3>
          <div className="grid gap-0.5">
            {s.events.filter(match).map((e, idx) => (
              <div key={`${e.at}-${idx}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px]">
                {e.kind === "join" ? <LogIn className="size-3.5 shrink-0 text-emerald-400" /> : <LogOut className="size-3.5 shrink-0 text-amber-300" />}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-muted"> {e.kind === "join" ? "ist gekommen" : "ist gegangen"}</span>
                </span>
                <span className="shrink-0 tabular-nums text-subtle">{clock(e.at)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Intro() {
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <Radar className="size-5 text-accent" /> Instanz-Tracker
      </p>
      <p className="text-[12px] text-muted">
        Zeigt live, wer mit dir in der VRChat-Instanz ist, wann jemand kommt oder geht – und bei deinen Freunden, wohin sie danach
        gegangen sind.
      </p>
    </div>
  );
}

function copyId(id: string) {
  void navigator.clipboard.writeText(id).then(() =>
    useNotifications.getState().notify({ version: "Instanz-Tracker", title: "Kopiert", description: id }),
  );
}

function PersonCard({ player: p, info, isMe }: { player: VrcLogPlayer; info?: VrcPersonInfo; isMe: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border bg-elevated/40 p-2.5", isMe ? "border-amber-300/50" : "border-border")}>
      <VrcAvatar user={{ displayName: p.name, image: info?.image ?? null }} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
          <span className="truncate">{p.name}</span>
          {isMe && <Badge tone="warn">Du</Badge>}
          {!isMe && info?.friend && <Badge tone="good">Freund</Badge>}
        </p>
        <p className="text-[11px] text-muted">
          seit {clock(p.joinedAt)} · {duration(p.joinedAt)}
        </p>
      </div>
      {p.id && <PersonActions id={p.id} name={p.name} />}
    </div>
  );
}

/** Puts someone on the team watchlist (the note is added in FurrEvidence → Watchlist). */
async function watch(id: string, name?: string) {
  const notify = useNotifications.getState().notify;
  try {
    // Saving again would replace the existing note with an empty one – so look first.
    const existing = (await listWatchlist()).find((e) => e.usrId.toLowerCase() === id.toLowerCase());
    if (existing) {
      notify({ version: "Watchlist", title: "Steht schon auf der Watchlist", description: existing.note || (name ?? id) });
      return;
    }
    await addToWatchlist({ data: { usrId: id, displayName: name, note: "" } });
    notify({ version: "Watchlist", title: "Auf der Watchlist", description: `${name ?? id} – Notiz dazu in FurrEvidence → Watchlist.` });
  } catch (e) {
    notify({ version: "Watchlist", title: "Nicht eingetragen", description: errorMessage(e) });
  }
}

function PersonActions({ id, name }: { id: string; name?: string }) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <button type="button" onClick={() => void watch(id, name)} className="rounded p-1.5 text-muted hover:bg-fg/8 hover:text-fg" title="Auf die Watchlist setzen">
        <Eye className="size-3.5" />
      </button>
      <button type="button" onClick={() => copyId(id)} className="rounded p-1.5 text-muted hover:bg-fg/8 hover:text-fg" title="VRChat-ID kopieren">
        <Copy className="size-3.5" />
      </button>
      <a
        href={`https://vrchat.com/home/user/${id}`}
        target="_blank"
        rel="noreferrer"
        className="rounded p-1.5 text-muted hover:bg-fg/8 hover:text-fg"
        title="Profil auf vrchat.com"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function LeftRow({ player: p, info, loggedIn }: { player: VrcLogPlayer & { leftAt: string }; info?: VrcPersonInfo; loggedIn: boolean }) {
  const now = !info?.friend
    ? loggedIn
      ? "Wohin? Nur bei Freunden sichtbar"
      : null
    : info.worldName
      ? `jetzt in: ${info.worldName}`
      : `jetzt: ${VRC_SPECIAL_LOCATION[info.location ?? ""] ?? (info.location ? "Private Welt" : "offline")}`;
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-fg/5">
      <VrcAvatar user={{ displayName: p.name, image: info?.image ?? null }} small />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">
          {p.name}
          <span className="font-normal text-subtle">
            {" "}
            · gegangen {clock(p.leftAt)}
            {p.joinedAt ? ` · war ${duration(p.joinedAt, p.leftAt)} da` : ""}
          </span>
        </p>
        {now && (
          <p className={cn("flex items-center gap-1 truncate text-[11px]", info?.worldName ? "text-accent" : "text-subtle")}>
            {info?.worldName && <Globe2 className="size-3" />} {now}
          </p>
        )}
      </div>
      {p.id && <PersonActions id={p.id} name={p.name} />}
    </div>
  );
}

type MapState = NonNullable<VrcInstanceState["map"]>;

/** Map area: the corners set in the world, otherwise everyone seen so far plus some margin. */
function mapBounds(map: MapState) {
  if (map.bounds) return map.bounds;
  const xs = map.players.map((p) => p.x);
  const zs = map.players.map((p) => p.z);
  const pad = (lo: number, hi: number) => {
    const mid = (lo + hi) / 2;
    const half = Math.max(10, (hi - lo) / 2 + 5);
    return [mid - half, mid + half];
  };
  const [minX, maxX] = pad(Math.min(...xs, 0), Math.max(...xs, 0));
  const [minZ, maxZ] = pad(Math.min(...zs, 0), Math.max(...zs, 0));
  return { minX, minZ, maxX, maxZ };
}

function LiveMap({ state: s, info, myId }: { state: VrcInstanceState; info: Record<string, VrcPersonInfo>; myId: string | null }) {
  const map = s.map!;
  const b = mapBounds(map);
  const w = b.maxX - b.minX;
  const h = b.maxZ - b.minZ;
  const stale = Date.now() - new Date(map.at).getTime() > 15_000;
  const byName = new Map(s.players.map((p) => [p.name, p]));
  return (
    <div className="mb-5">
      <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-muted">
        <MapIcon className="size-3.5" /> Live-Karte · {map.players.length}
        {stale ? (
          <span className="font-normal text-amber-300">wartet auf neue Positionen…</span>
        ) : (
          <span className="flex items-center gap-1 font-normal text-subtle">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> alle 2 Sek.
          </span>
        )}
      </h3>
      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl border border-border bg-bg/70"
        style={{ aspectRatio: `${w} / ${h}`, maxWidth: `${Math.round((440 * w) / h)}px` }}
      >
        {map.image ? (
          <img src={map.image} alt="" className="absolute inset-0 size-full object-fill" referrerPolicy="no-referrer" />
        ) : (
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.06) 1px, transparent 1px)",
              backgroundSize: `${(500 / w).toFixed(3)}% ${(500 / h).toFixed(3)}%`,
            }}
          />
        )}
        {map.players.map((p) => {
          const player = p.name ? byName.get(p.name) : undefined;
          const id = player?.id ?? null;
          const name = p.name ?? player?.name ?? `Spieler ${p.playerId}`;
          const isMe = Boolean(id && id === myId);
          const left = Math.min(100, Math.max(0, ((p.x - b.minX) / w) * 100));
          const top = Math.min(100, Math.max(0, ((b.maxZ - p.z) / h) * 100));
          return (
            <div
              key={p.playerId}
              className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-[1900ms] ease-linear hover:z-20"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <span className="absolute inset-0 -m-2 transition-transform duration-500" style={{ transform: `rotate(${p.r}deg)` }}>
                <span className={cn("absolute left-1/2 top-0 -translate-x-1/2 border-x-[5px] border-b-[7px] border-x-transparent", isMe ? "border-b-amber-300" : "border-b-accent")} />
              </span>
              <span className={cn("block rounded-full ring-2 ring-offset-1 ring-offset-black/40", isMe ? "ring-amber-300" : id && info[id]?.friend ? "ring-emerald-400" : "ring-accent")}>
                <VrcAvatar user={{ displayName: name, image: id ? (info[id]?.image ?? null) : null }} small />
              </span>
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block">
                {name}
                {isMe ? " (du)" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
