import type { ScreenerFrame } from "../types/messages";
import type { PayloadSectionName, PayloadSuppressionMetrics, PayloadSuppressionResult } from "./types";

const bytesPerKb = 1024;
const alwaysIncludedSections = new Set<PayloadSectionName>([
  "type",
  "generatedAt",
  "settings",
  "status",
  "overview",
  "alerts",
  "unifiedSignals",
  "frameTelemetry"
]);
const defaultProjectedSections = new Set<string>(["rows", "risk"]);
const sectionAliases = new Map<string, string[]>([
  ["screener", ["rows"]],
  ["activeTrades", ["rows"]],
  ["watchlist", ["rows"]],
  ["account", ["risk", "portfolioAnalytics"]],
  ["riskCenter", ["risk"]],
  ["correlationHeatmap", ["risk"]],
  ["varPanel", ["risk"]],
  ["fundingBasis", ["funding", "fundingSorted"]],
  ["chartPanel", ["rows", "chartCandles", "marketFlow", "funding", "liquidations", "positionRiskOrchestrator"]],
  ["decisionStack", ["rows", "marketFlow", "funding", "liquidations", "positionRiskOrchestrator", "status"]],
  ["symbolDetailRail", ["rows", "marketFlow", "funding", "liquidations", "positionRiskOrchestrator", "alerts", "unifiedSignals", "status"]],
  ["marketStory", ["rows", "marketFlow", "funding", "liquidations"]],
  ["marketFlow", ["marketFlow", "liquidations", "regime"]],
  ["signalIntelligence", ["signalIntelligence"]],
  ["metaRegimeGovernor", ["metaRegimeGovernor"]],
  ["positionRiskOrchestrator", ["positionRiskOrchestrator"]],
  ["regimeMemory", ["regimeMemory"]],
  ["regimePrediction", ["regimePrediction"]],
  ["regimeFeedbackCalibration", ["regimeFeedbackCalibration"]],
  ["pnlAttribution", ["portfolioAnalytics"]],
  ["volumeMilestones", ["volumeMilestones"]],
  ["volumeThresholdMilestones", ["volumeThresholdMilestones"]],
  ["alerts", ["alerts", "unifiedSignals"]],
  ["unifiedSignals", ["unifiedSignals"]],
  ["frameTelemetry", ["frameTelemetry"]],
  ["health", ["status", "overview", "frameTelemetry"]],
  ["learning", ["learning"]],
  ["learningCenter", ["learning"]],
  ["journal", ["journal"]],
  ["tradeJournal", ["journal"]],
  ["statistics", ["statistics"]],
  ["signalStatistics", ["statistics"]],
  ["replay", ["replay"]]
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

export const resolveRequestedSections = (
  visibleSections: ReadonlySet<string> | null
): { sections: Set<string>; requestedSections: string[]; projectionMode: PayloadSuppressionMetrics["projectionMode"] } => {
  const requestedSections = Array.from(visibleSections ?? defaultProjectedSections).sort();
  const sections = new Set<string>(defaultProjectedSections);
  const projectionMode = visibleSections ? "visible_sections" : "default";

  if (visibleSections) {
    sections.clear();
  }

  for (const section of requestedSections) {
    sections.add(section);

    for (const aliasSection of sectionAliases.get(section) ?? []) {
      sections.add(aliasSection);
    }
  }

  for (const section of alwaysIncludedSections) {
    sections.add(section);
  }

  return {
    sections,
    requestedSections,
    projectionMode
  };
};

const resolveSuppressionMetrics = (
  frame: ScreenerFrame,
  projectedSections: ReadonlySet<string>,
  requestedSections: string[],
  projectionMode: PayloadSuppressionMetrics["projectionMode"]
): PayloadSuppressionMetrics => {
  const fullFrameSizeBytes =
    frame.frameTelemetry?.frameSizeBytes ?? frame.frameTelemetry?.fullFrameSizeBytes ?? measureBytes(frame);
  const sectionBytes = buildSectionByteMap(frame);
  let savedBytes = 0;
  const skippedSections: string[] = [];

  for (const [section, bytes] of sectionBytes.entries()) {
    if (alwaysIncludedSections.has(section as PayloadSectionName)) {
      continue;
    }

    if (!projectedSections.has(section)) {
      savedBytes += bytes;
      skippedSections.push(section);
    }
  }

  const projectedFrameSizeBytes = Math.max(fullFrameSizeBytes - savedBytes, 0);
  const suppressedFrameSizeBytes = projectedFrameSizeBytes;

  return {
    fullFrameSizeBytes,
    fullFrameSizeKb: toKb(fullFrameSizeBytes),
    projectedFrameSizeBytes,
    projectedFrameSizeKb: toKb(projectedFrameSizeBytes),
    suppressedFrameSizeBytes,
    suppressedFrameSizeKb: toKb(suppressedFrameSizeBytes),
    savedBytes,
    savedKb: toKb(savedBytes),
    suppressionRatio:
      fullFrameSizeBytes > 0
        ? Number((suppressedFrameSizeBytes / fullFrameSizeBytes).toFixed(4))
        : 1,
    requestedSections,
    skippedSections: skippedSections.sort(),
    projectionMode
  };
};

export class PayloadSuppressionEngine {
  build(
    frame: ScreenerFrame,
    visibleSections: ReadonlySet<string> | null
  ): PayloadSuppressionResult {
    const projection = resolveRequestedSections(visibleSections);
    const projectedFrame: PayloadSuppressionResult["frame"] = {
      type: frame.type,
      generatedAt: frame.generatedAt
    };

    for (const [section, value] of Object.entries(frame) as Array<[PayloadSectionName, unknown]>) {
      if (
        alwaysIncludedSections.has(section) ||
        projection.sections.has(section)
      ) {
        (projectedFrame as Record<string, unknown>)[section] = value;
      }
    }

    const metrics = resolveSuppressionMetrics(
      frame,
      projection.sections,
      projection.requestedSections,
      projection.projectionMode
    );

    if (projectedFrame.frameTelemetry) {
      projectedFrame.frameTelemetry = {
        ...projectedFrame.frameTelemetry,
        fullFrameSizeBytes: metrics.fullFrameSizeBytes,
        fullFrameSizeKb: metrics.fullFrameSizeKb,
        projectedFrameSizeBytes: metrics.projectedFrameSizeBytes,
        projectedFrameSizeKb: metrics.projectedFrameSizeKb,
        suppressedFrameSizeBytes: metrics.suppressedFrameSizeBytes,
        suppressedFrameSizeKb: metrics.suppressedFrameSizeKb,
        savedBytes: metrics.savedBytes,
        savedKb: metrics.savedKb,
        suppressionRatio: metrics.suppressionRatio,
        requestedSections: metrics.requestedSections,
        skippedSections: metrics.skippedSections,
        projectionMode: metrics.projectionMode
      };
    }

    return {
      frame: projectedFrame,
      metrics
    };
  }
}
