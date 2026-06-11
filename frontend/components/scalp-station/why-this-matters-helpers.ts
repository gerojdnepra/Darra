import type {
  FundingSymbolState,
  MarketFlowState,
  ScreenerAlert,
  ScreenerRow
} from "@/lib/types";

export type CommandCenterTone = "positive" | "caution" | "negative" | "accent" | "neutral";

export type WhyThisMattersAction = "Eligible" | "Watch" | "Wait" | "Paper Only" | "Avoid";
export type WhyThisMattersConfidence = "High" | "Medium" | "Low";
export type WhyThisMattersFlow = "Bullish" | "Bearish" | "Mixed";
export type WhyThisMattersFunding = "Crowded" | "Neutral" | "Favorable";

export const whyThisMattersActionTone = (action: WhyThisMattersAction): CommandCenterTone => {
  if (action === "Eligible") {
    return "positive";
  }

  if (action === "Avoid") {
    return "negative";
  }

  if (action === "Paper Only" || action === "Wait") {
    return "caution";
  }

  return "accent";
};

export const whyThisMattersConfidenceTone = (
  confidence: WhyThisMattersConfidence
): CommandCenterTone => {
  if (confidence === "High") {
    return "positive";
  }

  if (confidence === "Medium") {
    return "accent";
  }

  return "caution";
};

export const whyThisMattersFundingTone = (funding: WhyThisMattersFunding): CommandCenterTone => {
  if (funding === "Crowded") {
    return "caution";
  }

  if (funding === "Favorable") {
    return "positive";
  }

  return "neutral";
};

export const whyThisMattersFlowTone = (flow: WhyThisMattersFlow): CommandCenterTone => {
  if (flow === "Bullish") {
    return "positive";
  }

  if (flow === "Bearish") {
    return "negative";
  }

  return "caution";
};

export const whyThisMattersSignalLabel = (
  row: ScreenerRow,
  latestAlert: ScreenerAlert | null
): string => {
  if (latestAlert?.kind === "reviving_coin") {
    return "Reviving";
  }

  if (
    latestAlert?.kind === "liquidation" ||
    latestAlert?.reason.toLowerCase().includes("liquidation") ||
    row.liquidation5m >= 250_000
  ) {
    return "Liquidation";
  }

  if (
    row.tags.some((tag) => tag.toLowerCase().includes("funding")) ||
    Math.abs(row.fundingRate) >= 0.0008
  ) {
    return "Funding";
  }

  if (row.score >= 60 || Math.abs(row.momentum30sPct) >= 0.2 || row.volumeImpulse >= 1.5) {
    return "Momentum";
  }

  return row.bias === "NEUTRAL" ? "Mixed" : "Flow";
};

export const whyThisMattersFundingLabel = (
  row: ScreenerRow,
  funding: FundingSymbolState | null
): WhyThisMattersFunding => {
  const fundingRate = funding?.fundingRate ?? row.fundingRate;

  if (Math.abs(fundingRate) >= 0.0008) {
    return "Crowded";
  }

  if (
    (row.bias === "LONG" && fundingRate < -0.0002) ||
    (row.bias === "SHORT" && fundingRate > 0.0002)
  ) {
    return "Favorable";
  }

  return "Neutral";
};

export const whyThisMattersFlowLabel = (
  row: ScreenerRow,
  flow: MarketFlowState | null
): WhyThisMattersFlow => {
  const bullishVotes = [
    row.bias === "LONG",
    row.buyRatio60s > 0.52,
    flow ? flow.cvd.slope > 0 : false,
    flow ? flow.openInterest.oiChange5m > 0 : false,
    flow?.cvd.divergence === "bullish"
  ].filter(Boolean).length;
  const bearishVotes = [
    row.bias === "SHORT",
    row.buyRatio60s < 0.48,
    flow ? flow.cvd.slope < 0 : false,
    flow ? flow.openInterest.oiChange5m < 0 : false,
    flow?.cvd.divergence === "bearish"
  ].filter(Boolean).length;

  if (bullishVotes >= bearishVotes + 2) {
    return "Bullish";
  }

  if (bearishVotes >= bullishVotes + 2) {
    return "Bearish";
  }

  return "Mixed";
};
