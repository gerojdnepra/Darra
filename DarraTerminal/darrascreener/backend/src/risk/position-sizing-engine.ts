import type {
  OpportunityRiskLevel,
  OpportunityScoreResult,
  OpportunityVerdict
} from "../opportunity/opportunity-score-engine";
import type { BinanceSymbolFilters } from "../services/binance-exchange-filters";
import { normalizePrice, normalizeQuantity, validateNotional } from "../services/binance-exchange-filters";
import type { SetupClassification, SetupDirection } from "../setup-classifier/setup-classifier-engine";

export type PositionSizingDirection = "long" | "short" | "unknown";
export type PositionSizingRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export interface PositionSizingResult {
  symbol: string;
  direction: PositionSizingDirection;
  recommendedNotional: number;
  maxNotional: number;
  recommendedQty: number;
  rawQty: number;
  normalizedQty: number;
  minQty: number | null;
  stepSize: number | null;
  minNotional: number | null;
  suggestedLeverage: number;
  riskPerTradePct: number;
  stopDistancePct: number;
  liquidationBufferPct: number | null;
  confidence: number;
  riskLevel: PositionSizingRiskLevel;
  reasons: string[];
  warnings: string[];
  exchangeFilterWarnings: string[];
  constraints: string[];
}

export interface PositionSizingInput {
  symbol: string;
  direction?: PositionSizingDirection | SetupDirection | null;
  entryPrice?: number | null;
  stopDistancePct?: number | null;
  customEquityUsdt?: number | null;
  customRiskPerTradePct?: number | null;
  defaultEquityUsdt: number;
  opportunityScore?: OpportunityScoreResult | null;
  setupClassification?: SetupClassification | null;
  payload?: unknown;
  features?: unknown;
  account?: unknown;
  risk?: unknown;
  exchangeFilters?: Map<string, BinanceSymbolFilters> | null;
}

interface ExtractedPositionSizingFeatures {
  equity: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  liquidationPrice: number | null;
  spreadBps: number | null;
  momentum30sPct: number | null;
  momentum2mPct: number | null;
  volatility1h: number | null;
  fundingRate: number | null;
  riskScore: number | null;
  portfolioRiskScore: number | null;
  maxAbsCorrelation: number | null;
  symbolExposureUsd: number | null;
  grossExposureUsd: number | null;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const round = (value: number, decimals = 2): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

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

const readNestedNumber = (root: unknown, paths: string[][]): number | null =>
  readNumber(...paths.map((path) => readPath(root, path)));

const findSymbolObject = (items: unknown, symbol: string): unknown => {
  if (!Array.isArray(items)) {
    return null;
  }

  return (
    items.find((item) => isRecord(item) && String(item.symbol ?? "").toUpperCase() === symbol) ?? null
  );
};

const normalizeDirection = (value: unknown): PositionSizingDirection => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (normalized === "long" || normalized === "short") {
    return normalized;
  }

  return "unknown";
};

const normalizeRiskLevel = (
  riskLevel: OpportunityRiskLevel | string | null | undefined,
  features: ExtractedPositionSizingFeatures
): PositionSizingRiskLevel => {
  if (riskLevel === "LOW" || riskLevel === "MEDIUM" || riskLevel === "HIGH" || riskLevel === "EXTREME") {
    return riskLevel;
  }

  const riskScore = Math.max(features.riskScore ?? 0, features.portfolioRiskScore ?? 0);
  const spreadBps = features.spreadBps ?? 0;
  const funding = Math.abs(features.fundingRate ?? 0);

  if (riskScore >= 85 || spreadBps > 18 || funding >= 0.0015) {
    return "EXTREME";
  }

  if (riskScore >= 70 || spreadBps > 10 || funding >= 0.001) {
    return "HIGH";
  }

  if (riskScore >= 45 || spreadBps > 5 || funding >= 0.0005) {
    return "MEDIUM";
  }

  return "LOW";
};

const extractFeatures = (input: PositionSizingInput): ExtractedPositionSizingFeatures => {
  const symbol = input.symbol.trim().toUpperCase();
  const riskRoot = input.risk ?? readPath(input.features, ["risk"]);
  const accountRoot = input.account ?? readPath(input.features, ["account"]);
  const row = readPath(input.features, ["row"]);
  const riskPosition =
    findSymbolObject(readPath(riskRoot, ["positions"]), symbol) ??
    findSymbolObject(readPath(accountRoot, ["positions"]), symbol);

  return {
    equity: readNumber(
      readNestedNumber(riskRoot, [
        ["summary", "marginBalanceUsd", "value"],
        ["summary", "walletBalanceUsd", "value"],
        ["summary", "availableBalanceUsd", "value"]
      ]),
      readNestedNumber(accountRoot, [
        ["balances", "marginBalanceUsd"],
        ["balances", "walletBalanceUsd"],
        ["balances", "availableBalanceUsd"]
      ])
    ),
    markPrice: readNumber(
      input.entryPrice,
      readNestedNumber(row, [["markPrice"], ["lastPrice"]]),
      readNestedNumber(riskPosition, [["markPrice"], ["entryPrice"]])
    ),
    lastPrice: readNumber(input.entryPrice, readNestedNumber(row, [["lastPrice"], ["markPrice"]])),
    liquidationPrice: readNestedNumber(riskPosition, [["liquidationPrice"]]),
    spreadBps: readNestedNumber(row, [["spreadBps"]]),
    momentum30sPct: readNestedNumber(row, [["momentum30sPct"]]),
    momentum2mPct: readNestedNumber(row, [["momentum2mPct"]]),
    volatility1h: readNumber(
      readNestedNumber(row, [["risk", "var", "volatility1h"]]),
      readNestedNumber(riskRoot, [["var", "volatilityProxy"]])
    ),
    fundingRate: readNumber(
      readNestedNumber(row, [["fundingRate"]]),
      readNestedNumber(row, [["risk", "funding", "fundingRate"]])
    ),
    riskScore: readNumber(
      readNestedNumber(row, [["riskScore"]]),
      readNestedNumber(riskPosition, [["riskScore"]])
    ),
    portfolioRiskScore: readNestedNumber(riskRoot, [["riskScore"]]),
    maxAbsCorrelation: readNestedNumber(riskRoot, [["correlation", "maxAbsCorrelation"]]),
    symbolExposureUsd: readNestedNumber(riskPosition, [["notionalUsd"]]),
    grossExposureUsd: readNestedNumber(riskRoot, [["summary", "grossExposureUsd", "value"]])
  };
};

const resolveRiskPerTradePct = (
  verdict: OpportunityVerdict | undefined,
  confidence: number,
  riskLevel: PositionSizingRiskLevel,
  reasons: string[]
): number => {
  let riskPct = 0.5;

  if (verdict === "TRADE" && confidence > 80) {
    riskPct = 0.75;
    reasons.push("high confidence TRADE allows 0.75% risk");
  } else if (verdict === "WAIT") {
    riskPct = 0.25;
    reasons.push("WAIT verdict reduces risk to 0.25%");
  } else if (verdict === "DO_NOT_TRADE") {
    riskPct = 0;
    reasons.push("DO_NOT_TRADE verdict blocks sizing");
  }

  if (riskLevel === "HIGH") {
    riskPct *= 0.4;
    reasons.push("HIGH risk level reduces risk per trade");
  }

  if (riskLevel === "EXTREME") {
    riskPct = 0;
    reasons.push("EXTREME risk level blocks sizing");
  }

  return round(riskPct, 4);
};

const estimateStopDistancePct = (
  inputStopDistancePct: number | null | undefined,
  features: ExtractedPositionSizingFeatures,
  warnings: string[]
): number => {
  if (typeof inputStopDistancePct === "number" && Number.isFinite(inputStopDistancePct) && inputStopDistancePct > 0) {
    return round(clamp(inputStopDistancePct, 0.4, 5), 4);
  }

  const volatilityBased =
    typeof features.volatility1h === "number" && features.volatility1h > 0
      ? Math.abs(features.volatility1h) * 0.35
      : null;
  const momentumBased =
    Math.max(Math.abs(features.momentum30sPct ?? 0), Math.abs(features.momentum2mPct ?? 0)) * 0.7;
  const spreadBased = typeof features.spreadBps === "number" ? (features.spreadBps / 100) * 2.5 : null;

  const candidates = [volatilityBased, momentumBased > 0 ? momentumBased : null, spreadBased].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
  );

  if (candidates.length === 0) {
    warnings.push("Not enough data for stop estimate; using 1.2% fallback.");
    return 1.2;
  }

  return round(clamp(Math.max(...candidates), 0.4, 5), 4);
};

const calculateLiquidationBufferPct = (
  direction: PositionSizingDirection,
  markPrice: number | null,
  liquidationPrice: number | null
): number | null => {
  if (!markPrice || markPrice <= 0 || !liquidationPrice || liquidationPrice <= 0) {
    return null;
  }

  if (direction === "long") {
    return round(((markPrice - liquidationPrice) / markPrice) * 100, 4);
  }

  if (direction === "short") {
    return round(((liquidationPrice - markPrice) / markPrice) * 100, 4);
  }

  return null;
};

export class PositionSizingEngine {
  evaluate(input: PositionSizingInput): PositionSizingResult {
    const symbol = input.symbol.trim().toUpperCase();
    const reasons: string[] = [];
    const warnings: string[] = [];
    const constraints: string[] = [];
    const features = extractFeatures(input);
    const direction = normalizeDirection(
      input.direction ?? input.setupClassification?.direction ?? input.opportunityScore?.direction
    );
    const customEquity =
      typeof input.customEquityUsdt === "number" && Number.isFinite(input.customEquityUsdt) && input.customEquityUsdt > 0
        ? input.customEquityUsdt
        : null;
    const equity = customEquity ?? features.equity ?? input.defaultEquityUsdt;
    const rawEntryPrice = readNumber(input.entryPrice, features.markPrice, features.lastPrice);
    const priceNormalization =
      rawEntryPrice && rawEntryPrice > 0
        ? normalizePrice(symbol, rawEntryPrice, input.exchangeFilters)
        : { price: rawEntryPrice, warnings: [] as string[], filters: null };
    const entryPrice = priceNormalization.price;
    const opportunityConfidence = input.opportunityScore?.confidence ?? input.setupClassification?.confidence ?? 0;
    const confidence = opportunityConfidence <= 1 ? opportunityConfidence * 100 : opportunityConfidence;
    const riskLevel = normalizeRiskLevel(input.opportunityScore?.riskLevel, features);
    const resolvedRiskPerTradePct = resolveRiskPerTradePct(
      input.opportunityScore?.verdict,
      confidence,
      riskLevel,
      reasons
    );
    const customRiskPerTradePct =
      typeof input.customRiskPerTradePct === "number" &&
      Number.isFinite(input.customRiskPerTradePct) &&
      input.customRiskPerTradePct > 0
        ? clamp(input.customRiskPerTradePct, 0.05, 5)
        : null;
    const riskPerTradePct = customRiskPerTradePct ?? resolvedRiskPerTradePct;
    const stopDistancePct = estimateStopDistancePct(input.stopDistancePct, features, warnings);
    const liquidationBufferPct = calculateLiquidationBufferPct(
      direction,
      entryPrice,
      features.liquidationPrice
    );
    const exchangeFilterWarnings = [...priceNormalization.warnings];

    if (customEquity !== null) {
      reasons.push(`Using custom equity ${round(customEquity, 2)} USDT.`);
    } else if (features.equity === null) {
      warnings.push(`Account equity unknown; using fallback ${input.defaultEquityUsdt} USDT.`);
    }

    if (customRiskPerTradePct !== null) {
      reasons.push(`Using custom risk per trade ${round(customRiskPerTradePct, 4)}%.`);
    }

    if (direction === "unknown") {
      warnings.push("Not enough data: direction is unknown.");
    }

    if (!entryPrice || entryPrice <= 0) {
      warnings.push("Not enough data: entry/mark price is unavailable.");
    }

    if (liquidationBufferPct !== null && liquidationBufferPct < 5) {
      warnings.push("Critical liquidation safety buffer below 5%.");
      constraints.push("liquidation buffer cap");
    }

    const maxLeverageSafe = riskLevel === "LOW" && (liquidationBufferPct ?? 20) >= 20 ? 5 : riskLevel === "HIGH" ? 1 : riskLevel === "EXTREME" ? 0 : 3;
    const riskBudgetNotional =
      stopDistancePct > 0 ? (equity * (riskPerTradePct / 100)) / (stopDistancePct / 100) : 0;
    const equityLeverageCap = equity * maxLeverageSafe;
    const portfolioRiskMultiplier =
      riskLevel === "LOW" ? 1 : riskLevel === "MEDIUM" ? 0.7 : riskLevel === "HIGH" ? 0.35 : 0;
    const portfolioRiskCap = equity * 3 * portfolioRiskMultiplier;
    const symbolExposureCap = Math.max(equity * 0.35 - Math.abs(features.symbolExposureUsd ?? 0), 0);
    const correlationCap =
      typeof features.maxAbsCorrelation === "number" && features.maxAbsCorrelation >= 0.75
        ? equity * 1.25
        : equity * 3;
    let maxNotional = Math.min(equityLeverageCap, portfolioRiskCap, symbolExposureCap, correlationCap);

    constraints.push(`safe leverage cap ${maxLeverageSafe}x`);
    constraints.push("portfolio risk budget");
    constraints.push("symbol exposure cap");

    if (typeof features.maxAbsCorrelation === "number" && features.maxAbsCorrelation >= 0.75) {
      constraints.push("correlation cap");
      reasons.push("high correlation reduces max notional");
    }

    if (liquidationBufferPct !== null && liquidationBufferPct < 5) {
      maxNotional *= 0.1;
    } else if (liquidationBufferPct !== null && liquidationBufferPct < 10) {
      maxNotional *= 0.5;
      reasons.push("low liquidation buffer reduces size");
    }

    let recommendedNotional = Math.min(riskBudgetNotional, maxNotional);

    if (riskPerTradePct <= 0 || direction === "unknown" || !entryPrice || entryPrice <= 0) {
      recommendedNotional = 0;
    }
    const rawQty = entryPrice && entryPrice > 0 ? recommendedNotional / entryPrice : 0;
    const quantityNormalization = normalizeQuantity(symbol, rawQty, input.exchangeFilters);
    exchangeFilterWarnings.push(...quantityNormalization.warnings);
    let normalizedQty = quantityNormalization.quantity;
    const notionalValidation =
      entryPrice && entryPrice > 0
        ? validateNotional(symbol, normalizedQty, entryPrice, input.exchangeFilters)
        : { valid: true, notional: 0, warnings: [] as string[], filters: quantityNormalization.filters };
    exchangeFilterWarnings.push(...notionalValidation.warnings);

    if (!notionalValidation.valid) {
      normalizedQty = 0;
    }

    recommendedNotional = entryPrice && entryPrice > 0 ? normalizedQty * entryPrice : 0;

    const suggestedLeverage =
      recommendedNotional <= 0
        ? 0
        : riskLevel === "LOW" && (liquidationBufferPct ?? 20) >= 20
          ? Math.min(maxLeverageSafe, 5)
          : riskLevel === "HIGH"
            ? 1
            : Math.min(maxLeverageSafe, 3);

    return {
      symbol,
      direction,
      recommendedNotional: round(recommendedNotional, 2),
      maxNotional: round(Math.max(maxNotional, 0), 2),
      recommendedQty: round(normalizedQty, 8),
      rawQty: round(rawQty, 8),
      normalizedQty: round(normalizedQty, 8),
      minQty: quantityNormalization.filters?.minQty ?? priceNormalization.filters?.minQty ?? null,
      stepSize: quantityNormalization.filters?.stepSize ?? priceNormalization.filters?.stepSize ?? null,
      minNotional: quantityNormalization.filters?.minNotional ?? priceNormalization.filters?.minNotional ?? null,
      suggestedLeverage: round(suggestedLeverage, 2),
      riskPerTradePct,
      stopDistancePct,
      liquidationBufferPct,
      confidence: round(clamp(confidence, 0, 100), 2),
      riskLevel,
      reasons,
      warnings,
      exchangeFilterWarnings,
      constraints
    };
  }
}

export const positionSizingEngine = new PositionSizingEngine();
