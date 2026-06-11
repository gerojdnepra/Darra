import type {
  FrameSectionSize,
  FrameBuildStagesTelemetry,
  FrameTelemetryState,
  PersistenceQueueTelemetry,
  PayloadBudgetState,
  PerformanceState
} from "./types";

interface RuntimeMetrics {
  clientsConnected: number;
  enabledClients: number;
  sendIntervalMs: number;
  persistenceQueue: PersistenceQueueTelemetry;
  sqliteQueryMs?: number;
  signalFlushMs?: number;
}

interface FrameTelemetryEngineOptions {
  getRuntimeMetrics?: () => RuntimeMetrics;
}

interface FrameTelemetrySample {
  frameBuildMs?: number;
  frameBuildStagesMs?: Partial<FrameBuildStagesTelemetry>;
  frameSerializeMs?: number;
  patchSizeBytes?: number;
  requestedSections?: string[];
  computedSections?: string[];
  skippedComputeSections?: string[];
  sectionComputeMs?: Record<string, number>;
  sectionCacheStatus?: Record<string, "hit" | "miss" | "uncached">;
  sectionCacheAgeMs?: Record<string, number>;
  sectionCacheTtlMs?: Record<string, number>;
  skippedByTtlSections?: string[];
  sqliteQueryMs?: number;
  signalFlushMs?: number;
}

const bytesPerKb = 1024;
const topSectionLimit = 10;
const rollingFrameSizeWindow = 12;
const sectionMeasurementSampleIntervalMs = 2_000;

interface SampledFrameSectionMeasurement extends FrameSectionMeasurement {
  sampled: boolean;
  ageMs: number;
}

interface FrameSectionMeasurementCache {
  measuredAt: number;
  measurement: FrameSectionMeasurement;
}

const emptyFrameBuildStages = (): FrameBuildStagesTelemetry => ({
  rawAssembly: 0,
  rowsProjection: 0,
  compactEncoding: 0,
  deltaDiff: 0,
  telemetryMeasurement: 0,
  postBuildObservers: 0,
  sendPrep: 0
});

const toKb = (bytes: number): number => Number((bytes / bytesPerKb).toFixed(2));

const measureBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");

export const resolvePayloadBudgetState = (frameSizeKb: number): PayloadBudgetState => {
  if (frameSizeKb < 500) {
    return "SAFE";
  }

  if (frameSizeKb <= 1_000) {
    return "WARNING";
  }

  return "CRITICAL";
};

export const resolvePerformanceState = (
  payloadBudgetState: PayloadBudgetState,
  frameBuildMs = 0,
  stagePressureMs = 0
): PerformanceState => {
  if (payloadBudgetState === "CRITICAL") {
    return "DEGRADED";
  }

  if (frameBuildMs > 400) {
    return "DEGRADED";
  }

  if (payloadBudgetState === "WARNING" || frameBuildMs > 250 || stagePressureMs > 200) {
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

export interface FrameSectionMeasurement {
  frameSizeBytes: number;
  frameSizeKb: number;
  payloadBudgetState: PayloadBudgetState;
  performanceState: PerformanceState;
  sectionSizes: FrameSectionSize[];
  largestSections: FrameSectionSize[];
}

export const measureFrameSections = (frame: Record<string, unknown>): FrameSectionMeasurement => {
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

  return {
    frameSizeBytes,
    frameSizeKb,
    payloadBudgetState,
  performanceState: resolvePerformanceState(payloadBudgetState),
    sectionSizes,
    largestSections
  };
};

export class FrameTelemetryEngine {
  private readonly frameSizeSamplesKb: number[] = [];
  private largestFrameObservedKb = 0;
  private buildMeasurementCache: FrameSectionMeasurementCache | null = null;
  private compactMeasurementCache: FrameSectionMeasurementCache | null = null;

  constructor(private readonly options: FrameTelemetryEngineOptions = {}) {}

  private getSampledMeasurement(
    frame: Record<string, unknown>,
    cache: FrameSectionMeasurementCache | null,
    now = Date.now()
  ): { nextCache: FrameSectionMeasurementCache; measurement: SampledFrameSectionMeasurement } {
    if (cache && now - cache.measuredAt < sectionMeasurementSampleIntervalMs) {
      return {
        nextCache: cache,
        measurement: {
          ...cache.measurement,
          sampled: true,
          ageMs: Math.max(now - cache.measuredAt, 0)
        }
      };
    }

    const measurement = measureFrameSections(frame);
    const nextCache = {
      measuredAt: now,
      measurement
    };

    return {
      nextCache,
      measurement: {
        ...measurement,
        sampled: false,
        ageMs: 0
      }
    };
  }

  build(frame: Record<string, unknown>, sample: FrameTelemetrySample = {}): FrameTelemetryState {
    const sampledMeasurement = this.getSampledMeasurement(frame, this.buildMeasurementCache);
    this.buildMeasurementCache = sampledMeasurement.nextCache;
    const measurement = sampledMeasurement.measurement;
    const runtimeMetrics = this.options.getRuntimeMetrics?.() ?? {
      clientsConnected: 0,
      enabledClients: 0,
      sendIntervalMs: 0,
      persistenceQueue: {
        queueSize: 0,
        queueCapacity: 0,
        queueUsageRatio: 0,
        droppedEventsCount: 0,
        lastDroppedEventAt: null,
        lastFlushAt: null,
        flushErrorsCount: 0,
        lastFlushErrorMessage: null,
        lastFlushErrorAt: null,
        duplicateSignalCount: 0,
        lastDuplicateSignalAt: null
      }
    };

    this.frameSizeSamplesKb.push(measurement.frameSizeKb);
    if (this.frameSizeSamplesKb.length > rollingFrameSizeWindow) {
      this.frameSizeSamplesKb.splice(0, this.frameSizeSamplesKb.length - rollingFrameSizeWindow);
    }
    this.largestFrameObservedKb = Math.max(this.largestFrameObservedKb, measurement.frameSizeKb);
    const averageFrameSizeKb =
      this.frameSizeSamplesKb.length > 0
        ? Number(
            (
              this.frameSizeSamplesKb.reduce((sum, value) => sum + value, 0) /
              this.frameSizeSamplesKb.length
            ).toFixed(2)
          )
        : measurement.frameSizeKb;

    const frameBuildStagesMs = {
      ...emptyFrameBuildStages(),
      ...(sample.frameBuildStagesMs ?? {})
    };
    const stagePressureMs = Math.max(
      frameBuildStagesMs.rawAssembly,
      frameBuildStagesMs.rowsProjection,
      frameBuildStagesMs.compactEncoding,
      frameBuildStagesMs.deltaDiff,
      frameBuildStagesMs.telemetryMeasurement,
      frameBuildStagesMs.postBuildObservers,
      frameBuildStagesMs.sendPrep
    );

    return {
      frameBuildMs: sample.frameBuildMs ?? 0,
      frameBuildStagesMs,
      frameSerializeMs: sample.frameSerializeMs ?? 0,
      patchSizeBytes: sample.patchSizeBytes ?? 0,
      patchSizeKb: toKb(sample.patchSizeBytes ?? 0),
      frameSizeBytes: measurement.frameSizeBytes,
      frameSizeKb: measurement.frameSizeKb,
      fullFrameSizeBytes: measurement.frameSizeBytes,
      fullFrameSizeKb: measurement.frameSizeKb,
      projectedFrameSizeBytes: measurement.frameSizeBytes,
      projectedFrameSizeKb: measurement.frameSizeKb,
      suppressedFrameSizeBytes: measurement.frameSizeBytes,
      suppressedFrameSizeKb: measurement.frameSizeKb,
      savedBytes: 0,
      savedKb: 0,
      suppressionRatio: 1,
      requestedSections: sample.requestedSections ?? [],
      skippedSections: [],
      computedSections: sample.computedSections ?? [],
      skippedComputeSections: sample.skippedComputeSections ?? [],
      sectionComputeMs: sample.sectionComputeMs ?? {},
      sectionCacheStatus: sample.sectionCacheStatus ?? {},
      sectionCacheAgeMs: sample.sectionCacheAgeMs ?? {},
      sectionCacheTtlMs: sample.sectionCacheTtlMs ?? {},
      skippedByTtlSections: sample.skippedByTtlSections ?? [],
      projectionMode: "none",
      deltaEnabled: false,
      snapshotFramesSent: 0,
      patchFramesSent: 0,
      averagePatchSizeKb: 0,
      savedByDeltaKb: 0,
      deltaRatio: 1,
      payloadBudgetState: measurement.payloadBudgetState,
      performanceState: resolvePerformanceState(
        measurement.payloadBudgetState,
        sample.frameBuildMs ?? 0,
        stagePressureMs
      ),
      clientsConnected: runtimeMetrics.clientsConnected,
      enabledClients: runtimeMetrics.enabledClients,
      sendIntervalMs: runtimeMetrics.sendIntervalMs,
      ...(runtimeMetrics.sqliteQueryMs !== undefined ? { sqliteQueryMs: runtimeMetrics.sqliteQueryMs } : {}),
      ...(runtimeMetrics.signalFlushMs !== undefined ? { signalFlushMs: runtimeMetrics.signalFlushMs } : {}),
      averageFrameSizeKb,
      largestFrameObservedKb: this.largestFrameObservedKb,
      sectionSizesSampled: measurement.sampled,
      sectionSizesAgeMs: measurement.ageMs,
      persistenceQueue: runtimeMetrics.persistenceQueue,
      sectionSizes: measurement.sectionSizes,
      largestSections: measurement.largestSections
    };
  }

  updateCompactFrameSize(frameTelemetry: FrameTelemetryState, frame: Record<string, unknown>): void {
    const sampledMeasurement = this.getSampledMeasurement(frame, this.compactMeasurementCache);
    this.compactMeasurementCache = sampledMeasurement.nextCache;
    const measurement = sampledMeasurement.measurement;
    if (this.frameSizeSamplesKb.length > 0) {
      this.frameSizeSamplesKb[this.frameSizeSamplesKb.length - 1] = measurement.frameSizeKb;
    } else {
      this.frameSizeSamplesKb.push(measurement.frameSizeKb);
    }
    if (this.frameSizeSamplesKb.length > rollingFrameSizeWindow) {
      this.frameSizeSamplesKb.splice(0, this.frameSizeSamplesKb.length - rollingFrameSizeWindow);
    }
    this.largestFrameObservedKb = Math.max(this.largestFrameObservedKb, measurement.frameSizeKb);
    const averageFrameSizeKb =
      this.frameSizeSamplesKb.length > 0
        ? Number(
            (
              this.frameSizeSamplesKb.reduce((sum, value) => sum + value, 0) /
              this.frameSizeSamplesKb.length
            ).toFixed(2)
          )
        : measurement.frameSizeKb;
    const maxStageMs = Math.max(...Object.values(frameTelemetry.frameBuildStagesMs));

    Object.assign(frameTelemetry, {
      frameSizeBytes: measurement.frameSizeBytes,
      frameSizeKb: measurement.frameSizeKb,
      projectedFrameSizeBytes: measurement.frameSizeBytes,
      projectedFrameSizeKb: measurement.frameSizeKb,
      suppressedFrameSizeBytes: measurement.frameSizeBytes,
      suppressedFrameSizeKb: measurement.frameSizeKb,
      payloadBudgetState: measurement.payloadBudgetState,
      performanceState: resolvePerformanceState(
        measurement.payloadBudgetState,
        frameTelemetry.frameBuildMs,
        maxStageMs
      ),
      sectionSizes: measurement.sectionSizes,
      largestSections: measurement.largestSections,
      averageFrameSizeKb,
      largestFrameObservedKb: this.largestFrameObservedKb,
      sectionSizesSampled: measurement.sampled,
      sectionSizesAgeMs: measurement.ageMs
    });
  }
}
