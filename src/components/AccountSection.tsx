import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { signOut, useAuth } from "@/hooks/useAuth";
import { pendingChanges, wipeLocalData } from "@/services/session";
import { stopSync, syncNow } from "@/services/sync";
import { resetFlagStore } from "@/stores/flagStore";
import { resetPageStore, usePageStore } from "@/stores/pageStore";
import { resetSyncStore } from "@/stores/syncStore";

const buttonClass =
  "rounded border border-neutral-300 px-3 py-1 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";

export function AccountSection() {
  const { t } = useTranslation();
  const auth = useAuth();

  if (auth.status !== "signedIn") return null;

  return (
    <div className="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <h2 className="font-semibold">{t("settings.account")}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t("settings.signedInAs", { email: auth.user.email ?? auth.user.username })}
      </p>
      <SignOut />
      {import.meta.env.DEV && <OwnerProbe />}
    </div>
  );
}

/**
 * Sign out (CLAUDE.md, "Auth and offline"): save pending text, try to upload what is left,
 * and if rows are still not pushed, ask before losing them. Then stop sync, wipe IndexedDB
 * (other tabs reload) and sign out of Amplify.
 */
/** Network steps of signing out never hold it up for long (a hung request, a bad network). */
const SYNC_BEFORE_SIGN_OUT_MS = 8_000;
const WAIT_FOR_SYNC_MS = 5_000;

function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.catch(() => undefined).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function SignOut() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  async function finish() {
    setBusy(true);
    try {
      await withTimeout(stopSync(), WAIT_FOR_SYNC_MS);
      await wipeLocalData();
      resetPageStore();
      resetFlagStore();
      resetSyncStore();
      await signOut().catch((e) => console.error("[bacuyy] sign out", e));
    } finally {
      navigate("/auth/sign-in", { replace: true });
    }
  }

  async function attempt() {
    setBusy(true);
    setPending(0);
    try {
      await usePageStore.getState().flushAll();
      if (navigator.onLine !== false) await withTimeout(syncNow(), SYNC_BEFORE_SIGN_OUT_MS);
      const left = await pendingChanges();
      if (left > 0) {
        setPending(left);
        setBusy(false);
        return;
      }
    } catch (e) {
      console.error("[bacuyy] could not check pending changes", e);
    }
    await finish();
  }

  if (pending > 0) {
    return (
      <div role="alertdialog" aria-labelledby="signout-title" className="space-y-3 rounded border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950">
        <p id="signout-title">{t("settings.signOutPending", { count: pending })}</p>
        {navigator.onLine === false && <p>{t("settings.signOutOffline")}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void attempt()}>
            {t("settings.signOutRetry")}
          </button>
          <button
            type="button"
            className="rounded bg-red-700 px-3 py-1 text-white outline-none hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
            disabled={busy}
            onClick={() => void finish()}
          >
            {t("settings.signOutAnyway")}
          </button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => setPending(0)}>
            {t("settings.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className={buttonClass} disabled={busy} onClick={() => void attempt()}>
      {busy ? t("settings.signingOut") : t("settings.signOut")}
    </button>
  );
}

/** Development only: shows the `owner` string AppSync stores (needed by the Phase 2 resolver). */
function OwnerProbe() {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Developer tool, never shipped: plain strings on purpose.
  return (
    <div className="rounded border border-dashed border-amber-500 p-3 text-sm">
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { probeOwnerFormat } = await import("@/services/sync/diagnostics");
            setResult(await probeOwnerFormat());
          } catch (e) {
            setResult(`error: ${(e as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        DEV · owner probe
      </button>
      {result && (
        <p className="mt-2 break-all font-mono" data-testid="owner-probe-result">
          {result}
        </p>
      )}
      <UpsertSelfTest />
    </div>
  );
}

/** Development only: runs the upsert round trip against the deployed resolver. */
function UpsertSelfTest() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setLines(null);
          try {
            const { runUpsertSelfTest } = await import("@/services/sync/diagnostics");
            const results = await runUpsertSelfTest();
            const failed = results.filter((r) => !r.ok).length;
            setLines([
              failed === 0 ? `OK · ${results.length}/${results.length}` : `FAILED · ${failed}/${results.length}`,
              ...results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`),
            ]);
          } catch (e) {
            setLines([`error: ${(e as Error).message}`]);
          } finally {
            setBusy(false);
          }
        }}
      >
        DEV · upsert self-test
      </button>
      {lines && (
        <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs" data-testid="upsert-self-test-result">
          {lines.join("\n")}
        </pre>
      )}
    </div>
  );
}
