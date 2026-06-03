import type {
  FrameSectionSize,
  FrameTelemetryState,
  PersistenceQueueTelemetry,
  PayloadBudgetState,
  PerformanceState
} from "./types";

interface RuntimeMetrics {
  clientsConnected: number;
  sendIntervalMs: number;
  persistenceQueue: PersistenceQueueTelemetry;
}

interface FrameTelemetryEngineOptions {
  getRuntimeMetrics?: () => RuntimeMetrics;
}

const bytesPerKb = 1024;
const topSectionLimit = 10;

const toKb = (bytes: number): number => Number((bytes / bytesPerKb).toFixed(2));

const measureBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");

const resolvePayloadBudgetState = (frameSizeKb: number): PayloadBudgetState => {
  if (frameSizeKb < 250) {
    return "SAFE";
  }

  if (frameSizeKb <= 750) {
    return "WARNING";
  }

  return "CRITICAL";
};

const resolvePerformanceState = (payloadBudgetState: PayloadBudgetState): PerformanceState => {
  if (payloadBudgetState === "CRITICAL") {
    return "DEGRADED";
  }

  if (payloadBudgetState === "WARNING") {
    return "STRESSED";
  }

  return "HEALTHY";
};

const addLargestSection = (largestSections: FrameSectionSize[], section: FrameSectionSize): void => {
  let insertAt = largestSections.length;

  for (let index = 0; index < largestSections.length; index += 1) {
    const currentSection = largestSections[index];

    if (currentSection && section.bytes > currentSection.bytes) {
      insertAt = index;
      break;
    }
  }

  if (insertAt >= topSectionLimit) {
    return;
  }

  largestSections.splice(insertAt, 0, section);

  if (largestSections.length > topSectionLimit) {
    largestSections.pop();
  }
};

export class FrameTelemetryEngine {
  private framesObserved = 0;
  private totalFrameSizeKb = 0;
  private largestFrameObservedKb = 0;

  constructor(private readonly options: FrameTelemetryEngineOptions = {}) {}

  build(frame: Record<string, unknown>): FrameTelemetryState {
    const snapshot: Record<string, unknown> = {};
    const sectionSizes: FrameSectionSize[] = [];
    const largestSections: FrameSectionSize[] = [];

    for (const [section, value] of Object.entries(frame)) {
      if (section === "frameTelemetry" || typeof value === "undefined") {
        continue;
      }

      snapshot[section] = value;

      const bytes = measureBytes(value);
      const sectionSize = {
        section,
        bytes,
        kb: toKb(bytes)
      };

      sectionSizes.push(sectionSize);
      addLargestSection(largestSections, sectionSize);
    }

    const frameSizeBytes = measureBytes(snapshot);
    const frameSizeKb = toKb(frameSizeBytes);
    const payloadBudgetState = resolvePayloadBudgetState(frameSizeKb);
    const runtimeMetrics = this.options.getRuntimeMetrics?.() ?? {
      clientsConnected: 0,
      sendIntervalMs: 0,
      persistenceQueue: {
        queueSize: 0,
        queueCapacity: 0,
        queueUsageRatio: 0,
        droppedEventsCount: 0,
        lastFlushAt: null,
        flushErrorsCount: 0
      }
    };

    this.framesObserved += 1;
    this.totalFrameSizeKb += frameSizeKb;
    this.largestFrameObservedKb = Math.max(this.largestFrameObservedKb, frameSizeKb);

    return {
      frameSizeBytes,
      frameSizeKb,
      fullFrameSizeBytes: frameSizeBytes,
      fullFrameSizeKb: frameSizeKb,
      suppressedFrameSizeBytes: frameSizeBytes,
      suppressedFrameSizeKb: frameSizeKb,
      savedBytes: 0,
      savedKb: 0,
      suppressionRatio: 1,
      deltaEnabled: false,
      snapshotFramesSent: 0,
      patchFramesSent: 0,
      averagePatchSizeKb: 0,
      savedByDeltaKb: 0,
      deltaRatio: 1,
      payloadBudgetState,
      performanceState: resolvePerformanceState(payloadBudgetState),
      clientsConnected: runtimeMetrics.clientsConnected,
      sendIntervalMs: runtimeMetrics.sendIntervalMs,
      averageFrameSizeKb: Number((this.totalFrameSizeKb / this.framesObserved).toFixed(2)),
      largestFrameObservedKb: this.largestFrameObservedKb,
      persistenceQueue: runtimeMetrics.persistenceQueue,
      sectionSizes,
      largestSections
    };
  }
}
