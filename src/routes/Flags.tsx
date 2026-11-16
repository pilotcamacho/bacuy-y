import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FlagTree } from "@/components/FlagTree";
import { useAuth } from "@/hooks/useAuth";
import { subscribe } from "@/lib/events";
import { buildTree, driftGroups } from "@/services/flags/tree";
import { useFlagStore } from "@/stores/flagStore";

export function Flags() {
  const { t } = useTranslation();
  const status = useFlagStore((s) => s.status);
  const flags = useFlagStore((s) => s.flags);
  const store = useFlagStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;

  useEffect(() => {
    void store().load(ownerSub);
  }, [store, ownerSub]);

  // Reload after a sync that changed rows, or a write in another tab.
  useEffect(
    () =>
      subscribe((event, fromOtherTab) => {
        if ((event.type === "synced" && event.changed) || (event.type === "localWrite" && fromOtherTab)) void store().refresh();
      }),
    [store],
  );

  const tree = useMemo(() => buildTree(flags), [flags]);
  const drift = useMemo(() => new Set(driftGroups(flags)), [flags]);

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t("flags.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("flags.intro")}</p>
      </header>

      {drift.size > 0 && (
        <p
          role="status"
          className="rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          data-testid="flags-drift"
        >
          {t("flags.drift")}
        </p>
      )}

      {status === "error" ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {t("flags.loadError")}
        </p>
      ) : status !== "ready" ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("flags.loading")}</p>
      ) : (
        <FlagTree nodes={tree} drift={drift} />
      )}
    </section>
  );
}
