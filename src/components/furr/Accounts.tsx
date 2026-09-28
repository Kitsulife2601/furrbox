// FurrAccountManager (Dev only): accounts come from Discord logins; set roles, delete.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { deleteAccount, listAccounts, updateAccount } from "@/lib/furr/api/accounts";
import { errorMessage, timeAgo, useMe } from "@/lib/furr/client";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/furr/roles";
import { useNotifications } from "@/store/notifications";
import { dualLabel } from "./Presence";
import { Btn, ConfirmDialog, Empty } from "./ui";

export function Accounts() {
  const me = useMe();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["furr", "accounts"], queryFn: () => listAccounts(), refetchInterval: 10_000 });
  const [removeId, setRemoveId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["furr"] });
  const toast = (title: string, description: string) =>
    useNotifications.getState().notify({ version: "FurrAccountManager", title, description });

  async function update(userId: string, patch: { role?: Role }) {
    try {
      await updateAccount({ data: { userId, ...patch } });
      await refresh();
    } catch (e) {
      toast("Änderung fehlgeschlagen", errorMessage(e));
    }
  }

  const removing = accounts.data?.find((a) => a.id === removeId);

  return (
    <div className="relative grid h-full min-h-0 bg-bg/40">
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
                      @{a.username}
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
                    <span className="font-mono">{a.discordId ?? "–"}</span>
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
