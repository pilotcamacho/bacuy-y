import type { ReactNode } from "react";
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { startAuth, useAuth } from "@/hooks/useAuth";

/** Guard for app screens: decides from the cached session (works offline). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  useEffect(() => startAuth(), []);

  if (auth.status === "loading") return null;
  if (auth.status === "signedOut") {
    return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Guard for auth screens: a signed-in user goes straight to the page. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => startAuth(), []);

  if (auth.status === "loading") return null;
  if (auth.status === "signedIn") return <Navigate to="/" replace />;
  return <>{children}</>;
}
