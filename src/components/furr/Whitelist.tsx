// FurrWhitelist (Owner/Dev): grant or revoke FurrBox access for non-staff Discord users.
// Every entry gets a login name + start password from the owner. The person signs in with
// Discord first, then with these credentials, and must replace the start password on first use.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, RefreshCw, ShieldCheck, UserMinus, UserPlus, Wand2 } from "lucide-react";
import {
  addToWhitelist,
  getWhitelist,
  removeFromWhitelist,
  resetWhitelistPassword,
  setWhitelistEnabled,
  type WhitelistEntry,
} from "@/lib/furr/api/whitelist";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/store/notifications";
import { Btn, ConfirmDialog, Empty, ErrorText, Field, TextInput } from "./ui";

const KEY = ["furr", "whitelist"];

/** Readable start password, e.g. "Fuchs-Wolke-4821". */
function generatePassword() {
  const words = ["Fuchs", "Wolke", "Pfote", "Stern", "Otter", "Mond", "Fisch", "Luchs", "Welle", "Funke", "Moos", "Falke"];
  const rnd = new Uint32Array(3);
  crypto.getRandomValues(rnd);
  return `${words[rnd[0] % words.length]}-${words[rnd[1] % words.length]}-${1000 + (rnd[2] % 9000)}`;
}

function suggestUsername(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_.-]+/g, "")
    .slice(0, 32);
}

type Credentials = { name: string; username: string; password: string };

export function Whitelist() {
  const me = useMe();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => getWhitelist(), refetchInterval: 15_000 });
  const [discordId, setDiscordId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<WhitelistEntry | null>(null);
  const [resetting, setResetting] = useState<WhitelistEntry | null>(null);
  const [shown, setShown] = useState<Credentials | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const toast = (title: string, description: string) =>
    useNotifications.getState().notify({ version: "FurrWhitelist", title, description });

  async function add() {
    setError("");
    setBusy(true);
    try {
      await addToWhitelist({ data: { discordId, username, password, note } });
      setShown({ name: label || username, username: username.toLowerCase(), password });
      setDiscordId("");
      setUsername("");
      setNote("");
      setLabel("");
      setPassword(generatePassword());
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = query.data?.candidates ?? [];
    return (q ? list.filter((c) => `${c.name} ${c.username} ${c.discordId}`.toLowerCase().includes(q)) : list).slice(0, 40);
  }, [query.data, search]);

  const data = query.data;

  return (
    <div className="relative grid h-full min-h-0 bg-bg/40 lg:grid-cols-[340px_1fr]">
      <div className="grid content-start gap-3 overflow-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-accent" />
          <p className="text-[13px] font-semibold">Zugang freischalten</p>
        </div>
        <p className="text-[12px] text-muted">
          Discord-Staff (Supporter und höher) kommt direkt rein. Alle anderen melden sich zuerst mit Discord an und dann mit dem
          Nutzernamen und Start-Passwort, das du hier vergibst. Beim ersten Login müssen sie ein eigenes Passwort festlegen.
        </p>

        {data && (
          <label className="flex items-center gap-2 rounded-md bg-elevated/60 px-3 py-2 text-[13px]">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={!me.data?.permissions.canToggleWhitelist}
              onChange={async (e) => {
                const enabled = e.target.checked;
                try {
                  await setWhitelistEnabled({ data: enabled });
                  toast("Whitelist", enabled ? "Nur noch freigeschaltete Nutzer kommen rein." : "Jedes Server-Mitglied kommt rein.");
                  await refresh();
                } catch (err) {
                  toast("Änderung fehlgeschlagen", errorMessage(err));
                }
              }}
            />
            Whitelist aktiv
            <span className="ml-auto text-[11px] text-muted">{data.enabled ? "geschützt" : "offen für Server-Mitglieder"}</span>
          </label>
        )}

        <Field label="Discord-ID" hint="Rechtsklick auf die Person in Discord → „Benutzer-ID kopieren“ (Entwicklermodus)">
          <TextInput value={discordId} inputMode="numeric" onChange={(e) => setDiscordId(e.target.value.trim())} placeholder="123456789012345678" />
        </Field>
        <Field label="Nutzername" hint="3–32 Zeichen: a–z, 0–9, _ . -">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value.trim())} placeholder="z. B. fuchs" autoComplete="off" />
        </Field>
        <Field label="Start-Passwort" hint="Gib es der Person weiter – sie muss es beim ersten Login ändern.">
          <div className="flex gap-2">
            <TextInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className="font-mono" />
            <Btn aria-label="Neues Passwort erzeugen" title="Neues Passwort erzeugen" onClick={() => setPassword(generatePassword())}>
              <Wand2 className="size-4" />
            </Btn>
          </div>
        </Field>
        <Field label="Notiz (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Event-Helfer" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Btn variant="primary" disabled={busy || !discordId || !username || password.length < 8} onClick={() => void add()}>
          <UserPlus className="size-4" /> Freischalten
        </Btn>

        <div className="mt-2 grid gap-2">
          <p className="text-[12px] font-medium text-muted">Oder aus dem Discord-Server auswählen</p>
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name suchen…" />
          <div className="grid max-h-72 gap-1 overflow-auto">
            {candidates.length === 0 ? (
              <p className="px-1 text-[12px] text-subtle">
                {data ? "Keine Treffer. Mitglieder erscheinen, sobald der Bot synchronisiert hat." : "Lade…"}
              </p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.discordId}
                  type="button"
                  onClick={() => {
                    setDiscordId(c.discordId);
                    setUsername(suggestUsername(c.username || c.name));
                    setLabel(c.name);
                  }}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-fg/6",
                    discordId === c.discordId && "bg-accent/15",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-muted">@{c.username}</span>
                  </span>
                  <UserPlus className="size-3.5 shrink-0 text-accent" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-[13px] font-semibold">Freigeschaltet ({data?.entries.length ?? 0})</p>
          <Btn variant="ghost" onClick={() => void refresh()}>
            <RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin")} /> Aktualisieren
          </Btn>
        </div>
        {query.isError ? (
          <Empty>{errorMessage(query.error)}</Empty>
        ) : !data ? (
          <Empty>Lade Whitelist…</Empty>
        ) : data.entries.length === 0 ? (
          <Empty>Noch niemand freigeschaltet.</Empty>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="bg-elevated/60 text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Login</th>
                <th className="px-3 py-2 font-medium">Freigeschaltet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.discordId} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium">{e.name ?? "Unbekannt"}</p>
                    <p className="font-mono text-muted">{e.discordId}</p>
                    {e.note && <p className="text-subtle">{e.note}</p>}
                  </td>
                  <td className="px-3 py-2">
                    {e.username ? <p className="font-mono">{e.username}</p> : <p className="text-red-300">kein Login vergeben</p>}
                    <p className="text-muted">
                      {!e.username
                        ? "Bitte Passwort vergeben"
                        : e.mustChangePassword
                          ? "Start-Passwort aktiv"
                          : `eigenes Passwort${e.passwordChangedAt ? ` seit ${timeAgo(e.passwordChangedAt)}` : ""}`}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {timeAgo(e.createdAt)}
                    {e.addedBy ? ` · von ${e.addedBy}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Btn
                        variant="ghost"
                        onClick={() => {
                          if (e.username) return setResetting(e);
                          setDiscordId(e.discordId);
                          setLabel(e.name ?? "");
                          setUsername(suggestUsername(e.name ?? ""));
                        }}
                      >
                        <KeyRound className="size-3.5" /> {e.username ? "Passwort zurücksetzen" : "Login vergeben"}
                      </Btn>
                      <Btn variant="ghost" onClick={() => setRemoving(e)}>
                        <UserMinus className="size-3.5" /> Entfernen
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {shown && <CredentialsDialog credentials={shown} onClose={() => setShown(null)} />}

      {resetting && (
        <ConfirmDialog
          title={`Neues Start-Passwort für ${resetting.name ?? resetting.username}?`}
          body="Die Person wird überall abgemeldet und muss sich mit dem neuen Start-Passwort anmelden und es danach ändern."
          confirmLabel="Zurücksetzen"
          onCancel={() => setResetting(null)}
          onConfirm={async () => {
            const target = resetting;
            setResetting(null);
            const fresh = generatePassword();
            try {
              await resetWhitelistPassword({ data: { discordId: target.discordId, password: fresh } });
              setShown({ name: target.name ?? target.username ?? target.discordId, username: target.username ?? "", password: fresh });
              await refresh();
            } catch (err) {
              toast("Zurücksetzen fehlgeschlagen", errorMessage(err));
            }
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`${removing.name ?? removing.discordId} von der Whitelist entfernen?`}
          body="Die Person verliert sofort den Zugang zu FurrBox (außer sie hat eine Staff-Rolle)."
          confirmLabel="Entfernen"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const target = removing;
            setRemoving(null);
            try {
              await removeFromWhitelist({ data: target.discordId });
              toast("Entfernt", `${target.name ?? target.discordId} hat keinen Zugang mehr.`);
              await refresh();
            } catch (err) {
              toast("Entfernen fehlgeschlagen", errorMessage(err));
            }
          }}
        />
      )}
    </div>
  );
}

/** Shows the login once so the owner can pass it on (it is stored only as a hash). */
function CredentialsDialog({ credentials, onClose }: { credentials: Credentials; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `FurrBox-Zugang für ${credentials.name}\n1. Mit Discord anmelden\n2. Nutzername: ${credentials.username}\n3. Start-Passwort: ${credentials.password}\nBeim ersten Login legst du ein eigenes Passwort fest.`;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-bg/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl">
        <p className="text-[13px] font-semibold">Zugang für {credentials.name}</p>
        <p className="mt-1 text-[12px] text-muted">
          Gib diese Daten der Person weiter. Das Passwort wird nur jetzt angezeigt.
        </p>
        <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1 rounded-md bg-bg/60 p-3 text-[13px]">
          <dt className="text-muted">Nutzername</dt>
          <dd className="font-mono">{credentials.username}</dd>
          <dt className="text-muted">Start-Passwort</dt>
          <dd className="font-mono">{credentials.password}</dd>
        </dl>
        <div className="mt-4 flex justify-end gap-2">
          <Btn
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => setCopied(true));
            }}
          >
            <Copy className="size-3.5" /> {copied ? "Kopiert" : "Nachricht kopieren"}
          </Btn>
          <Btn variant="primary" onClick={onClose}>
            Fertig
          </Btn>
        </div>
      </div>
    </div>
  );
}
