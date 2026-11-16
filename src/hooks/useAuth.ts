import { useSyncExternalStore } from "react";
import { Hub } from "aws-amplify/utils";
import { getCurrentUser, signOut as amplifySignOut } from "aws-amplify/auth";
import { kvGetJson, kvRemove, kvSetJson } from "@/lib/kv";

/**
 * Auth state for the guard and the screens.
 *
 * Offline rule (CLAUDE.md, "Auth and offline"): the guard decides from the cached session,
 * never from a network call. `getCurrentUser()` reads the cached tokens, but it can still fail
 * offline when it tries to refresh an expired token. In that case the last signed-in user,
 * remembered in localStorage, keeps the app open; sync waits until tokens refresh.
 */
export interface AuthUser {
  userId: string; // Cognito sub
  username: string;
  email: string | null;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: AuthUser; offline: boolean };

const LAST_USER_KEY = "lastUser";

let state: AuthState = { status: "loading" };
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isNetworkError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return (
    name === "NetworkError" ||
    name === "TypeError" || // fetch failed
    globalThis.navigator?.onLine === false
  );
}

/** Reads the cached session and updates the state. Safe to call repeatedly. */
export async function refreshAuth(): Promise<AuthState> {
  try {
    const u = await getCurrentUser();
    const user: AuthUser = {
      userId: u.userId,
      username: u.username,
      email: u.signInDetails?.loginId ?? null,
    };
    kvSetJson(LAST_USER_KEY, user);
    setState({ status: "signedIn", user, offline: false });
  } catch (e) {
    const last = kvGetJson<AuthUser | null>(LAST_USER_KEY, null);
    if (last && isNetworkError(e)) {
      setState({ status: "signedIn", user: last, offline: true });
    } else {
      setState({ status: "signedOut" });
    }
  }
  return state;
}

export async function signOut(): Promise<void> {
  try {
    await amplifySignOut();
  } finally {
    // The local data is wiped by the caller first (components/AccountSection.tsx, SignOut).
    kvRemove(LAST_USER_KEY);
    setState({ status: "signedOut" });
  }
}

let started = false;

/** Starts listening to Amplify auth events once and reads the cached session. */
export function startAuth() {
  if (started) return;
  started = true;
  Hub.listen("auth", ({ payload }) => {
    if (payload.event === "signedIn" || payload.event === "tokenRefresh") void refreshAuth();
    if (payload.event === "signedOut") {
      kvRemove(LAST_USER_KEY);
      setState({ status: "signedOut" });
    }
  });
  void refreshAuth();
}

/** Test helper: reset the module state between tests. */
export function resetAuthForTests(next: AuthState = { status: "loading" }) {
  started = false;
  state = next;
  listeners.forEach((l) => l());
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
