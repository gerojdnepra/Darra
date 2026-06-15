import type { MarketFlowState } from "./types";

const minuteFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

export const isFreshOpenInterest = (flow: MarketFlowState | null | undefined): boolean =>
  flow?.openInterest.status === "FRESH";

export const formatOpenInterestFreshness = (flow: MarketFlowState | null | undefined): string => {
  if (!flow) {
    return "OI waiting";
  }

  if (flow.openInterest.status === "UNAVAILABLE") {
    return "OI unavailable";
  }

  if (flow.openInterest.status === "STALE") {
    const ageMinutes =
      flow.openInterest.ageMs !== null ? Math.max(1, Math.round(flow.openInterest.ageMs / 60_000)) : null;
    return ageMinutes !== null ? `OI stale ${minuteFormatter.format(ageMinutes)}m` : "OI stale";
  }

  return `OI 5m ${flow.openInterest.oiChange5m.toFixed(2)}%`;
};
