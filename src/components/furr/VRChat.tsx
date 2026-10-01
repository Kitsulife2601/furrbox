// FurrEvidence → VRChat: group link (owner), open group instances, group moderation.
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ExternalLink,
  Gavel,
  Globe2,
  KeyRound,
  Link2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import {
  disconnectVrchat,
  getVrchatJob,
  getVrchatStatus,
  listVrchatInstances,
  checkVrchatMembership,
  listVrchatModeration,
  logVrchatModeration,
  setVrchatGroup,
  vrchatLogin,
  vrchatVerify2fa,
  type VrchatInstance,
  type VrchatStatus,
} from "@/lib/furr/api/vrchat";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { updateBridge } from "@/components/desktop/UpdatePopup";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/store/notifications";
import { Badge, Btn, Empty, ErrorText, Field, TextInput } from "./ui";

const STATUS_KEY = ["furr", "vrchat", "status"];
const MY_KEY = ["furr", "vrchat", "mine"];

// ---------- Personal VRChat login (desktop app only, runs on this PC) ----------

type MyStatus = {
  loggedIn: boolean;
  displayName: string | null;
  userId: string | null;
  needs: "totp" | "emailOtp" | null;
};
type VrcUser = { id: string; displayName: string; image: string | null };
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type DesktopVrchat = {
  status(): Promise<Result<MyStatus>>;
  login(username: string, password: string): Promise<Result<MyStatus>>;
  verify(code: string): Promise<Result<MyStatus>>;
  cancel(): Promise<Result<MyStatus>>;
  logout(): Promise<Result<MyStatus>>;
  search(query: string): Promise<Result<VrcUser[]>>;
  moderate(action: string, groupId: string, userId: string): Promise<Result<{ ok: boolean }>>;
};

function desktopVrchat(): DesktopVrchat | null {
  if (typeof window === "undefined") return null;
  return (window as { furrbox?: { vrchat?: DesktopVrchat } }).furrbox?.vrchat ?? null;
}

/** Running inside the FurrBox desktop app (any version)? */
function inDesktopApp() {
  return typeof window !== "undefined" && Boolean((window as { furrbox?: unknown }).furrbox);
}

/** Shown when the desktop app is too old for the personal VRChat login. */
function DesktopHint({ what }: { what: string }) {
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");
  if (!inDesktopApp()) {
    return <p className="text-[12px] text-muted">{what} gibt es nur in der FurrBox-Desktop-App – VRChat erlaubt das nur vom eigenen PC.</p>;
  }
  return (
    <div className="grid gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-[12px]">
      <p className="font-medium">FurrBox-Update nötig</p>
      <p className="text-muted">
        {what} braucht die Desktop-Version 2.0.8 oder neuer. Lade das Update – danach unten rechts auf das Update-Symbol klicken.
      </p>
      <Btn
        variant="primary"
        disabled={state !== "idle"}
        onClick={async () => {
          setState("checking");
          await updateBridge()?.check().catch(() => undefined);
          setState("done");
        }}
      >
        {state === "checking" ? "Suche Update…" : state === "done" ? "Update wird geladen – Symbol unten rechts beachten" : "Jetzt nach Update suchen"}
      </Btn>
    </div>
  );
}

async function unwrap<T>(p: Promise<Result<T>> | undefined): Promise<T> {
  if (!p) throw new Error("Die eigene VRChat-Anmeldung gibt es nur in der FurrBox-Desktop-App.");
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function useMyVrchat() {
  return useQuery({
    queryKey: MY_KEY,
    queryFn: () => unwrap(desktopVrchat()?.status()),
    enabled: Boolean(desktopVrchat()),
    staleTime: 30_000,
  });
}

/** VRChat runs through the Discord bot: start a job, then wait for the bot's answer. */
async function runJob<T>(start: Promise<{ jobId: string }>): Promise<T> {
  const { jobId } = await start;
  const started = Date.now();
  while (Date.now() - started < 12 * 60_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const job = await getVrchatJob({ data: jobId });
    if (job.status === "done") return (job.resultJson ? JSON.parse(job.resultJson) : null) as T;
    if (job.status === "failed") throw new Error(job.error ?? "Fehlgeschlagen.");
  }
  throw new Error("Der Discord-Bot hat nicht rechtzeitig geantwortet. Läuft er auf dem PC?");
}

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid content-start gap-3 rounded-xl border border-border bg-elevated/40 p-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-accent">{icon}</span>}
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function VRChatPanel() {
  const me = useMe();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => getVrchatStatus(),
    refetchInterval: 60_000,
  });
  const canManage = Boolean(me.data?.permissions.canManageVrchat);
  const s = status.data;

  if (status.isError) return <Empty>{errorMessage(status.error)}</Empty>;
  if (!s) return <Empty>Lade VRChat…</Empty>;

  return (
    <div className="@container mx-auto grid w-full max-w-5xl content-start gap-4 p-4">
      {!s.botOnline && (
        <ErrorText>
          Der Discord-Bot ist gerade nicht verbunden. VRChat läuft über den Bot auf dem PC – solange
          er aus ist, werden Instanzen nicht aktualisiert und Aktionen nicht ausgeführt.
        </ErrorText>
      )}
      {(!s.connected || !s.groupId) &&
        (canManage ? (
          <ConnectCard connected={s.connected} accountName={s.accountName} />
        ) : (
          <Card title="VRChat-Gruppe ist noch nicht verbunden" icon={<Link2 className="size-4" />}>
            <p className="text-[13px] text-muted">
              Der Owner muss die Gruppen-Überwachung einmalig über den Discord-Bot einrichten.
            </p>
          </Card>
        ))}
      {s.lastError && <ErrorText>{s.lastError}</ErrorText>}

      {s.connected && s.groupId && (
        <>
          <GroupHeader status={s} canManage={canManage} />
          <div className="grid items-start gap-4 @3xl:grid-cols-[1.4fr_1fr]">
            <Instances />
            <div className="grid content-start gap-4">
              <MyAccount groupId={s.groupId} groupName={s.group?.name ?? "der Gruppe"} />
              <Moderation groupId={s.groupId} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ConnectCard({
  connected,
  accountName,
}: {
  connected: boolean;
  accountName: string | null;
}) {
  // Which 2FA the bot is waiting for ("totp" = authenticator app, "emailOtp" = e-mail), if any.
  const [needs, setNeeds] = useState<string | null>(null);
  const emailPending = Boolean(needs);
  const setEmailPending = (on: boolean) => setNeeds(on ? needs : null);
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["furr", "vrchat"] });

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      setPassword("");
      setCode("");
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const step = !connected ? (emailPending ? "2fa" : "login") : "group";
  return (
    <Card title="Gruppen-Überwachung einrichten (Discord-Bot)" icon={<Link2 className="size-4" />}>
      <p className="text-[12px] text-muted">
        Der Discord-Bot beobachtet damit die offenen Instanzen und das Gruppen-Protokoll. Moderiert
        wird später mit dem eigenen VRChat-Konto jedes Teammitglieds.
      </p>
      <ol className="grid gap-1 text-[12px] text-muted">
        <li className={cn(step === "login" && "font-medium text-fg")}>
          1. Nutzername und Passwort eines VRChat-Kontos eingeben, das in der Gruppe ist (am besten
          ein eigenes Bot-Konto mit Gruppen-Rechten). Der Discord-Bot auf dem PC meldet sich damit
          an.
        </li>
        <li className={cn(step === "2fa" && "font-medium text-fg")}>
          2. Den 2FA-Code eingeben, sobald FurrBox danach fragt (Authenticator-App oder E-Mail).
        </li>
        <li className={cn(step === "group" && "font-medium text-fg")}>
          3. Das Gruppen-Kürzel eintragen (z. B. FLS.0227).
        </li>
      </ol>
      <p className="text-[11px] text-subtle">
        Das Passwort wird nur an den Bot weitergereicht und nirgends gespeichert.
      </p>
      {step === "login" && (
        <form
          className="grid gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(async () => {
              const result = await runJob<{ needs?: string }>(
                vrchatLogin({ data: { username, password } }),
              );
              if (result?.needs) setNeeds(result.needs);
            });
          }}
        >
          <Field label="VRChat-Nutzername oder E-Mail">
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="h-10"
            />
          </Field>
          <Field label="VRChat-Passwort">
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="h-10"
            />
          </Field>
          <Btn
            type="submit"
            variant="primary"
            className="h-10"
            disabled={busy || !username || !password}
          >
            {busy ? "Warte auf den Discord-Bot…" : "Bei VRChat anmelden"}
          </Btn>
        </form>
      )}
      {step === "2fa" && (
        <form
          className="grid gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(async () => {
              await runJob(vrchatVerify2fa({ data: code }));
              setEmailPending(false);
            });
          }}
        >
          <Field
            label={
              needs === "emailOtp"
                ? "Code aus der VRChat-E-Mail"
                : "Code aus deiner Authenticator-App (jetzt eintragen)"
            }
          >
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="h-10 font-mono tracking-widest"
              autoFocus
            />
          </Field>
          <Btn type="submit" variant="primary" className="h-10" disabled={busy || code.length < 6}>
            {busy ? "Bot prüft den Code…" : "Code bestätigen"}
          </Btn>
          <button
            type="button"
            className="justify-self-start text-[12px] text-accent hover:underline"
            onClick={() => setEmailPending(false)}
          >
            Zurück – neu anmelden
          </button>
        </form>
      )}
      {step === "group" && (
        <form
          className="grid gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => runJob(setVrchatGroup({ data: group })));
          }}
        >
          <p className="text-[12px] text-muted">
            Angemeldet als <span className="font-medium text-fg">{accountName}</span>.
          </p>
          <Field
            label="Gruppen-Kürzel"
            hint="Steht in VRChat unter dem Gruppennamen, z. B. FLS.0227 (Link oder grp_-ID gehen auch)."
          >
            <TextInput
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="FLS.0227"
              className="h-10 font-mono"
            />
          </Field>
          <Btn type="submit" variant="primary" className="h-10" disabled={busy || !group}>
            {busy ? "Bot sucht die Gruppe…" : "Gruppe verbinden"}
          </Btn>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

export function GroupHeader({ status, canManage }: { status: VrchatStatus; canManage: boolean }) {
  const queryClient = useQueryClient();
  const g = status.group;
  return (
    <div className="relative overflow-hidden rounded-xl border border-border">
      {g?.bannerUrl ? (
        <img
          src={g.bannerUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-r from-accent/25 via-elevated to-violet-500/20" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/70 to-surface/10" />
      <div className="relative flex flex-wrap items-end gap-4 p-4 pt-16">
        {g?.iconUrl ? (
          <img
            src={g.iconUrl}
            alt=""
            className="size-20 rounded-full border-4 border-surface object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="grid size-20 place-items-center rounded-full border-4 border-surface bg-accent/20 text-accent">
            <Users className="size-8" />
          </span>
        )}
        <div className="min-w-0 flex-1 pb-1">
          <p className="truncate text-[20px] font-bold leading-tight">
            {g?.name ?? "VRChat-Gruppe"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-muted">
            {g && (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-400" /> {g.onlineMemberCount}{" "}
                  online
                </span>
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" /> {g.memberCount}
                </span>
              </>
            )}
            {g?.code && <span className="font-mono">{g.code}</span>}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-col items-end gap-1 pb-1 text-[11px] text-muted">
            <span title="Mit diesem Konto beobachtet der Discord-Bot die Gruppe. Moderiert wird mit dem eigenen Konto.">
              Bot-Konto: {status.accountName}
            </span>
            <button
              type="button"
              className="flex items-center gap-1 hover:text-fg"
              onClick={async () => {
                await runJob(disconnectVrchat()).catch(() => undefined);
                await queryClient.invalidateQueries({ queryKey: ["furr", "vrchat"] });
              }}
            >
              <LogOut className="size-3" /> Trennen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Instances() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => getVrchatStatus() });
  const live = Boolean(status.data?.botOnline);
  const q = useQuery({
    queryKey: ["furr", "vrchat", "instances"],
    queryFn: () => listVrchatInstances(),
    refetchInterval: 45_000,
  });
  const list = q.data?.instances ?? [];
  const total = list.reduce((sum, i) => sum + i.memberCount, 0);
  return (
    <Card
      title="Offene Instanzen"
      icon={<Globe2 className="size-4" />}
      action={
        <button
          type="button"
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: ["furr", "vrchat", "instances"] })
          }
          className="flex items-center gap-1 text-[11px] text-muted hover:text-fg"
        >
          <RefreshCw className={cn("size-3", q.isFetching && "animate-spin")} />
          {live ? (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400" /> live · Bot prüft jede Minute
            </span>
          ) : q.data?.updatedAt ? (
            `Stand ${timeAgo(q.data.updatedAt)} (Bot offline)`
          ) : (
            "aktualisieren"
          )}
        </button>
      }
    >
      {q.isError ? (
        <ErrorText>{errorMessage(q.error)}</ErrorText>
      ) : !q.data ? (
        <p className="text-[12px] text-muted">Lade Instanzen…</p>
      ) : list.length === 0 ? (
        <div className="grid place-items-center gap-1 rounded-lg border border-dashed border-border py-8 text-center">
          <Globe2 className="size-6 text-subtle" />
          <p className="text-[13px] font-medium">Gerade ist keine Gruppen-Instanz offen</p>
          <p className="text-[12px] text-muted">
            Sobald jemand eine öffnet, erscheint sie hier und das Team bekommt eine Meldung.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-muted">
            {list.length} {list.length === 1 ? "Instanz" : "Instanzen"} · {total}{" "}
            {total === 1 ? "Person" : "Personen"} insgesamt
          </p>
          <div className="grid gap-2">
            {list.map((i) => (
              <InstanceRow key={i.instanceId} instance={i} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function InstanceRow({ instance: i }: { instance: VrchatInstance }) {
  const fill = i.capacity ? Math.min(100, Math.round((i.memberCount / i.capacity) * 100)) : 0;
  return (
    <div className="flex gap-3 overflow-hidden rounded-lg bg-bg/50 p-2">
      {i.worldImage ? (
        <img
          src={i.worldImage}
          alt=""
          className="h-16 w-28 shrink-0 rounded-md object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="grid h-16 w-28 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
          <Globe2 className="size-6" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" title={i.worldName}>
          {i.worldName}
        </p>
        <div className="mt-0.5 flex flex-wrap gap-1">
          <Badge tone="accent">{i.region}</Badge>
          <Badge>{i.access}</Badge>
          <span className="text-[11px] text-subtle">
            offen seit {timeAgo(i.openedAt).replace("vor ", "")}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/10">
            <div
              className={cn("h-full rounded-full", fill >= 90 ? "bg-danger" : "bg-accent")}
              style={{ width: `${fill}%` }}
            />
          </div>
          <span className="shrink-0 text-[12px] font-medium tabular-nums">
            {i.memberCount}
            {i.capacity ? ` / ${i.capacity}` : ""}
          </span>
        </div>
      </div>
      <a
        href={i.joinUrl}
        target="_blank"
        rel="noreferrer"
        className="flex shrink-0 items-center gap-1 self-center rounded-md bg-elevated px-2.5 py-1.5 text-[12px] hover:bg-fg/10"
        title="Instanz auf vrchat.com öffnen (dort „Launch“)"
      >
        <ExternalLink className="size-3.5" /> Öffnen
      </a>
    </div>
  );
}

function Moderation({ groupId }: { groupId: string }) {
  const me = useMe();
  const mine = useMyVrchat();
  const membership = useMembership(mine.data?.loggedIn ? mine.data.userId : null);
  const queryClient = useQueryClient();
  const canModerate = Boolean(me.data?.permissions.canModerateVrchat);
  const log = useQuery({
    queryKey: ["furr", "vrchat", "moderation"],
    queryFn: () => listVrchatModeration(),
    refetchInterval: 20_000,
  });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; displayName: string; image: string | null }[]
  >([]);
  const [target, setTarget] = useState<{
    id: string;
    displayName: string;
    image: string | null;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setResults(await unwrap(desktopVrchat()?.search(query)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "kick" | "ban" | "unban") {
    if (!target) return;
    setError("");
    setBusy(true);
    try {
      let failure: string | null = null;
      try {
        await unwrap(desktopVrchat()?.moderate(action, groupId, target.id));
      } catch (err) {
        failure = errorMessage(err);
      }
      await logVrchatModeration({
        data: {
          action,
          userId: target.id,
          userName: target.displayName,
          reason,
          vrchatName: mine.data?.displayName ?? undefined,
          ok: !failure,
          error: failure ?? undefined,
        },
      });
      if (failure) throw new Error(failure);
      useNotifications.getState().notify({
        version: "FurrVRChat",
        title: action === "ban" ? "Gebannt" : action === "unban" ? "Entbannt" : "Gekickt",
        description: `${target.displayName} wurde in der VRChat-Gruppe moderiert.`,
      });
      setReason("");
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["furr", "vrchat", "moderation"] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Gruppen-Moderation" icon={<Gavel className="size-4" />}>
      {!canModerate ? (
        <p className="text-[12px] text-muted">
          Kick und Bann in der VRChat-Gruppe dürfen Moderatoren, Owner und Dev.
        </p>
      ) : !desktopVrchat() ? (
        <p className="text-[12px] text-muted">
          Moderieren geht nur in der FurrBox-Desktop-App mit deinem eigenen VRChat-Konto (siehe „Dein VRChat-Konto“).
        </p>
      ) : !mine.data?.loggedIn ? (
        <p className="text-[12px] text-muted">
          Melde dich oben unter „Dein VRChat-Konto“ an – dann läuft Kick und Bann unter deinem
          Namen.
        </p>
      ) : membership.data && !membership.data.member ? (
        <p className="text-[12px] text-muted">
          Dein VRChat-Konto ist nicht in der Gruppe – tritt ihr zuerst bei (siehe „Dein VRChat-Konto“).
        </p>
      ) : target ? (
        <div className="grid gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 p-2.5">
            <VrcAvatar user={target} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{target.displayName}</p>
              <p className="truncate font-mono text-[10px] text-muted">{target.id}</p>
            </div>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="rounded p-1 text-muted hover:text-fg"
              aria-label="Andere Person"
            >
              <X className="size-4" />
            </button>
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Grund (landet im Audit-Log)"
            className="rounded-lg border border-border bg-bg/60 p-2.5 text-[13px] outline-none placeholder:text-subtle focus:border-accent"
          />
          <div className="grid grid-cols-3 gap-2">
            <Btn disabled={busy || reason.trim().length < 3} onClick={() => void act("kick")}>
              <UserMinus className="size-3.5" /> Kick
            </Btn>
            <Btn
              variant="danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void act("ban")}
            >
              <Ban className="size-3.5" /> Bann
            </Btn>
            <Btn disabled={busy || reason.trim().length < 3} onClick={() => void act("unban")}>
              <ShieldCheck className="size-3.5" /> Entbannen
            </Btn>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <form onSubmit={search} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="VRChat-Name oder usr_…"
                className="h-9 pl-9"
              />
            </div>
            <Btn type="submit" disabled={busy || query.trim().length < 2}>
              Suchen
            </Btn>
          </form>
          {results.length > 0 && (
            <div className="grid max-h-48 gap-0.5 overflow-auto rounded-lg border border-border bg-bg/40 p-1">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setTarget(u)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fg/8"
                >
                  <VrcAvatar user={u} small />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{u.displayName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      <div className="grid gap-1 border-t border-border pt-3">
        <p className="text-[12px] font-medium text-muted">Letzte Aktionen</p>
        {!log.data?.length ? (
          <p className="text-[12px] text-subtle">Noch keine VRChat-Moderation.</p>
        ) : (
          log.data.slice(0, 8).map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-md px-1 py-1 text-[12px]">
              <Badge
                tone={m.status === "success" ? (m.action === "ban" ? "bad" : "accent") : "warn"}
              >
                {m.action === "ban" ? "Bann" : m.action === "unban" ? "Entbannt" : "Kick"}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-medium">{m.targetName ?? m.targetUserId}</span>
                  <span className="text-subtle">
                    {" "}
                    · {m.moderatorName} · {timeAgo(m.createdAt)}
                  </span>
                </p>
                <p className="truncate text-muted">{m.error ? `Fehler: ${m.error}` : m.reason}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/** Each team member's own VRChat login – stored only on this PC, kept across updates. */
/** The bot checks whether a personally logged-in VRChat account is in the group. */
function useMembership(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["furr", "vrchat", "member", userId],
    queryFn: () =>
      runJob<{ member: boolean; status: string }>(checkVrchatMembership({ data: userId! })),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function MyAccount({ groupId, groupName }: { groupId: string; groupName: string }) {
  const queryClient = useQueryClient();
  const bridge = desktopVrchat();
  const mine = useMyVrchat();
  const membership = useMembership(mine.data?.loggedIn ? mine.data.userId : null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(task: () => Promise<MyStatus>) {
    setBusy(true);
    setError("");
    try {
      queryClient.setQueryData(MY_KEY, await task());
      setPassword("");
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const st = mine.data;
  return (
    <Card title="Dein VRChat-Konto" icon={<KeyRound className="size-4" />}>
      {!bridge ? (
        <DesktopHint what="Die eigene VRChat-Anmeldung" />
      ) : !st ? (
        <p className="text-[12px] text-muted">Lade…</p>
      ) : st.loggedIn ? (
        <>
          <div className="flex items-center gap-3">
            <VrcAvatar user={{ displayName: st.displayName ?? "?", image: null }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{st.displayName}</p>
              <p className="text-[11px] text-muted">angemeldet auf diesem PC</p>
            </div>
            <Btn
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => unwrap(bridge.logout()))}
            >
              <LogOut className="size-3.5" /> Abmelden
            </Btn>
          </div>
          <MembershipHint query={membership} groupId={groupId} groupName={groupName} />
        </>
      ) : st.needs ? (
        <form
          className="grid gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => unwrap(bridge.verify(code)));
          }}
        >
          <Field
            label={
              st.needs === "emailOtp"
                ? "Code aus der VRChat-E-Mail"
                : "Code aus deiner Authenticator-App"
            }
          >
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="h-9 font-mono tracking-widest"
              autoFocus
            />
          </Field>
          <div className="flex gap-2">
            <Btn
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={busy || code.trim().length < 6}
            >
              {busy ? "Prüfe…" : "Bestätigen"}
            </Btn>
            <Btn
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => unwrap(bridge.cancel()))}
            >
              Abbrechen
            </Btn>
          </div>
        </form>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => unwrap(bridge.login(username, password)));
          }}
        >
          <p className="text-[12px] text-muted">
            Melde dich mit deinem eigenen VRChat-Konto an. Die Anmeldung bleibt auf diesem PC
            gespeichert, das Passwort nicht.
          </p>
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="VRChat-Nutzername oder E-Mail"
            autoComplete="off"
            className="h-9"
          />
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort"
            autoComplete="off"
            className="h-9"
          />
          <Btn type="submit" variant="primary" disabled={busy || !username || !password}>
            {busy ? "Melde an…" : "Bei VRChat anmelden"}
          </Btn>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function MembershipHint({
  query,
  groupId,
  groupName,
}: {
  query: ReturnType<typeof useMembership>;
  groupId: string;
  groupName: string;
}) {
  if (query.isLoading)
    return <p className="text-[11px] text-subtle">Der Bot prüft, ob du in {groupName} bist…</p>;
  if (query.isError || !query.data) {
    return (
      <p className="text-[11px] text-subtle">
        Gruppen-Mitgliedschaft konnte nicht geprüft werden (läuft der Discord-Bot?).{" "}
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => void query.refetch()}
        >
          Erneut prüfen
        </button>
      </p>
    );
  }
  if (query.data.member) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
        <ShieldCheck className="size-3.5" /> Du bist Mitglied in {groupName}.
      </p>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px]">
      <p className="font-medium text-amber-200">Dein VRChat-Konto ist nicht in {groupName}.</p>
      <p className="text-muted">
        Tritt der Gruppe zuerst bei – ohne Mitgliedschaft (und passende Gruppen-Rolle) kannst du
        nicht moderieren.
      </p>
      <div className="flex gap-2">
        <a
          href={`https://vrchat.com/home/group/${groupId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-elevated px-2.5 py-1.5 hover:bg-fg/10"
        >
          <ExternalLink className="size-3.5" /> Gruppe öffnen
        </a>
        <Btn variant="ghost" onClick={() => void query.refetch()}>
          Erneut prüfen
        </Btn>
      </div>
    </div>
  );
}

function VrcAvatar({
  user,
  small,
}: {
  user: { displayName: string; image: string | null };
  small?: boolean;
}) {
  const size = small ? "size-7" : "size-9";
  return user.image ? (
    <img
      src={user.image}
      alt=""
      className={cn(size, "shrink-0 rounded-full object-cover")}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      className={cn(
        size,
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent/80 to-violet-500/70 text-[12px] font-semibold text-white",
      )}
    >
      {(user.displayName.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
