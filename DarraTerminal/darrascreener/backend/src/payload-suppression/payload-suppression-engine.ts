import type { ScreenerFrame } from "../types/messages";
import type { PayloadSectionName, PayloadSuppressionMetrics, PayloadSuppressionResult } from "./types";

const bytesPerKb = 1024;
const alwaysIncludedSections = new Set<PayloadSectionName>([
  "type",
  "generatedAt",
  "settings",
  "status",
  "overview"
]);

const toKb = (bytes: number): number => Number((bytes / bytesPerKb).toFixed(2));

const measureBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");

const buildSectionByteMap = (frame: ScreenerFrame): Map<string, number> => {
  const sectionBytes = new Map<string, number>();

  for (const section of frame.frameTelemetry?.sectionSizes ?? []) {
    sectionBytes.set(section.section, section.bytes);
  }

  return sectionBytes;
};

const resolveSuppressionMetrics = (
  frame: ScreenerFrame,
  visibleSections: ReadonlySet<string> | null
): PayloadSuppressionMetrics => {
  const fullFrameSizeBytes =
    frame.frameTelemetry?.frameSizeBytes ?? frame.frameTelemetry?.fullFrameSizeBytes ?? measureBytes(frame);
  const sectionBytes = buildSectionByteMap(frame);
  let savedBytes = 0;

  if (visibleSections) {
    for (const [section, bytes] of sectionBytes.entries()) {
      if (alwaysIncludedSections.has(section as PayloadSectionName)) {
        continue;
      }

      if (!visibleSections.has(section)) {
        savedBytes += bytes;
      }
    }
  }

  const suppressedFrameSizeBytes = Math.max(fullFrameSizeBytes - savedBytes, 0);

  return {
    fullFrameSizeBytes,
    fullFrameSizeKb: toKb(fullFrameSizeBytes),
    suppressedFrameSizeBytes,
    suppressedFrameSizeKb: toKb(suppressedFrameSizeBytes),
    savedBytes,
    savedKb: toKb(savedBytes),
    suppressionRatio:
      fullFrameSizeBytes > 0
        ? Number((suppressedFrameSizeBytes / fullFrameSizeBytes).toFixed(4))
        : 1
  };
};

export class PayloadSuppressionEngine {
  build(
    frame: ScreenerFrame,
    visibleSections: ReadonlySet<string> | null
  ): PayloadSuppressionResult {
    if (!visibleSections) {
      const metrics = resolveSuppressionMetrics(frame, null);

      return {
        frame,
        metrics
      };
    }

    const metrics = resolveSuppressionMetrics(frame, visibleSections);
    const projectedFrame: PayloadSuppressionResult["frame"] = {
      type: frame.type,
      generatedAt: frame.generatedAt
    };

    for (const [section, value] of Object.entries(frame) as Array<[PayloadSectionName, unknown]>) {
      if (
        alwaysIncludedSections.has(section) ||
        visibleSections.has(section)
      ) {
        (projectedFrame as Record<string, unknown>)[section] = value;
      }
    }

    if (projectedFrame.frameTelemetry) {
      projectedFrame.frameTelemetry = {
        ...projectedFrame.frameTelemetry,
        fullFrameSizeBytes: metrics.fullFrameSizeBytes,
        fullFrameSizeKb: metrics.fullFrameSizeKb,
        suppressedFrameSizeBytes: metrics.suppressedFrameSizeBytes,
        suppressedFrameSizeKb: metrics.suppressedFrameSizeKb,
        savedBytes: metrics.savedBytes,
        savedKb: metrics.savedKb,
        suppressionRatio: metrics.suppressionRatio
      };
    }

    return {
      frame: projectedFrame,
      metrics
    };
  }
}
