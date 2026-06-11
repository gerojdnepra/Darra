import type {
  DashboardSettings,
  RevivingCoinAlertSettings,
  VolumeMilestoneSettings
} from "./types";

export const defaultRevivingCoinAlertSettings: RevivingCoinAlertSettings = {
  enabled: true,
  scanIntervalMinutes: 5,
  minCurrentQuoteVolume24h: 100_000_000,
  liquidityLookbackDays: 30,
  maxAverageDailyQuoteVolume: 10_000_000,
  noSignalLookbackDays: 30,
  useAverageVolumeCriterion: true,
  useNoSignalCriterion: true,
  requireAllDeadCriteria: false,
  alertCooldownHours: 24,
  soundEnabled: true,
  soundRepeatSeconds: 10
};

export const defaultVolumeMilestoneSettings: VolumeMilestoneSettings = {
  enabled: true,
  minQuoteVolume24h: 100_000_000
};

export const defaultDashboardSettings: DashboardSettings = {
  focusUniverseSize: 40,
  revivingCoins: defaultRevivingCoinAlertSettings,
  volumeMilestones: defaultVolumeMilestoneSettings,
  minimumQuoteVolume: 5_000_000,
  sortBy: "score",
  biasFilter: "ALL",
  showOnlyWatchlist: false
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(numericValue, min), max);
};

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

export const normalizeRevivingCoinAlertSettings = (
  value: Partial<RevivingCoinAlertSettings> | null | undefined,
  base: RevivingCoinAlertSettings = defaultRevivingCoinAlertSettings
): RevivingCoinAlertSettings => {
  const next = value ?? {};

  return {
    enabled: normalizeBoolean(next.enabled, base.enabled),
    scanIntervalMinutes: clampNumber(next.scanIntervalMinutes, 1, 240, base.scanIntervalMinutes),
    minCurrentQuoteVolume24h: clampNumber(
      next.minCurrentQuoteVolume24h,
      1_000_000,
      10_000_000_000,
      base.minCurrentQuoteVolume24h
    ),
    liquidityLookbackDays: Math.round(
      clampNumber(next.liquidityLookbackDays, 3, 120, base.liquidityLookbackDays)
    ),
    maxAverageDailyQuoteVolume: clampNumber(
      next.maxAverageDailyQuoteVolume,
      100_000,
      1_000_000_000,
      base.maxAverageDailyQuoteVolume
    ),
    noSignalLookbackDays: Math.round(
      clampNumber(next.noSignalLookbackDays, 1, 180, base.noSignalLookbackDays)
    ),
    useAverageVolumeCriterion: normalizeBoolean(
      next.useAverageVolumeCriterion,
      base.useAverageVolumeCriterion
    ),
    useNoSignalCriterion: normalizeBoolean(next.useNoSignalCriterion, base.useNoSignalCriterion),
    requireAllDeadCriteria: normalizeBoolean(next.requireAllDeadCriteria, base.requireAllDeadCriteria),
    alertCooldownHours: clampNumber(next.alertCooldownHours, 1, 24 * 30, base.alertCooldownHours),
    soundEnabled: normalizeBoolean(next.soundEnabled, base.soundEnabled),
    soundRepeatSeconds: clampNumber(next.soundRepeatSeconds, 2, 120, base.soundRepeatSeconds)
  };
};

export const normalizeVolumeMilestoneSettings = (
  value: Partial<VolumeMilestoneSettings> | null | undefined,
  base: VolumeMilestoneSettings = defaultVolumeMilestoneSettings
): VolumeMilestoneSettings => {
  const next = value ?? {};

  return {
    enabled: normalizeBoolean(next.enabled, base.enabled),
    minQuoteVolume24h: clampNumber(
      next.minQuoteVolume24h,
      1_000_000,
      10_000_000_000,
      base.minQuoteVolume24h
    )
  };
};

export const normalizeDashboardSettings = (
  value: Partial<DashboardSettings> | null | undefined,
  base: DashboardSettings = defaultDashboardSettings
): DashboardSettings => {
  const next = value ?? {};

  return {
    focusUniverseSize: Math.round(
      clampNumber(next.focusUniverseSize, 12, 90, base.focusUniverseSize)
    ),
    revivingCoins: normalizeRevivingCoinAlertSettings(next.revivingCoins, base.revivingCoins),
    volumeMilestones: normalizeVolumeMilestoneSettings(
      next.volumeMilestones,
      base.volumeMilestones
    ),
    minimumQuoteVolume: clampNumber(
      next.minimumQuoteVolume,
      0,
      10_000_000_000,
      base.minimumQuoteVolume
    ),
    sortBy: next.sortBy ?? base.sortBy,
    biasFilter: next.biasFilter ?? base.biasFilter,
    showOnlyWatchlist: normalizeBoolean(next.showOnlyWatchlist, base.showOnlyWatchlist)
  };
};
