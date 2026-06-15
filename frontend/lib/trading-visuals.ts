export interface TradingVisual {
  badgeClass: string;
  textClass: string;
  borderClass: string;
}

const POSITIVE_VISUAL: TradingVisual = {
  badgeClass: "border-positive/35 bg-positive/10 text-positive",
  textClass: "text-positive",
  borderClass: "border-positive/30"
};

const NEGATIVE_VISUAL: TradingVisual = {
  badgeClass: "border-negative/35 bg-negative/10 text-negative",
  textClass: "text-negative",
  borderClass: "border-negative/30"
};

const CAUTION_VISUAL: TradingVisual = {
  badgeClass: "border-caution/35 bg-caution/10 text-caution",
  textClass: "text-caution",
  borderClass: "border-caution/30"
};

const NEUTRAL_VISUAL: TradingVisual = {
  badgeClass: "border-white/10 bg-white/5 text-slate-400",
  textClass: "text-slate-300",
  borderClass: "border-white/10"
};

const STALE_VISUAL: TradingVisual = {
  badgeClass: "border-caution/25 bg-caution/10 text-slate-300",
  textClass: "text-slate-400",
  borderClass: "border-caution/25"
};

export const getBiasVisual = (bias: string | null | undefined): TradingVisual => {
  if (
    bias === "LONG" ||
    bias === "BUY" ||
    bias === "BULLISH" ||
    bias === "LONG_BIASED"
  ) {
    return POSITIVE_VISUAL;
  }

  if (
    bias === "SHORT" ||
    bias === "SELL" ||
    bias === "BEARISH" ||
    bias === "SHORT_BIASED"
  ) {
    return NEGATIVE_VISUAL;
  }

  if (bias === "WAIT" || bias === "WATCH") {
    return CAUTION_VISUAL;
  }

  return NEUTRAL_VISUAL;
};

export const getDecisionVisual = (decision: string | null | undefined): TradingVisual => {
  if (
    decision === "TRADE" ||
    decision === "ENTER" ||
    decision === "ALLOW" ||
    decision === "ALLOWED" ||
    decision === "OK" ||
    decision === "READY" ||
    decision === "ACCEPTED" ||
    decision === "CLEAR" ||
    decision === "GOOD"
  ) {
    return POSITIVE_VISUAL;
  }

  if (
    decision === "BLOCK" ||
    decision === "BLOCKED" ||
    decision === "REJECTED" ||
    decision === "DO_NOT_TRADE" ||
    decision === "EMERGENCY" ||
    decision === "FAIL"
  ) {
    return NEGATIVE_VISUAL;
  }

  if (
    decision === "WAIT" ||
    decision === "WATCH" ||
    decision === "CHECK" ||
    decision === "WAITING" ||
    decision === "CAUTION" ||
    decision === "WARN" ||
    decision === "REDUCED" ||
    decision === "FORCED_WAIT"
  ) {
    return CAUTION_VISUAL;
  }

  if (decision === "STALE") {
    return STALE_VISUAL;
  }

  return NEUTRAL_VISUAL;
};

export const getRiskVisual = (riskLevel: string | null | undefined): TradingVisual => {
  if (
    riskLevel === "HIGH" ||
    riskLevel === "CRITICAL" ||
    riskLevel === "EXTREME" ||
    riskLevel === "EMERGENCY"
  ) {
    return NEGATIVE_VISUAL;
  }

  if (
    riskLevel === "MEDIUM" ||
    riskLevel === "MODERATE" ||
    riskLevel === "warning" ||
    riskLevel === "CAUTION"
  ) {
    return CAUTION_VISUAL;
  }

  if (riskLevel === "LOW" || riskLevel === "safe" || riskLevel === "OK") {
    return POSITIVE_VISUAL;
  }

  return NEUTRAL_VISUAL;
};

export const getFreshnessVisual = (status: string | null | undefined): TradingVisual => {
  if (status === "FRESH" || status === "LIVE" || status === "OK" || status === "CLEAR") {
    return POSITIVE_VISUAL;
  }

  if (status === "STALE" || status === "DEGRADED" || status === "CHECK") {
    return STALE_VISUAL;
  }

  return NEUTRAL_VISUAL;
};

export const getDirectionBadgeClass = (direction: string | null | undefined): string =>
  getBiasVisual(direction).badgeClass;
