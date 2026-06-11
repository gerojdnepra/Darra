export type UiHealthState = "HEALTHY" | "STRESSED" | "DEGRADED";

export interface RenderTelemetryState {
  fps: number;
  averageRenderMs: number;
  maxRenderMs: number;
  averagePatchMergeMs: number;
  maxPatchMergeMs: number;
  droppedFrames: number;
  lastFrameAgeMs: number;
  uiHealth: UiHealthState;
}

const fpsWindowMs = 5_000;
const sampleWindowLimit = 120;
const publishIntervalMs = 500;

const initialState: RenderTelemetryState = {
  fps: 0,
  averageRenderMs: 0,
  maxRenderMs: 0,
  averagePatchMergeMs: 0,
  maxPatchMergeMs: 0,
  droppedFrames: 0,
  lastFrameAgeMs: 0,
  uiHealth: "HEALTHY"
};

const average = (values: number[]): number =>
  values.length === 0
    ? 0
    : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));

const max = (values: number[]): number =>
  values.length === 0 ? 0 : Number(Math.max(...values).toFixed(2));

const resolveUiHealth = (fps: number, lastFrameAgeMs: number): UiHealthState => {
  if (fps < 30 || lastFrameAgeMs > 5_000) {
    return "DEGRADED";
  }

  if (fps <= 50 || (fps < 90 && lastFrameAgeMs > 1_500) || lastFrameAgeMs > 3_000) {
    return "STRESSED";
  }

  return "HEALTHY";
};

class RenderTelemetryController {
  private state = initialState;
  private subscribers = new Set<() => void>();
  private fpsSamples: number[] = [];
  private renderSamples: number[] = [];
  private patchMergeSamples: number[] = [];
  private droppedFrames = 0;
  private renderPending = false;
  private renderStartAt: number | null = null;
  private lastFrameGeneratedAt: number | null = null;
  private frameHandle: number | null = null;
  private lastPublishedAt = 0;

  getSnapshot(): RenderTelemetryState {
    return this.state;
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    this.start();

    return () => {
      this.subscribers.delete(callback);

      if (this.subscribers.size === 0) {
        this.stop();
      }
    };
  }

  markFrameUpdateStarted(frameGeneratedAt: number | null): void {
    if (typeof performance === "undefined") {
      return;
    }

    if (this.renderPending) {
      this.droppedFrames += 1;
    }

    this.renderPending = true;
    this.renderStartAt = performance.now();

    if (typeof frameGeneratedAt === "number" && Number.isFinite(frameGeneratedAt)) {
      this.lastFrameGeneratedAt = frameGeneratedAt;
    }
  }

  markRenderCommitted(frameGeneratedAt: number | null): void {
    if (typeof performance === "undefined" || !this.renderPending) {
      return;
    }

    const now = performance.now();

    if (this.renderStartAt !== null) {
      this.pushSample(this.renderSamples, now - this.renderStartAt);
    }

    if (typeof frameGeneratedAt === "number" && Number.isFinite(frameGeneratedAt)) {
      this.lastFrameGeneratedAt = frameGeneratedAt;
    }

    this.renderPending = false;
    this.renderStartAt = null;
    this.publish(now);
  }

  recordPatchMerge(durationMs: number): void {
    this.pushSample(this.patchMergeSamples, durationMs);
  }

  private pushSample(target: number[], value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    target.push(value);

    if (target.length > sampleWindowLimit) {
      target.splice(0, target.length - sampleWindowLimit);
    }
  }

  private start(): void {
    if (typeof window === "undefined" || this.frameHandle !== null) {
      return;
    }

    const tick = (timestamp: number) => {
      this.fpsSamples.push(timestamp);

      while (this.fpsSamples.length > 0 && timestamp - this.fpsSamples[0] > fpsWindowMs) {
        this.fpsSamples.shift();
      }

      if (timestamp - this.lastPublishedAt >= publishIntervalMs) {
        this.publish(timestamp);
      }

      this.frameHandle = window.requestAnimationFrame(tick);
    };

    this.frameHandle = window.requestAnimationFrame(tick);
  }

  private stop(): void {
    if (typeof window === "undefined" || this.frameHandle === null) {
      return;
    }

    window.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private publish(now: number): void {
    const fps =
      this.fpsSamples.length > 1
        ? Number(((this.fpsSamples.length - 1) / fpsWindowMs * 1_000).toFixed(1))
        : 0;
    const lastFrameAgeMs =
      this.lastFrameGeneratedAt === null ? 0 : Math.max(Date.now() - this.lastFrameGeneratedAt, 0);

    this.state = {
      fps,
      averageRenderMs: average(this.renderSamples),
      maxRenderMs: max(this.renderSamples),
      averagePatchMergeMs: average(this.patchMergeSamples),
      maxPatchMergeMs: max(this.patchMergeSamples),
      droppedFrames: this.droppedFrames,
      lastFrameAgeMs,
      uiHealth: resolveUiHealth(fps, lastFrameAgeMs)
    };
    this.lastPublishedAt = now;

    for (const subscriber of this.subscribers) {
      subscriber();
    }
  }
}

export const renderTelemetry = new RenderTelemetryController();
