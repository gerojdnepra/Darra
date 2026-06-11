export type PayloadBudgetState = "SAFE" | "WARNING" | "CRITICAL";
export type PerformanceState = "HEALTHY" | "STRESSED" | "DEGRADED";

export interface FrameSectionSize {
  section: string;
  bytes: number;
  kb: number;
}

export interface PersistenceQueueTelemetry {
  queueSize: number;
  queueCapacity: number;
  queueUsageRatio: number;
  droppedEventsCount: number;
  lastDroppedEventAt: number | null;
  lastFlushAt: number | null;
  lastFlushMs?: number;
  flushErrorsCount: number;
  lastFlushErrorMessage: string | null;
  lastFlushErrorAt: number | null;
  duplicateSignalCount: number;
  lastDuplicateSignalAt: number | null;
}

export interface FrameBuildStagesTelemetry {
  rawAssembly: number;
  rowsProjection: number;
  compactEncoding: number;
  deltaDiff: number;
  telemetryMeasurement: number;
  postBuildObservers: number;
  sendPrep: number;
}

export interface FrameTelemetryState {
  frameBuildMs: number;
  frameBuildStagesMs: FrameBuildStagesTelemetry;
  frameSerializeMs: number;
  patchSizeBytes: number;
  patchSizeKb: number;
  frameSizeBytes: number;
  frameSizeKb: number;
  fullFrameSizeBytes: number;
  fullFrameSizeKb: number;
  projectedFrameSizeBytes: number;
  projectedFrameSizeKb: number;
  suppressedFrameSizeBytes: number;
  suppressedFrameSizeKb: number;
  savedBytes: number;
  savedKb: number;
  suppressionRatio: number;
  requestedSections: string[];
  skippedSections: string[];
  computedSections: string[];
  skippedComputeSections: string[];
  sectionComputeMs: Record<string, number>;
  sectionCacheStatus: Record<string, "hit" | "miss" | "uncached">;
  sectionCacheAgeMs: Record<string, number>;
  sectionCacheTtlMs: Record<string, number>;
  skippedByTtlSections: string[];
  projectionMode: "none" | "default" | "visible_sections";
  deltaEnabled: boolean;
  snapshotFramesSent: number;
  patchFramesSent: number;
  averagePatchSizeKb: number;
  savedByDeltaKb: number;
  deltaRatio: number;
  payloadBudgetState: PayloadBudgetState;
  performanceState: PerformanceState;
  clientsConnected: number;
  enabledClients: number;
  sendIntervalMs: number;
  broadcastFrameTotalMs?: number;
  payloadSuppressionMs?: number;
  websocketSendMs?: number;
  sqliteQueryMs?: number;
  signalFlushMs?: number;
  deltaRowsMs?: number;
  deltaSectionCompareMs?: number;
  deltaPatchMeasureMs?: number;
  deltaFullMeasureMs?: number;
  deltaRowsFastPathHit?: boolean;
  deltaComparedSectionsCount?: number;
  deltaChangedSectionsCount?: number;
  rawRowsBuildMs?: number;
  rawTradeFlowMs?: number;
  rawLiquidationsMs?: number;
  rawReturnSeriesMs?: number;
  rawVarMs?: number;
  rawTagsMs?: number;
  rawPerSymbolOtherMs?: number;
  rawRowsSortMs?: number;
  rawCorrelationMs?: number;
  rawRiskScoreApplyMs?: number;
  rawOverviewMs?: number;
  rawAlertsMs?: number;
  rawMilestonesMs?: number;
  averageFrameSizeKb: number;
  largestFrameObservedKb: number;
  sectionSizesSampled?: boolean;
  sectionSizesAgeMs?: number;
  persistenceQueue: PersistenceQueueTelemetry;
  sectionSizes: FrameSectionSize[];
  largestSections: FrameSectionSize[];
}
