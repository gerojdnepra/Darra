import type { ScreenerFrame } from "../types/messages";

export type ProjectedFrame = Partial<ScreenerFrame> & Pick<ScreenerFrame, "type" | "generatedAt">;

export type SnapshotRequestReason =
  | "initial_connect"
  | "manual"
  | "gap_detected"
  | "missing_frame_state"
  | "missing_transport_seq"
  | "non_monotonic_seq";

export interface SnapshotRequestPayload {
  reason?: SnapshotRequestReason | string;
  lastSeenSeq?: number | null;
  expectedBaseSeq?: number | null;
  receivedFrameSeq?: number | null;
}

export interface DeltaFrameRecoveryTelemetry {
  lastClientSeenSeq: number | null;
  forcedFullResyncs: number;
  desyncEvents: number;
  lastDesyncAt: number | null;
  lastDesyncReason: string | null;
  lastRecoveryAt: number | null;
  lastRecoveryReason: string | null;
}

export interface FrameSnapshotMessage {
  type: "snapshot";
  frame: ProjectedFrame;
  frameSeq: number;
  baseSeq: null;
  recovery: DeltaFrameRecoveryTelemetry;
}

export interface FramePatchMessage {
  type: "frame_patch";
  frameSeq: number;
  baseSeq: number;
  changed: Partial<ProjectedFrame>;
  recovery: DeltaFrameRecoveryTelemetry;
}

export type DeltaFramePayload = FrameSnapshotMessage | FramePatchMessage;

export interface DeltaFrameTelemetryMetrics {
  deltaEnabled: boolean;
  snapshotFramesSent: number;
  patchFramesSent: number;
  patchSizeBytes: number;
  patchSizeKb: number;
  averagePatchSizeKb: number;
  savedByDeltaKb: number;
  deltaRatio: number;
  deltaRowsMs?: number;
  deltaSectionCompareMs?: number;
  deltaPatchMeasureMs?: number;
  deltaFullMeasureMs?: number;
  deltaRowsFastPathHit?: boolean;
  deltaComparedSectionsCount?: number;
  deltaChangedSectionsCount?: number;
}

export interface DeltaFrameClientState {
  lastSentFrame: ProjectedFrame | null;
  compactRowsSignaturesBySymbol: Record<string, string> | null;
  snapshotFramesSent: number;
  patchFramesSent: number;
  totalPatchSizeKb: number;
  totalSavedByDeltaKb: number;
  lastSentSeq: number;
  lastClientSeenSeq: number | null;
  forcedFullResyncs: number;
  desyncEvents: number;
  lastDesyncAt: number | null;
  lastDesyncReason: string | null;
  lastRecoveryAt: number | null;
  lastRecoveryReason: string | null;
  pendingRecoveryReason: string | null;
}
