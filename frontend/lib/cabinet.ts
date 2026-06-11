import type { CabinetProfile, CabinetSession } from "./types";

export const createGuestSession = (): CabinetSession => ({
  mode: "guest",
  profileId: null
});

export const normalizeBinanceHandle = (value: string): string =>
  value.trim().replace(/^@+/, "").replace(/\s+/g, "").toUpperCase();

export const createCabinetProfileId = (binanceHandle: string): string =>
  normalizeBinanceHandle(binanceHandle).toLowerCase();

export const createCabinetQrSeed = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const createCabinetProfile = ({
  existingProfile,
  profileName,
  binanceHandle
}: {
  existingProfile?: CabinetProfile | null;
  profileName: string;
  binanceHandle: string;
}): CabinetProfile => {
  const normalizedHandle = normalizeBinanceHandle(binanceHandle);
  const trimmedName = profileName.trim();
  const now = Date.now();

  if (existingProfile) {
    return {
      ...existingProfile,
      profileName: trimmedName || existingProfile.profileName,
      binanceHandle: normalizedHandle,
      updatedAt: now,
      lastLoginAt: now
    };
  }

  return {
    id: createCabinetProfileId(normalizedHandle),
    profileName: trimmedName || normalizedHandle,
    binanceHandle: normalizedHandle,
    loginMethod: "binance-qr",
    qrSeed: createCabinetQrSeed(),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };
};

export const buildCabinetQrPayload = ({
  profileName,
  binanceHandle,
  qrSeed
}: {
  profileName: string;
  binanceHandle: string;
  qrSeed: string;
}): string =>
  `scalpstation://binance-qr-login?handle=${encodeURIComponent(
    normalizeBinanceHandle(binanceHandle)
  )}&profile=${encodeURIComponent(profileName.trim())}&seed=${encodeURIComponent(qrSeed)}`;

export const sortCabinetProfiles = (profiles: CabinetProfile[]): CabinetProfile[] =>
  [...profiles].sort((left, right) => {
    if (right.lastLoginAt !== left.lastLoginAt) {
      return right.lastLoginAt - left.lastLoginAt;
    }

    return right.updatedAt - left.updatedAt;
  });
