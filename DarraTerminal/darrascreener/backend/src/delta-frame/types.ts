import type { ScreenerFrame } from "../types/messages";

export type ProjectedFrame = Partial<ScreenerFrame> & Pick<ScreenerFrame, "type" | "generatedAt">;

export interface FrameSnapshotMessage {
  type: "snapshot";
  frame: ProjectedFrame;
}

export interface FramePatchMessage {
  type: "frame_patch";
  changed: Partial<ProjectedFrame>;
}

export type DeltaFramePayload = FrameSnapshotMessage | FramePatchMessage;

export interface DeltaFrameTelemetryMetrics {
  deltaEnabled: boolean;
  snapshotFramesSent: number;
  patchFramesSent: number;
  averagePatchSizeKb: number;
  savedByDeltaKb: number;
  deltaRatio: number;
}

export interface DeltaFrameClientState {
  lastSentFrame: ProjectedFrame | null;
  snapshotFramesSent: number;
  patchFramesSent: number;
  totalPatchSizeKb: number;
  totalSavedByDeltaKb: number;
}
