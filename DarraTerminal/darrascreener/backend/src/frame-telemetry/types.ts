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
  lastFlushAt: number | null;
  flushErrorsCount: number;
}

export interface FrameTelemetryState {
  frameSizeBytes: number;
  frameSizeKb: number;
  fullFrameSizeBytes: number;
  fullFrameSizeKb: number;
  suppressedFrameSizeBytes: number;
  suppressedFrameSizeKb: number;
  savedBytes: number;
  savedKb: number;
  suppressionRatio: number;
  deltaEnabled: boolean;
  snapshotFramesSent: number;
  patchFramesSent: number;
  averagePatchSizeKb: number;
  savedByDeltaKb: number;
  deltaRatio: number;
  payloadBudgetState: PayloadBudgetState;
  performanceState: PerformanceState;
  clientsConnected: number;
  sendIntervalMs: number;
  averageFrameSizeKb: number;
  largestFrameObservedKb: number;
  persistenceQueue: PersistenceQueueTelemetry;
  sectionSizes: FrameSectionSize[];
  largestSections: FrameSectionSize[];
}
