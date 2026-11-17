import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useGratitudeAutoCreate } from "@/hooks/useGratitude";
import { useTheme } from "@/hooks/useTheme";
import { subscribe } from "@/lib/events";
import { LINE_PATHS } from "@/lib/lineTabs";
import { prepareSession } from "@/services/session";
import { startSync, stopSync } from "@/services/sync";
import { resetFlagStore } from "@/stores/flagStore";
import { resetPageStore } from "@/stores/pageStore";
import { SyncIndicator } from "./SyncIndicator";
import { UpdatePrompt } from "./UpdatePrompt";

const NAV_ITEMS: { to: string; key: string; end?: boolean }[] = [
  { to: "/", key: "nav.page", end: true },
  { to: "/priority", key: "nav.priority" },
  { to: "/journal", key: "nav.journal" },
  { to: "/flags", key: "nav.flags" },
  { to: "/settings", key: "nav.settings" },
];

export function Layout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  useTheme(); // applies the stored theme and follows OS changes
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;
  // The user whose local data is ready (owner checked, another user's data wiped).
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const ready = ownerSub !== null && readyFor === ownerSub;

  useEffect(() => {
    if (!ownerSub) return;
    let cancelled = false;
    void prepareSession(ownerSub)
      .then((outcome) => {
        if (outcome === "wiped" || outcome === "cleaned") {
          resetPageStore();
          resetFlagStore();
        }
      })
      .catch((e) => console.error("[bacuyy] could not prepare the local data", e))
      .finally(() => {
        if (!cancelled) setReadyFor(ownerSub);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerSub]);

  useGratitudeAutoCreate(ownerSub, ready);

  // Sync runs while a user is signed in (cached session: works offline, syncs when online).
  useEffect(() => {
    if (!ready) return;
    startSync(() => true);
    return () => void stopSync();
  }, [ready]);

  // Another tab signed out and wiped the local data: start over from the sign-in screen.
  useEffect(
    () =>
      subscribe((event, fromOtherTab) => {
        if (event.type === "signedOut" && fromOtherTab) window.location.reload();
      }),
    [],
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <span className="font-semibold">{t("app.name")}</span>
        <nav aria-label={t("nav.main")} className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) =>
                [
                  "rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                  isActive || (item.to === "/" && LINE_PATHS.includes(pathname))
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                ].join(" ")
              }
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <SyncIndicator />
      </header>
      <main className="flex-1 pb-8">
        {ready && <Outlet />}
      </main>
      <UpdatePrompt />
    </div>
  );
}
