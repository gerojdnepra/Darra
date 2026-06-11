export type SetupType =
  | "MOMENTUM_CONTINUATION"
  | "SHORT_SQUEEZE"
  | "LONG_SQUEEZE"
  | "LIQUIDATION_REVERSAL"
  | "FUNDING_TRAP"
  | "OI_BREAKOUT"
  | "CVD_DIVERGENCE"
  | "DEAD_COIN_REVIVAL"
  | "RISK_OFF_BREAKDOWN"
  | "UNKNOWN";

export type SetupDirection = "long" | "short" | "unknown";

export interface SetupClassification {
  setupType: SetupType;
  confidence: number;
  reasons: string[];
  invalidationHints: string[];
  direction: SetupDirection;
  tags: string[];
}

export interface SetupClassifierInput {
  symbol: string;
  type: string;
  source: string;
  severity?: string | null;
  price?: number | null;
  score?: number | null;
  payload: unknown;
  features?: unknown;
}

interface ExtractedFeatures {
  momentum30sPct: number | null;
  momentum2mPct: number | null;
  volumeImpulse: number | null;
  buyRatio60s: number | null;
  tradeNotional60s: number | null;
  liquidation5m: number | null;
  liquidationBias: string | null;
  spreadBps: number | null;
  fundingRate: number | null;
  basisPct: number | null;
  riskScore: number | null;
  marketPulse: number | null;
  dominantRegime: string | null;
  cvdSlope: number | null;
  cvdDivergence: string | null;
  oiChange5m: number | null;
  oiChange15m: number | null;
  signalConfidence: number | null;
  marketState: string | null;
  alertBias: string | null;
}

const UNKNOWN_CLASSIFICATION: SetupClassification = {
  setupType: "UNKNOWN",
  confidence: 0,
  reasons: [],
  invalidationHints: ["insufficient classified setup context"],
  direction: "unknown",
  tags: ["unknown"]
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

const readNumber = (value: unknown, paths: string[][]): number | null => {
  for (const path of paths) {
    const candidate = readPath(value, path);

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
};

const readString = (value: unknown, paths: string[][]): string | null => {
  for (const path of paths) {
    const candidate = readPath(value, path);

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const resolveTextDirection = (value: unknown): SetupDirection => {
  const normalized = normalizeText(value);

  if (!normalized || normalized === "neutral" || normalized === "balanced") {
    return "unknown";
  }

  if (
    normalized.includes("long") ||
    normalized.includes("buy") ||
    normalized.includes("bull") ||
    normalized.includes("up") ||
    normalized.includes("shorts_hit")
  ) {
    return "long";
  }

  if (
    normalized.includes("short") ||
    normalized.includes("sell") ||
    normalized.includes("bear") ||
    normalized.includes("down") ||
    normalized.includes("longs_hit")
  ) {
    return "short";
  }

  return "unknown";
};

const inferDirection = (input: SetupClassifierInput, features: ExtractedFeatures): SetupDirection => {
  for (const key of ["side", "direction", "bias", "signal", "type"]) {
    const direction = resolveTextDirection(readPath(input.payload, [key]));

    if (direction !== "unknown") {
      return direction;
    }
  }

  const flowDirection = resolveTextDirection(readPath(input.features, ["marketFlow", "cvd", "direction"]));
  if (flowDirection !== "unknown") {
    return flowDirection;
  }

  if (typeof features.momentum30sPct === "number" && Math.abs(features.momentum30sPct) >= 0.8) {
    return features.momentum30sPct > 0 ? "long" : "short";
  }

  return "unknown";
};

const clampConfidence = (value: number): number => Math.round(Math.min(Math.max(value, 0), 1) * 100) / 100;

const extractFeatures = (input: SetupClassifierInput): ExtractedFeatures => ({
  momentum30sPct: readNumber(input.features, [["row", "momentum30sPct"]]),
  momentum2mPct: readNumber(input.features, [["row", "momentum2mPct"]]),
  volumeImpulse: readNumber(input.features, [["row", "volumeImpulse"]]),
  buyRatio60s: readNumber(input.features, [["row", "buyRatio60s"]]),
  tradeNotional60s: readNumber(input.features, [["row", "tradeNotional60s"]]),
  liquidation5m:
    readNumber(input.features, [["row", "liquidation5m"], ["liquidations", "liquidations5m"]]) ??
    readNumber(input.payload, [["notionalUsd"]]),
  liquidationBias: readString(input.features, [["row", "liquidationBias"]]),
  spreadBps: readNumber(input.features, [["row", "spreadBps"]]),
  fundingRate: readNumber(input.features, [["row", "fundingRate"], ["funding", "fundingRate"]]),
  basisPct: readNumber(input.features, [["funding", "basisPct"], ["row", "risk", "funding", "basisPct"]]),
  riskScore: readNumber(input.features, [["row", "riskScore"]]),
  marketPulse: readNumber(input.features, [["overview", "marketPulse"]]),
  dominantRegime: readString(input.features, [["overview", "dominantRegime"]]),
  cvdSlope: readNumber(input.features, [["marketFlow", "cvd", "slope"]]),
  cvdDivergence: readString(input.features, [["marketFlow", "cvd", "divergence"]]),
  oiChange5m: readNumber(input.features, [["marketFlow", "openInterest", "oiChange5m"]]),
  oiChange15m: readNumber(input.features, [["marketFlow", "openInterest", "oiChange15m"]]),
  signalConfidence: readNumber(input.payload, [["adjustedSystemConfidence"]]),
  marketState: readString(input.payload, [["marketState"]]),
  alertBias: readString(input.payload, [["bias"]])
});

const buildClassification = (
  setupType: SetupType,
  confidence: number,
  direction: SetupDirection,
  reasons: string[],
  invalidationHints: string[],
  tags: string[]
): SetupClassification => ({
  setupType,
  confidence: clampConfidence(confidence),
  reasons,
  invalidationHints,
  direction,
  tags
});

export class SetupClassifierEngine {
  classify(input: SetupClassifierInput): SetupClassification {
    const features = extractFeatures(input);
    const direction = inferDirection(input, features);
    const sourceTypeText = `${input.source} ${input.type} ${JSON.stringify(input.payload ?? {})}`.toLowerCase();

    if (sourceTypeText.includes("reviving") || sourceTypeText.includes("dead_coin")) {
      return buildClassification(
        "DEAD_COIN_REVIVAL",
        0.92,
        "long",
        ["reviving coin signal source or payload detected"],
        ["24h volume fades back below revival threshold", "no follow-through after initial impulse"],
        ["reviving_coin", "liquidity_return"]
      );
    }

    const momentum = features.momentum30sPct ?? features.momentum2mPct ?? 0;
    const volumeImpulse = features.volumeImpulse ?? 0;
    const liquidationNotional = features.liquidation5m ?? 0;
    const buyRatio = features.buyRatio60s ?? 0.5;
    const cvdSlope = features.cvdSlope ?? 0;
    const oiExpansion = Math.max(Math.abs(features.oiChange5m ?? 0), Math.abs(features.oiChange15m ?? 0));
    const spreadOk = features.spreadBps === null || features.spreadBps <= 8;
    const fundingRate = features.fundingRate ?? 0;
    const basisPct = features.basisPct ?? 0;

    if (
      momentum >= 0.8 &&
      (features.liquidationBias === "SHORTS_HIT" || buyRatio >= 0.62 || cvdSlope > 0) &&
      (oiExpansion >= 0.8 || liquidationNotional >= 400_000)
    ) {
      return buildClassification(
        "SHORT_SQUEEZE",
        0.8,
        "long",
        ["price impulse up with short-side liquidation or buy aggression", "OI expansion or high liquidation notional"],
        ["price loses impulse low", "CVD flips negative", "OI expansion disappears"],
        ["squeeze", "short_liquidations", "long_bias"]
      );
    }

    if (
      momentum <= -0.8 &&
      (features.liquidationBias === "LONGS_HIT" || buyRatio <= 0.38 || cvdSlope < 0) &&
      (oiExpansion >= 0.8 || liquidationNotional >= 400_000)
    ) {
      return buildClassification(
        "LONG_SQUEEZE",
        0.8,
        "short",
        ["price impulse down with long-side liquidation or sell aggression", "OI expansion or high liquidation notional"],
        ["price reclaims impulse high", "CVD flips positive", "liquidation pressure fades"],
        ["squeeze", "long_liquidations", "short_bias"]
      );
    }

    if (Math.abs(momentum) >= 0.6 && oiExpansion >= 1 && volumeImpulse >= 1.8) {
      return buildClassification(
        "OI_BREAKOUT",
        0.74,
        direction,
        ["price impulse with open interest expansion and elevated volume impulse"],
        ["OI contracts back into range", "volume impulse normalizes"],
        ["open_interest", "breakout"]
      );
    }

    if (
      Math.abs(fundingRate) >= 0.0005 &&
      Math.abs(momentum) >= 0.4 &&
      Math.sign(fundingRate) === Math.sign(momentum) &&
      Math.abs(cvdSlope) < 0.15 &&
      oiExpansion < 0.5
    ) {
      return buildClassification(
        "FUNDING_TRAP",
        0.68,
        momentum > 0 ? "short" : "long",
        ["extreme funding moves with weak CVD/OI confirmation", "movement aligns with crowded funding side"],
        ["CVD confirms crowded direction", "OI expands with continuation"],
        ["funding", "trap", basisPct > 0 ? "positive_basis" : "negative_basis"]
      );
    }

    if (
      liquidationNotional >= 750_000 &&
      Math.abs(momentum) <= 0.45 &&
      ((features.liquidationBias === "SHORTS_HIT" && cvdSlope < 0) ||
        (features.liquidationBias === "LONGS_HIT" && cvdSlope > 0))
    ) {
      return buildClassification(
        "LIQUIDATION_REVERSAL",
        0.66,
        features.liquidationBias === "SHORTS_HIT" ? "short" : "long",
        ["large liquidation event with fading continuation and opposite flow appearing"],
        ["price extends in liquidation direction", "opposite flow fails"],
        ["liquidation", "reversal"]
      );
    }

    if (
      (momentum > 0.5 && (features.cvdDivergence === "bearish" || cvdSlope < -0.1)) ||
      (momentum < -0.5 && (features.cvdDivergence === "bullish" || cvdSlope > 0.1))
    ) {
      return buildClassification(
        "CVD_DIVERGENCE",
        0.7,
        momentum > 0 ? "short" : "long",
        ["price direction diverges from CVD pressure"],
        ["CVD realigns with price", "price breaks divergence invalidation level"],
        ["cvd", "divergence"]
      );
    }

    if (Math.abs(momentum) >= 0.65 && volumeImpulse >= 1.8 && spreadOk) {
      const cvdConfirms = (momentum > 0 && cvdSlope >= -0.05) || (momentum < 0 && cvdSlope <= 0.05);
      if (cvdConfirms) {
        return buildClassification(
          "MOMENTUM_CONTINUATION",
          0.72,
          momentum > 0 ? "long" : "short",
          ["price impulse with volume impulse and acceptable spread", "CVD does not oppose direction"],
          ["volume impulse fades", "spread widens", "CVD divergence appears"],
          ["momentum", "continuation"]
        );
      }
    }

    if (
      features.dominantRegime === "risk-off" &&
      (features.marketPulse ?? 0) < -20 &&
      (features.riskScore ?? 0) >= 55 &&
      direction === "short"
    ) {
      return buildClassification(
        "RISK_OFF_BREAKDOWN",
        0.7,
        "short",
        ["risk-off regime with negative market pulse and elevated risk score"],
        ["market pulse recovers", "risk score normalizes", "flow flips positive"],
        ["risk_off", "breakdown"]
      );
    }

    if (features.marketState === "DISORDER" && (features.signalConfidence ?? 0) < 35) {
      return buildClassification(
        "UNKNOWN",
        0.25,
        direction,
        ["signal intelligence marks disorder with low confidence"],
        UNKNOWN_CLASSIFICATION.invalidationHints,
        ["unknown", "low_confidence"]
      );
    }

    return {
      ...UNKNOWN_CLASSIFICATION,
      direction
    };
  }
}

export const setupClassifierEngine = new SetupClassifierEngine();
