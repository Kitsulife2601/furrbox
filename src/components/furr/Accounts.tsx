// FurrAccountManager (Dev only): create accounts with start password, set roles / Discord IDs, delete.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { createAccount, deleteAccount, listAccounts, updateAccount } from "@/lib/furr/api/accounts";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/furr/roles";
import { useNotifications } from "@/store/notifications";
import { dualLabel } from "./Presence";
import { Btn, ConfirmDialog, Empty, ErrorText, Field, PromptDialog, TextInput } from "./ui";

export function Accounts() {
  const me = useMe();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["furr", "accounts"], queryFn: () => listAccounts(), refetchInterval: 10_000 });
  const [form, setForm] = useState({ email: "", username: "", password: "", discordId: "", role: "member" as Role });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["furr"] });
  const toast = (title: string, description: string) =>
    useNotifications.getState().notify({ version: "FurrAccountManager", title, description });

  async function create() {
    setError("");
    setBusy(true);
    try {
      await createAccount({ data: form });
      toast("Account erstellt", `${form.username} kann sich jetzt mit ${form.email} anmelden.`);
      setForm({ email: "", username: "", password: "", discordId: "", role: "member" });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function update(userId: string, patch: { role?: Role; discordId?: string }) {
    try {
      await updateAccount({ data: { userId, ...patch } });
      await refresh();
    } catch (e) {
      toast("Änderung fehlgeschlagen", errorMessage(e));
    }
  }

  const editing = accounts.data?.find((a) => a.id === editId);
  const removing = accounts.data?.find((a) => a.id === removeId);

  return (
    <div className="relative grid h-full min-h-0 bg-bg/40 lg:grid-cols-[320px_1fr]">
      <div className="grid content-start gap-3 overflow-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
        <p className="text-[13px] font-semibold">Neuen Account anlegen</p>
        <Field label="E-Mail (Login)">
          <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Wunschnutzername" hint="3-32 Zeichen: a-z, 0-9, _ . -">
          <TextInput value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Start-Passwort" hint="Mindestens 8 Zeichen – kann später in FurrSettings geändert werden">
          <TextInput type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Discord-ID (optional)">
          <TextInput value={form.discordId} inputMode="numeric" onChange={(e) => setForm({ ...form, discordId: e.target.value.trim() })} />
        </Field>
        <Field label="Rolle">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="h-9 rounded-md border border-border bg-bg/60 px-2 text-[13px] text-fg outline-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText>{error}</ErrorText>
        <Btn variant="primary" disabled={busy} onClick={() => void create()}>
          {busy ? "Wird angelegt…" : "Account erstellen"}
        </Btn>
      </div>

      <div className="min-h-0 overflow-auto">
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-[13px] font-semibold">Accounts ({accounts.data?.length ?? 0})</p>
          <Btn variant="ghost" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" /> Aktualisieren
          </Btn>
        </div>
        {accounts.isError ? (
          <Empty>{errorMessage(accounts.error)}</Empty>
        ) : !accounts.data ? (
          <Empty>Lade Accounts…</Empty>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="bg-elevated/60 text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Rolle</th>
                <th className="px-3 py-2 font-medium">Discord-ID</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.data.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <p className="font-medium">
                      {a.displayName} {a.id === me.data?.userId && <span className="text-accent">(du)</span>}
                    </p>
                    <p className="text-muted">
                      @{a.username} · {a.email}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={a.accountRole}
                      onChange={(e) => void update(a.id, { role: e.target.value as Role })}
                      className="h-8 rounded-md border border-border bg-bg/60 px-1 text-[12px] text-fg outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    {a.role !== a.accountRole && <p className="mt-1 text-muted">Discord: {a.roleLabel}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className="font-mono underline-offset-4 hover:underline" onClick={() => setEditId(a.id)}>
                      {a.discordId ?? "setzen…"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {dualLabel(a)}
                    <br />
                    {a.isAppOnline ? "" : timeAgo(a.lastSeenAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Btn variant="ghost" disabled={a.id === me.data?.userId} onClick={() => setRemoveId(a.id)}>
                      Löschen
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <PromptDialog
          title={`Discord-ID für ${editing.displayName}`}
          initial={editing.discordId ?? ""}
          confirmLabel="Speichern"
          onCancel={() => setEditId(null)}
          onSubmit={(value) => {
            setEditId(null);
            void update(editing.id, { discordId: value === "-" ? "" : value });
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Account ${removing.displayName} löschen?`}
          body="Private Dateien, Chatnachrichten und Presence-Daten werden ebenfalls entfernt."
          confirmLabel="Account löschen"
          onCancel={() => setRemoveId(null)}
          onConfirm={async () => {
            setRemoveId(null);
            try {
              await deleteAccount({ data: removing.id });
              toast("Account gelöscht", `${removing.displayName} wurde entfernt.`);
              await refresh();
            } catch (e) {
              toast("Löschen fehlgeschlagen", errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}
