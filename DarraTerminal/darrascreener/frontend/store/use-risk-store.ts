"use client";

import { create } from "zustand";
import type { RiskSnapshotMessage, RiskState, RiskUpdateMessage } from "@/lib/types";

interface RiskStoreState {
  snapshot: RiskState | null;
  version: number;
  lastEventAt: number | null;
  applyRiskSnapshot: (message: RiskSnapshotMessage) => void;
  applyRiskUpdate: (message: RiskUpdateMessage) => void;
  reset: () => void;
}

export const useRiskStore = create<RiskStoreState>((set) => ({
  snapshot: null,
  version: 0,
  lastEventAt: null,
  applyRiskSnapshot: (message) =>
    set({
      snapshot: message.payload.state,
      version: message.payload.version,
      lastEventAt: message.generatedAt
    }),
  applyRiskUpdate: (message) =>
    set({
      snapshot: message.payload.state,
      version: message.payload.version,
      lastEventAt: message.generatedAt
    }),
  reset: () =>
    set({
      snapshot: null,
      version: 0,
      lastEventAt: null
    })
}));
