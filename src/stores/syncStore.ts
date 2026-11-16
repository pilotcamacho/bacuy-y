import { create } from "zustand";
import type { SyncSnapshot } from "@/services/sync/syncEngine";

/** What the sync indicator shows. Written only by the sync engine (services/sync/index.ts). */
interface SyncState extends SyncSnapshot {
  set(snapshot: SyncSnapshot): void;
}

const INITIAL: SyncSnapshot = { status: "synced", reason: null, lastSyncedAt: null, dirty: 0 };

export const useSyncStore = create<SyncState>((set) => ({
  ...INITIAL,
  set: (snapshot) => set(snapshot),
}));

export function resetSyncStore() {
  useSyncStore.setState(INITIAL);
}

export const resetSyncStoreForTests = resetSyncStore;
