import type { SignalBillboardPreferences } from "@/lib/types";

export const signalBillboardTopSizeRange = {
  min: 10,
  max: 28
} as const;

export const signalBillboardBottomSizeRange = {
  min: 0,
  max: 20
} as const;

export const signalBillboardFrameHeightRange = {
  min: 5,
  max: 12
} as const;

export const signalBillboardOpacityRange = {
  min: 0,
  max: 100
} as const;

export const defaultSignalBillboardPreferences: SignalBillboardPreferences = {
  topBandSize: 16,
  bottomBandSize: 0,
  frameHeightPercent: 7,
  topBandOpacity: 88,
  bottomBandOpacity: 0
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const coerceNumber = (value: number | null | undefined, fallback: number): number =>
  Number.isFinite(value) ? Number(value) : fallback;

export const normalizeSignalBillboardPreferences = (
  value: Partial<SignalBillboardPreferences> | null | undefined
): SignalBillboardPreferences => ({
  topBandSize: clampNumber(
    coerceNumber(value?.topBandSize, defaultSignalBillboardPreferences.topBandSize),
    signalBillboardTopSizeRange.min,
    signalBillboardTopSizeRange.max
  ),
  bottomBandSize: clampNumber(
    coerceNumber(value?.bottomBandSize, defaultSignalBillboardPreferences.bottomBandSize),
    signalBillboardBottomSizeRange.min,
    signalBillboardBottomSizeRange.max
  ),
  frameHeightPercent: clampNumber(
    coerceNumber(
      value?.frameHeightPercent,
      defaultSignalBillboardPreferences.frameHeightPercent
    ),
    signalBillboardFrameHeightRange.min,
    signalBillboardFrameHeightRange.max
  ),
  topBandOpacity: clampNumber(
    coerceNumber(value?.topBandOpacity, defaultSignalBillboardPreferences.topBandOpacity),
    signalBillboardOpacityRange.min,
    signalBillboardOpacityRange.max
  ),
  bottomBandOpacity: clampNumber(
    coerceNumber(value?.bottomBandOpacity, defaultSignalBillboardPreferences.bottomBandOpacity),
    signalBillboardOpacityRange.min,
    signalBillboardOpacityRange.max
  )
});

export const computeSignalBillboardFrameHeightPx = (
  value: Partial<SignalBillboardPreferences> | null | undefined,
  options: {
    referenceHeight?: number;
    minPx?: number;
    maxPx?: number;
  } = {}
): number => {
  const normalized = normalizeSignalBillboardPreferences(value);
  const referenceHeight = coerceNumber(options.referenceHeight, 1080);
  const minPx = coerceNumber(options.minPx, 56);
  const maxPx = coerceNumber(options.maxPx, 108);

  return clampNumber(
    Math.round((referenceHeight * normalized.frameHeightPercent) / 100),
    minPx,
    maxPx
  );
};
