import type { RiskSnapshotPayload, RiskUpdatePayload } from "./types";

export const createRiskSnapshotMessage = (payload: RiskSnapshotPayload) => ({
  type: "risk_snapshot" as const,
  generatedAt: payload.state.generatedAt,
  payload
});

export const createRiskUpdateMessage = (payload: RiskUpdatePayload) => ({
  type: "risk_update" as const,
  generatedAt: payload.state.generatedAt,
  payload
});
