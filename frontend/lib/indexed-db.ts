import { openDB } from "idb";
import type { DarraWorkspaceState } from "./darra-workspace";
import type { CabinetProfile, CabinetProfileRecord, CabinetSession, PersistedState } from "./types";

const DB_NAME = "scalp-station";
const STORE_NAME = "ui";
const GUEST_STATE_KEY = "state";
const GUEST_DARRA_WORKSPACE_KEY = "darra-workspace";
const SESSION_KEY = "cabinet-session";

const profileMetaKey = (profileId: string): string => `profile:${profileId}:meta`;
const profileStateKey = (profileId: string): string => `profile:${profileId}:state`;
const profileDarraWorkspaceKey = (profileId: string): string =>
  `profile:${profileId}:darra-workspace`;

const getDb = () =>
  openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    }
  });

export const loadPersistedState = async (profileId?: string): Promise<PersistedState | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  const db = await getDb();
  const key = profileId ? profileStateKey(profileId) : GUEST_STATE_KEY;
  return ((await db.get(STORE_NAME, key)) as PersistedState | undefined) ?? null;
};

export const savePersistedState = async (
  state: PersistedState,
  profileId?: string
): Promise<void> => {
  if (typeof window === "undefined") {
    return;
  }

  const db = await getDb();
  const key = profileId ? profileStateKey(profileId) : GUEST_STATE_KEY;
  await db.put(STORE_NAME, state, key);
};

export const loadDarraWorkspace = async (
  profileId?: string
): Promise<DarraWorkspaceState | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  const db = await getDb();
  const key = profileId ? profileDarraWorkspaceKey(profileId) : GUEST_DARRA_WORKSPACE_KEY;
  return ((await db.get(STORE_NAME, key)) as DarraWorkspaceState | undefined) ?? null;
};

export const saveDarraWorkspace = async (
  workspace: DarraWorkspaceState,
  profileId?: string
): Promise<void> => {
  if (typeof window === "undefined") {
    return;
  }

  const db = await getDb();
  const key = profileId ? profileDarraWorkspaceKey(profileId) : GUEST_DARRA_WORKSPACE_KEY;
  await db.put(STORE_NAME, workspace, key);
};

export const loadCabinetSession = async (): Promise<CabinetSession | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  const db = await getDb();
  return ((await db.get(STORE_NAME, SESSION_KEY)) as CabinetSession | undefined) ?? null;
};

export const saveCabinetSession = async (session: CabinetSession): Promise<void> => {
  if (typeof window === "undefined") {
    return;
  }

  const db = await getDb();
  await db.put(STORE_NAME, session, SESSION_KEY);
};

export const loadCabinetProfileRecord = async (
  profileId: string
): Promise<CabinetProfileRecord | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  const db = await getDb();
  const [profile, state] = await Promise.all([
    db.get(STORE_NAME, profileMetaKey(profileId)),
    db.get(STORE_NAME, profileStateKey(profileId))
  ]);

  if (!profile || !state) {
    return null;
  }

  return {
    profile: profile as CabinetProfile,
    state: state as PersistedState
  };
};

export const saveCabinetProfileRecord = async (
  record: CabinetProfileRecord
): Promise<void> => {
  if (typeof window === "undefined") {
    return;
  }

  const db = await getDb();
  await Promise.all([
    db.put(STORE_NAME, record.profile, profileMetaKey(record.profile.id)),
    db.put(STORE_NAME, record.state, profileStateKey(record.profile.id))
  ]);
};

export const listCabinetProfiles = async (): Promise<CabinetProfile[]> => {
  if (typeof window === "undefined") {
    return [];
  }

  const db = await getDb();
  const [keys, values] = await Promise.all([db.getAllKeys(STORE_NAME), db.getAll(STORE_NAME)]);

  return values.filter((value, index): value is CabinetProfile => {
    const key = keys[index];

    return (
      typeof key === "string" &&
      key.startsWith("profile:") &&
      key.endsWith(":meta") &&
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "binanceHandle" in value
    );
  });
};
