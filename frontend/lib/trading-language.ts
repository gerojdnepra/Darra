export const explainFundingState = ({
  rate,
  label
}: {
  rate: number | null | undefined;
  label?: string | null | undefined;
}): string => {
  if (label === "Neutral" || (typeof rate === "number" && Math.abs(rate) < 0.00015)) {
    return "Crowding looks balanced right now.";
  }

  if (label === "Longs paying" || (typeof rate === "number" && rate > 0)) {
    return "Longs are paying to stay in. Trade may be crowded.";
  }

  if (label === "Shorts paying" || (typeof rate === "number" && rate < 0)) {
    return "Shorts are paying to stay in. Short crowding may be building.";
  }

  return "Funding context is still unclear.";
};

export const explainOpenInterestState = ({
  status,
  changePct,
  ageMs,
  hasFlow = true
}: {
  status: string | null | undefined;
  changePct?: number | null | undefined;
  ageMs?: number | null | undefined;
  hasFlow?: boolean;
}): string => {
  if (!hasFlow || !status) {
    return "Positioning data is still loading.";
  }

  if (status === "UNAVAILABLE") {
    return "Open interest data is unavailable right now.";
  }

  if (status === "STALE") {
    const minutes =
      typeof ageMs === "number" && Number.isFinite(ageMs)
        ? Math.max(1, Math.round(ageMs / 60_000))
        : null;
    return minutes !== null
      ? `Open interest data is ${minutes}m old. Use caution.`
      : "Open interest data is old. Use caution.";
  }

  if (typeof changePct === "number" && changePct >= 0.15) {
    return "More positions are opening in this move.";
  }

  if (typeof changePct === "number" && changePct <= -0.15) {
    return "Positions are closing as this move develops.";
  }

  return "Positioning is mostly flat.";
};

export const explainFlowState = ({
  slope,
  divergence,
  label
}: {
  slope?: number | null | undefined;
  divergence?: string | null | undefined;
  label?: string | null | undefined;
}): string => {
  if (divergence === "bullish" || divergence === "bearish") {
    return "Price and aggressive order flow disagree.";
  }

  if (typeof slope === "number" && slope > 0.01) {
    return "Buyers are driving the move.";
  }

  if (typeof slope === "number" && slope < -0.01) {
    return "Sellers are driving the move.";
  }

  if (label === "balanced") {
    return "Order flow is balanced right now.";
  }

  return "Order-flow confirmation is still building.";
};

export const explainDecisionState = (status: string | null | undefined): string => {
  if (
    status === "TRADE" ||
    status === "ENTER" ||
    status === "ALLOW" ||
    status === "ALLOWED" ||
    status === "OK" ||
    status === "READY"
  ) {
    return "This setup can move to the next step.";
  }

  if (
    status === "WAIT" ||
    status === "WATCH" ||
    status === "CHECK" ||
    status === "WAITING" ||
    status === "FORCED_WAIT"
  ) {
    return "Context is mixed. Waiting is safer.";
  }

  if (status === "BLOCK" || status === "BLOCKED" || status === "REJECTED") {
    return "A safety rule is stopping this step.";
  }

  if (status === "STALE") {
    return "The last check is old and needs a refresh.";
  }

  return "More context is needed before acting.";
};

export const explainExecutionBlocker = ({
  preflightState,
  safeToAddStatus,
  reason
}: {
  preflightState?: string | null | undefined;
  safeToAddStatus?: string | null | undefined;
  reason?: string | null | undefined;
}): string => {
  if (preflightState === "stale" || safeToAddStatus === "STALE") {
    return "Darra must refresh its safety checks before confirm.";
  }

  if (preflightState === "loading") {
    return "Darra is re-checking risk before confirm.";
  }

  if (safeToAddStatus === "BLOCK" || safeToAddStatus === "BLOCKED") {
    return "Adding this trade may exceed risk limits.";
  }

  if (safeToAddStatus === "WAIT") {
    return "Risk checks are not clear enough to add yet.";
  }

  if (reason && reason.trim().length > 0) {
    return "Execution is paused until this safety item clears.";
  }

  return "Execution is waiting for a clean safety check.";
};

export const explainFreshnessState = (
  status: string | null | undefined,
  subject = "Data"
): string => {
  if (status === "FRESH" || status === "fresh" || status === "OK" || status === "CLEAR") {
    return `${subject} is current.`;
  }

  if (status === "STALE" || status === "stale") {
    return `${subject} is old. Use caution.`;
  }

  if (status === "UNAVAILABLE") {
    return `${subject} is unavailable right now.`;
  }

  if (status === "loading" || status === "WAITING" || status === "waiting") {
    return `${subject} is still loading.`;
  }

  return `${subject} needs a quick double-check.`;
};

export const explainRiskState = (riskLevel: string | null | undefined): string => {
  if (riskLevel === "LOW") {
    return "Risk looks manageable.";
  }

  if (riskLevel === "MEDIUM") {
    return "Risk is rising. Smaller size may be safer.";
  }

  if (riskLevel === "HIGH") {
    return "Risk is elevated. Protection matters here.";
  }

  if (riskLevel === "CRITICAL" || riskLevel === "EXTREME") {
    return "Risk is too high for a normal add.";
  }

  return "Risk context is still forming.";
};

export const explainSignalKind = (kind: string | null | undefined): string => {
  if (kind === "tape") {
    return "Tape signals show aggressive buying or selling pressure.";
  }

  if (kind === "liquidation") {
    return "Liquidation signals show traders being forced out.";
  }

  if (kind === "reviving_coin") {
    return "Reviving coin signals show attention returning after a lull.";
  }

  if (kind === "risk") {
    return "Risk signals warn that conditions are getting less safe.";
  }

  if (kind === "correlation_spike") {
    return "Symbols are moving together more than usual, which can raise portfolio risk.";
  }

  return "This signal adds context, not an automatic trade.";
};
