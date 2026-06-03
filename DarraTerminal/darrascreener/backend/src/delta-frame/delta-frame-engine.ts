import type {
  DeltaFrameClientState,
  DeltaFramePayload,
  DeltaFrameTelemetryMetrics,
  FramePatchMessage,
  FrameSnapshotMessage,
  ProjectedFrame
} from "./types";

const bytesPerKb = 1024;

const toKb = (bytes: number): number => Number((bytes / bytesPerKb).toFixed(2));

const measureBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");

const createTelemetryMetrics = (
  state: DeltaFrameClientState,
  fullPayloadSizeKb: number,
  actualPayloadSizeKb: number
): DeltaFrameTelemetryMetrics => {
  const savedByDeltaKb = Math.max(fullPayloadSizeKb - actualPayloadSizeKb, 0);
  const totalSavedByDeltaKb = state.totalSavedByDeltaKb + savedByDeltaKb;
  const patchFramesSent = state.patchFramesSent;

  return {
    deltaEnabled: true,
    snapshotFramesSent: state.snapshotFramesSent,
    patchFramesSent,
    averagePatchSizeKb:
      patchFramesSent > 0 ? Number((state.totalPatchSizeKb / patchFramesSent).toFixed(2)) : 0,
    savedByDeltaKb: Number(totalSavedByDeltaKb.toFixed(2)),
    deltaRatio:
      fullPayloadSizeKb > 0 ? Number((actualPayloadSizeKb / fullPayloadSizeKb).toFixed(4)) : 1
  };
};

const applyTelemetryMetrics = (
  frame: ProjectedFrame,
  metrics: DeltaFrameTelemetryMetrics
): void => {
  if (!frame.frameTelemetry) {
    return;
  }

  frame.frameTelemetry = {
    ...frame.frameTelemetry,
    ...metrics
  };
};

const cloneProjectedFrame = (frame: ProjectedFrame): ProjectedFrame => {
  const nextFrame: ProjectedFrame = { ...frame };

  if (frame.frameTelemetry) {
    nextFrame.frameTelemetry = { ...frame.frameTelemetry };
  }

  return nextFrame;
};

export class DeltaFrameEngine {
  createClientState(): DeltaFrameClientState {
    return {
      lastSentFrame: null,
      snapshotFramesSent: 0,
      patchFramesSent: 0,
      totalPatchSizeKb: 0,
      totalSavedByDeltaKb: 0
    };
  }

  build(
    state: DeltaFrameClientState,
    projectedFrame: ProjectedFrame,
    options: { forceSnapshot?: boolean } = {}
  ): DeltaFramePayload {
    const nextFrame = cloneProjectedFrame(projectedFrame);
    const fullPayloadSizeKb = toKb(measureBytes({ type: "snapshot", frame: nextFrame }));

    if (!state.lastSentFrame || options.forceSnapshot) {
      state.snapshotFramesSent += 1;

      const snapshot: FrameSnapshotMessage = {
        type: "snapshot",
        frame: nextFrame
      };
      const snapshotSizeKb = toKb(measureBytes(snapshot));
      applyTelemetryMetrics(
        nextFrame,
        createTelemetryMetrics(state, fullPayloadSizeKb, snapshotSizeKb)
      );

      state.lastSentFrame = nextFrame;
      return snapshot;
    }

    const changed: Partial<ProjectedFrame> = {};

    for (const [section, value] of Object.entries(nextFrame) as Array<[keyof ProjectedFrame, unknown]>) {
      const previousValue = state.lastSentFrame[section];

      if (JSON.stringify(value) !== JSON.stringify(previousValue)) {
        (changed as Record<string, unknown>)[section as string] = value;
      }
    }

    let patch: FramePatchMessage = {
      type: "frame_patch",
      changed
    };
    let patchSizeKb = toKb(measureBytes(patch));

    state.patchFramesSent += 1;
    state.totalPatchSizeKb += patchSizeKb;

    const telemetryMetrics = createTelemetryMetrics(state, fullPayloadSizeKb, patchSizeKb);
    applyTelemetryMetrics(nextFrame, telemetryMetrics);

    if (nextFrame.frameTelemetry) {
      patch = {
        type: "frame_patch",
        changed: {
          ...changed,
          frameTelemetry: nextFrame.frameTelemetry
        }
      };
      patchSizeKb = toKb(measureBytes(patch));
      state.totalPatchSizeKb += patchSizeKb - toKb(measureBytes({ type: "frame_patch", changed }));
    }

    state.totalSavedByDeltaKb += Math.max(fullPayloadSizeKb - patchSizeKb, 0);
    state.lastSentFrame = nextFrame;

    return patch;
  }
}
