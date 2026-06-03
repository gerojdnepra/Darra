import type { OpportunityScoreResult } from "../opportunity/opportunity-score-engine";
import type { PositionSizingResult } from "../risk/position-sizing-engine";
import type { SetupClassification, SetupDirection } from "../setup-classifier/setup-classifier-engine";

export type DoNotTradeSeverity = "OK" | "CAUTION" | "BLOCKED" | "EMERGENCY";
export type DoNotTradeAction = "ALLOW" | "REDUCE_SIZE" | "WAIT" | "BLOCK";

export interface DoNotTradeResult {
  allowed: boolean;
  severity: DoNotTradeSeverity;
  action: DoNotTradeAction;
  reasons: string[];
  blockers: string[];
  warnings: string[];
  cooldownSec: number;
  tags: string[];
}

export interface DoNotTradeInput {
  symbol: string;
  direction?: SetupDirection | "long" | "short" | "unknown" | null;
  setupClassification?: SetupClassification | null;
  opportunityScore?: OpportunityScoreResult | null;
  positionSizing?: PositionSizingResult | null;
  payload?: unknown;
  features?: unknown;
  risk?: unknown;
  account?: unknown;
}

interface ExtractedDoNotTradeFeatures {
  spreadBps: number | null;
  fundingRate: number | null;
  momentum30sPct: number | null;
  momentum2mPct: number | null;
  cvdSlope: number | null;
  cvdDivergence: string | null;
  setupType: string | null;
  setupConfidence: number | null;
  opportunityVerdict: string | null;
  opportunityScore: number | null;
  opportunityRiskLevel: string | null;
  recommendedNotional: number | null;
  liquidationBufferPct: number | null;
  riskLevel: string | null;
  riskScore: number | null;
  portfolioRiskScore: number | null;
  maxAbsCorrelation: number | null;
  grossExposureUsd: number | null;
  quoteVolume24h: number | null;
  tradeNotional60s: number | null;
  volumeImpulse: number | null;
  dominantRegime: string | null;
  marketState: string | null;
  marketMode: string | null;
  tradePermission: string | null;
  killSwitchState: string | null;
  safeToAddPosition: boolean | null;
  accountRiskLoad: number | null;
}

interface RuleHit {
  kind: "blocker" | "warning" | "reason";
  action: DoNotTradeAction;
  severity: DoNotTradeSeverity;
  message: string;
  cooldownSec: number;
  tag: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readPath = (value: unknown, path: string[]): unknown => {
  let current = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
};

const readNumber = (...candidates: unknown[]): number | null => {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
};

const readString = (...candidates: unknown[]): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

const readBoolean = (...candidates: unknown[]): boolean | null => {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return null;
};

const normalizeDirection = (value: unknown): "long" | "short" | "unknown" => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (normalized === "long" || normalized === "short") {
    return normalized;
  }

  return "unknown";
};

const normalizeConfidence = (value: number | null): number | null => {
  if (value === null) {
    return null;
  }

  return value <= 1 ? value * 100 : value;
};

const extractFeatures = (input: DoNotTradeInput): ExtractedDoNotTradeFeatures => {
  const riskRoot = input.risk ?? readPath(input.features, ["risk"]);
  const accountRoot = input.account ?? readPath(input.features, ["account"]);
  const row = readPath(input.features, ["row"]);
  const funding = readPath(input.features, ["funding"]);
  const marketFlow = readPath(input.features, ["marketFlow"]);
  const overview = readPath(input.features, ["overview"]);
  const metaRegimeGovernor = readPath(input.features, ["metaRegimeGovernor"]);
  const positionRiskOrchestrator = readPath(input.features, ["positionRiskOrchestrator"]);
  const regimePrediction = readPath(input.features, ["regimePrediction"]);

  return {
    spreadBps: readNumber(readPath(row, ["spreadBps"]), readPath(input.payload, ["spreadBps"])),
    fundingRate: readNumber(
      readPath(row, ["fundingRate"]),
      readPath(funding, ["fundingRate"]),
      readPath(row, ["risk", "funding", "fundingRate"])
    ),
    momentum30sPct: readNumber(readPath(row, ["momentum30sPct"])),
    momentum2mPct: readNumber(readPath(row, ["momentum2mPct"])),
    cvdSlope: readNumber(readPath(marketFlow, ["cvd", "slope"]), readPath(row, ["risk", "flow", "cvd5mUsd"])),
    cvdDivergence: readString(readPath(marketFlow, ["cvd", "divergence"])),
    setupType: input.setupClassification?.setupType ?? null,
    setupConfidence: normalizeConfidence(input.setupClassification?.confidence ?? null),
    opportunityVerdict: input.opportunityScore?.verdict ?? null,
    opportunityScore: input.opportunityScore?.score ?? null,
    opportunityRiskLevel: input.opportunityScore?.riskLevel ?? null,
    recommendedNotional: input.positionSizing?.recommendedNotional ?? null,
    liquidationBufferPct: input.positionSizing?.liquidationBufferPct ?? null,
    riskLevel: readString(
      input.positionSizing?.riskLevel,
      input.opportunityScore?.riskLevel,
      readPath(row, ["riskLevel"]),
      readPath(riskRoot, ["riskLevel"])
    ),
    riskScore: readNumber(readPath(row, ["riskScore"])),
    portfolioRiskScore: readNumber(readPath(riskRoot, ["riskScore"])),
    maxAbsCorrelation: readNumber(readPath(riskRoot, ["correlation", "maxAbsCorrelation"])),
    grossExposureUsd: readNumber(
      readPath(riskRoot, ["summary", "grossExposureUsd", "value"]),
      readPath(accountRoot, ["summary", "grossExposureUsd", "value"])
    ),
    quoteVolume24h: readNumber(readPath(row, ["quoteVolume24h"])),
    tradeNotional60s: readNumber(readPath(row, ["tradeNotional60s"])),
    volumeImpulse: readNumber(readPath(row, ["volumeImpulse"])),
    dominantRegime: readString(readPath(overview, ["dominantRegime"])),
    marketState: readString(
      readPath(input.payload, ["marketState"]),
      readPath(regimePrediction, ["currentRegime"]),
      readPath(regimePrediction, ["predictedRegime"])
    ),
    marketMode: readString(readPath(metaRegimeGovernor, ["marketMode"])),
    tradePermission: readString(readPath(metaRegimeGovernor, ["tradePermission"])),
    killSwitchState: readString(readPath(positionRiskOrchestrator, ["killSwitchState"])),
    safeToAddPosition: readBoolean(readPath(positionRiskOrchestrator, ["safeToAddPosition"])),
    accountRiskLoad: readNumber(readPath(positionRiskOrchestrator, ["accountRiskLoad"]))
  };
};

const addHit = (
  hits: RuleHit[],
  kind: RuleHit["kind"],
  action: DoNotTradeAction,
  severity: DoNotTradeSeverity,
  message: string,
  cooldownSec: number,
  tag: string
): void => {
  hits.push({ kind, action, severity, message, cooldownSec, tag });
};

const actionRank: Record<DoNotTradeAction, number> = {
  ALLOW: 0,
  REDUCE_SIZE: 1,
  WAIT: 2,
  BLOCK: 3
};

const severityRank: Record<DoNotTradeSeverity, number> = {
  OK: 0,
  CAUTION: 1,
  BLOCKED: 2,
  EMERGENCY: 3
};

const maxByRank = <T extends string>(values: T[], rank: Record<T, number>, fallback: T): T =>
  values.reduce((best, value) => (rank[value] > rank[best] ? value : best), fallback);

export class DoNotTradeEngine {
  evaluate(input: DoNotTradeInput): DoNotTradeResult {
    const features = extractFeatures(input);
    const direction = normalizeDirection(
      input.direction ?? input.setupClassification?.direction ?? input.positionSizing?.direction
    );
    const hits: RuleHit[] = [];

    if (features.spreadBps !== null && features.spreadBps > 20) {
      addHit(hits, "blocker", "BLOCK", "BLOCKED", "Spread is too wide above 20 bps.", 180, "spread_too_wide");
    } else if (features.spreadBps !== null && features.spreadBps > 10) {
      addHit(hits, "warning", "REDUCE_SIZE", "CAUTION", "Spread is wide above 10 bps.", 90, "spread_wide");
    }

    const funding = features.fundingRate ?? 0;
    const momentum = features.momentum2mPct ?? features.momentum30sPct ?? 0;
    const crowdedLong = funding > 0 && direction === "long" && momentum > 0;
    const crowdedShort = funding < 0 && direction === "short" && momentum < 0;
    if (Math.abs(funding) >= 0.0015 && (crowdedLong || crowdedShort)) {
      addHit(hits, "blocker", "BLOCK", "BLOCKED", "Extreme funding aligns with crowded trade direction.", 600, "funding_trap");
    } else if (Math.abs(funding) >= 0.0008 && (crowdedLong || crowdedShort)) {
      addHit(hits, "warning", "WAIT", "CAUTION", "Funding pressure suggests crowded continuation risk.", 300, "funding_crowded");
    }

    const cvdSlope = features.cvdSlope ?? 0;
    const cvdDivergence = features.cvdDivergence?.toLowerCase() ?? "";
    if (direction === "long" && (cvdSlope < 0 || cvdDivergence === "bearish")) {
      addHit(hits, "warning", "WAIT", "CAUTION", "CVD is negative against long direction.", 120, "cvd_against_direction");
    } else if (direction === "short" && (cvdSlope > 0 || cvdDivergence === "bullish")) {
      addHit(hits, "warning", "WAIT", "CAUTION", "CVD is positive against short direction.", 120, "cvd_against_direction");
    }

    if (features.setupType === "UNKNOWN" && (features.setupConfidence ?? 0) < 35) {
      addHit(hits, "warning", "WAIT", "CAUTION", "Setup is UNKNOWN with low confidence.", 180, "unknown_setup");
    }

    if (features.opportunityScore !== null && features.opportunityScore < 45) {
      addHit(hits, "warning", "WAIT", "CAUTION", "Opportunity score is below 45.", 180, "weak_opportunity");
    }

    if (features.opportunityVerdict === "DO_NOT_TRADE") {
      addHit(hits, "blocker", "BLOCK", "BLOCKED", "Opportunity engine returned DO_NOT_TRADE.", 300, "opportunity_do_not_trade");
    }

    const riskLevel = features.riskLevel?.toUpperCase() ?? "";
    if (riskLevel === "EXTREME" || riskLevel === "CRITICAL") {
      addHit(hits, "blocker", "BLOCK", "EMERGENCY", "Risk level is extreme/critical.", 900, "risk_extreme");
    } else if (riskLevel === "HIGH") {
      addHit(hits, "warning", "REDUCE_SIZE", "CAUTION", "Risk level is HIGH.", 240, "risk_high");
    }

    if (features.recommendedNotional !== null && features.recommendedNotional <= 0) {
      addHit(hits, "blocker", "BLOCK", "BLOCKED", "Position sizing recommended notional is zero.", 180, "sizing_zero");
    }

    if (features.liquidationBufferPct !== null && features.liquidationBufferPct < 5) {
      addHit(hits, "blocker", "BLOCK", "EMERGENCY", "Liquidation buffer is below 5%.", 900, "liquidation_buffer_critical");
    } else if (features.liquidationBufferPct !== null && features.liquidationBufferPct < 10) {
      addHit(hits, "warning", "REDUCE_SIZE", "CAUTION", "Liquidation buffer is below 10%.", 300, "liquidation_buffer_low");
    }

    const marketMode = features.marketMode?.toUpperCase() ?? "";
    const marketState = features.marketState?.toUpperCase() ?? "";
    const dominantRegime = features.dominantRegime?.toLowerCase() ?? "";
    if (
      marketMode === "RISK_OFF" ||
      marketMode === "EXTREME_UNCERTAINTY" ||
      marketState === "DISORDER" ||
      dominantRegime === "risk-off"
    ) {
      addHit(hits, "warning", "WAIT", "CAUTION", "Regime is risk-off, disorder, or high uncertainty.", 240, "regime_risk_off");
    }

    if (
      (features.quoteVolume24h !== null && features.quoteVolume24h < 5_000_000) ||
      (features.tradeNotional60s !== null && features.tradeNotional60s < 25_000) ||
      (features.volumeImpulse !== null && features.volumeImpulse < 0.6)
    ) {
      addHit(hits, "warning", "WAIT", "CAUTION", "Liquidity or near-term volume is too weak.", 180, "liquidity_weak");
    }

    const tradePermission = features.tradePermission?.toUpperCase() ?? "";
    const killSwitchState = features.killSwitchState?.toUpperCase() ?? "";
    const portfolioRisk = Math.max(features.portfolioRiskScore ?? 0, features.accountRiskLoad ?? 0);
    if (
      tradePermission === "BLOCKED" ||
      killSwitchState === "EMERGENCY" ||
      killSwitchState === "STOP_ADDING" ||
      portfolioRisk >= 90
    ) {
      addHit(hits, "blocker", "BLOCK", "EMERGENCY", "Portfolio risk blocks adding exposure.", 900, "portfolio_risk_block");
    } else if (
      features.safeToAddPosition === false ||
      tradePermission === "REDUCED" ||
      killSwitchState === "REDUCE_RISK" ||
      portfolioRisk >= 70 ||
      (features.maxAbsCorrelation !== null && features.maxAbsCorrelation >= 0.85)
    ) {
      addHit(hits, "warning", "REDUCE_SIZE", "CAUTION", "Portfolio risk or correlation requires reduced size.", 300, "portfolio_risk_high");
    }

    const blockers = hits.filter((hit) => hit.kind === "blocker").map((hit) => hit.message);
    const warnings = hits.filter((hit) => hit.kind === "warning").map((hit) => hit.message);
    const reasons = hits.map((hit) => hit.message);
    const action = maxByRank(hits.map((hit) => hit.action), actionRank, "ALLOW");
    const severity = maxByRank(hits.map((hit) => hit.severity), severityRank, "OK");
    const cooldownSec = Math.max(0, ...hits.map((hit) => hit.cooldownSec));
    const tags = Array.from(new Set(hits.map((hit) => hit.tag)));

    return {
      allowed: blockers.length === 0,
      severity,
      action,
      reasons,
      blockers,
      warnings,
      cooldownSec,
      tags
    };
  }
}

export const doNotTradeEngine = new DoNotTradeEngine();
