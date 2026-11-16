import { useTranslation } from "react-i18next";
import { syncNow } from "@/services/sync";
import { useSyncStore } from "@/stores/syncStore";

const DOT: Record<string, string> = {
  synced: "bg-emerald-500",
  syncing: "bg-indigo-500 animate-pulse",
  offline: "bg-neutral-400",
  error: "bg-amber-500",
};

/**
 * Small, unobtrusive sync state (CLAUDE.md, Offline & Sync → UI). Never blocks anything;
 * clicking it asks for a sync now.
 */
export function SyncIndicator() {
  const { t, i18n } = useTranslation();
  const status = useSyncStore((s) => s.status);
  const reason = useSyncStore((s) => s.reason);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const dirty = useSyncStore((s) => s.dirty);

  const label = t(`sync.${status.toUpperCase()}`);
  const details = [
    reason === "auth" ? t("sync.signInAgain") : null,
    lastSyncedAt
      ? t("sync.lastSynced", {
          time: new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeStyle: "short" }).format(new Date(lastSyncedAt)),
        })
      : null,
    dirty > 0 ? t("sync.pending", { count: dirty }) : null,
    t("sync.syncNow"),
  ].filter(Boolean);

  return (
    <button
      type="button"
      data-testid="sync-indicator"
      data-status={status}
      data-dirty={dirty}
      onClick={() => void syncNow()}
      title={details.join(" · ")}
      aria-label={`${label}. ${details.join(". ")}`}
      className="ms-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-neutral-500 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      <span>{label}</span>
    </button>
  );
}
