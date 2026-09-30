// FurrWhitelist (Supporter and up): grant or revoke FurrBox access for non-staff Discord users.
// Switching the whole whitelist on/off stays with Owner/Dev.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { addToWhitelist, getWhitelist, removeFromWhitelist, setWhitelistEnabled, type WhitelistEntry } from "@/lib/furr/api/whitelist";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/store/notifications";
import { Btn, ConfirmDialog, Empty, ErrorText, Field, TextInput } from "./ui";

const KEY = ["furr", "whitelist"];

export function Whitelist() {
  const me = useMe();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => getWhitelist(), refetchInterval: 15_000 });
  const [discordId, setDiscordId] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<WhitelistEntry | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const toast = (title: string, description: string) =>
    useNotifications.getState().notify({ version: "FurrWhitelist", title, description });

  async function add(id: string, label?: string) {
    setError("");
    setBusy(true);
    try {
      await addToWhitelist({ data: { discordId: id, note } });
      toast("Freigeschaltet", `${label ?? id} kann FurrBox jetzt nutzen.`);
      setDiscordId("");
      setNote("");
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
          Discord-Staff (Supporter und höher) kommt immer rein. Alle anderen brauchen einen Eintrag auf dieser Whitelist.
        </p>

        {data && (
          <label className="flex items-center gap-2 rounded-md bg-elevated/60 px-3 py-2 text-[13px]">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={!me.data?.permissions.canToggleWhitelist}
              title={me.data?.permissions.canToggleWhitelist ? undefined : "Nur Owner und Dev können die Whitelist ein- oder ausschalten."}
              onChange={async (e) => {
                const enabled = e.target.checked;
                try {
                  await setWhitelistEnabled({ data: enabled });
                  toast("Whitelist", enabled ? "Nur noch freigeschaltete Nutzer kommen rein." : "Jeder mit Discord-Login kommt rein.");
                  await refresh();
                } catch (err) {
                  toast("Änderung fehlgeschlagen", errorMessage(err));
                }
              }}
            />
            Whitelist aktiv
            <span className="ml-auto text-[11px] text-muted">{data.enabled ? "geschützt" : "offen für alle"}</span>
          </label>
        )}

        <Field label="Discord-ID" hint="Rechtsklick auf die Person in Discord → „Benutzer-ID kopieren“ (Entwicklermodus)">
          <TextInput value={discordId} inputMode="numeric" onChange={(e) => setDiscordId(e.target.value.trim())} placeholder="123456789012345678" />
        </Field>
        <Field label="Notiz (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Event-Helfer" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Btn variant="primary" disabled={busy || !discordId} onClick={() => void add(discordId)}>
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
                  disabled={busy}
                  onClick={() => void add(c.discordId, c.name)}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-fg/6 disabled:opacity-60"
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
                <th className="px-3 py-2 font-medium">Notiz</th>
                <th className="px-3 py-2 font-medium">Freigeschaltet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.discordId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <p className="font-medium">{e.name ?? "Unbekannt"}</p>
                    <p className="font-mono text-muted">{e.discordId}</p>
                    {!e.hasAccount && <p className="text-subtle">noch nie angemeldet</p>}
                  </td>
                  <td className="px-3 py-2 text-muted">{e.note || "–"}</td>
                  <td className="px-3 py-2 text-muted">
                    {timeAgo(e.createdAt)}
                    {e.addedBy ? ` · von ${e.addedBy}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Btn variant="ghost" onClick={() => setRemoving(e)}>
                      <UserMinus className="size-3.5" /> Entfernen
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
