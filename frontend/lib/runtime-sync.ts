import type { CabinetProfile, CabinetSession, PersistedState } from "./types";

export interface RuntimeSyncPayload {
  type: "state";
  sourceId: string;
  profile: CabinetProfile | null;
  session: CabinetSession;
  state: PersistedState;
}

export const runtimeSyncChannelName = "scalpstation-runtime-sync-v1";

export const createRuntimeSyncSourceId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `window-${Date.now()}-${Math.random().toString(36).slice(2)}`;
