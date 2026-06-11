import { SignalRepository } from "./signal-repository";

const OUTCOME_HORIZONS_SEC = [60, 300, 900, 3600] as const;
const RECOVERY_LOOKBACK_MS = 60 * 60 * 1000;

type SignalDirection = "long" | "short" | "unknown";

interface MarketPriceRow {
  symbol: string;
  markPrice?: number;
  lastPrice?: number;
}

export interface TrackSignalInput {
  signalId: string;
  symbol: string;
  startPrice: number | null | undefined;
  createdAt: number;
  payload: unknown;
  direction?: string | null;
  completedHorizons?: Iterable<number>;
  recoveredOutcomeHorizons?: Iterable<number>;
}

interface PendingSignal {
  signalId: string;
  symbol: string;
  startPrice: number;
  createdAt: number;
  direction: SignalDirection;
  maxUpPct: number;
  maxDownPct: number;
  completedHorizons: Set<number>;
  recoveredOutcomeHorizons: Set<number>;
}

const normalizeSymbol = (symbol: string): string => symbol.trim().toUpperCase();

const isFinitePositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const getMarketPrice = (row: MarketPriceRow): number | null => {
  if (isFinitePositiveNumber(row.markPrice)) {
    return row.markPrice;
  }

  if (isFinitePositiveNumber(row.lastPrice)) {
    return row.lastPrice;
  }

  return null;
};

const toDirectionFromText = (value: string): SignalDirection => {
  const normalized = value.trim().toLowerCase();

  if (!normalized || normalized === "neutral" || normalized === "balanced") {
    return "unknown";
  }

  if (
    normalized.includes("long") ||
    normalized.includes("buy") ||
    normalized.includes("bull") ||
    normalized.includes("up")
  ) {
    return "long";
  }

  if (
    normalized.includes("short") ||
    normalized.includes("sell") ||
    normalized.includes("bear") ||
    normalized.includes("down")
  ) {
    return "short";
  }

  return "unknown";
};

const readPayloadDirectionCandidate = (payload: unknown, key: string): SignalDirection => {
  if (typeof payload !== "object" || payload === null) {
    return "unknown";
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? toDirectionFromText(value) : "unknown";
};

const inferDirection = (payload: unknown): SignalDirection => {
  const setupDirection = readPayloadDirectionCandidate(payload, "setupDirection");
  if (setupDirection !== "unknown") {
    return setupDirection;
  }

  if (typeof payload === "object" && payload !== null) {
    const setupClassification = (payload as Record<string, unknown>).setupClassification;
    const direction = readPayloadDirectionCandidate(setupClassification, "direction");

    if (direction !== "unknown") {
      return direction;
    }

    const opportunityScore = (payload as Record<string, unknown>).opportunityScore;
    const opportunityDirection = readPayloadDirectionCandidate(opportunityScore, "direction");

    if (opportunityDirection !== "unknown") {
      return opportunityDirection;
    }
  }

  for (const key of ["side", "direction", "bias", "signal", "type"]) {
    const direction = readPayloadDirectionCandidate(payload, key);

    if (direction !== "unknown") {
      return direction;
    }
  }

  return "unknown";
};

const calculatePctMove = (startPrice: number, currentPrice: number): number =>
  ((currentPrice - startPrice) / startPrice) * 100;

const roundPct = (value: number): number => Math.round(value * 10_000) / 10_000;

const resolveOutcomeMoves = (
  direction: SignalDirection,
  maxUpPct: number,
  maxDownPct: number
): { maxFavorablePct: number; maxAdversePct: number } => {
  if (direction === "long") {
    return {
      maxFavorablePct: roundPct(Math.max(0, maxUpPct)),
      maxAdversePct: roundPct(Math.max(0, -maxDownPct))
    };
  }

  if (direction === "short") {
    return {
      maxFavorablePct: roundPct(Math.max(0, -maxDownPct)),
      maxAdversePct: roundPct(Math.max(0, maxUpPct))
    };
  }

  return {
    maxFavorablePct: roundPct(Math.max(Math.abs(maxUpPct), Math.abs(maxDownPct))),
    maxAdversePct: roundPct(Math.min(Math.abs(maxUpPct), Math.abs(maxDownPct)))
  };
};

export class SignalOutcomeTracker {
  private readonly pendingSignals = new Map<string, PendingSignal>();
  private readonly writtenOutcomeKeys = new Set<string>();

  constructor(private readonly repository = new SignalRepository()) {}

  recoverPendingOutcomes(now = Date.now()): number {
    const candidates = this.repository.findSignalsMissingRecentOutcomes(
      now - RECOVERY_LOOKBACK_MS,
      OUTCOME_HORIZONS_SEC
    );
    let recoveredCount = 0;

    for (const signal of candidates) {
      const existingHorizons = new Set(signal.existingHorizons);
      const completedHorizons = OUTCOME_HORIZONS_SEC.filter((horizonSec) =>
        existingHorizons.has(horizonSec)
      );
      const recoveredOutcomeHorizons = OUTCOME_HORIZONS_SEC.filter(
        (horizonSec) =>
          !existingHorizons.has(horizonSec) && now - signal.createdAt >= horizonSec * 1000
      );

      if (completedHorizons.length === OUTCOME_HORIZONS_SEC.length) {
        continue;
      }

      this.trackSignal({
        signalId: signal.id,
        symbol: signal.symbol,
        startPrice: signal.price,
        createdAt: signal.createdAt,
        payload: signal.payload,
        direction: signal.setupDirection,
        completedHorizons,
        recoveredOutcomeHorizons
      });

      recoveredCount += 1;
    }

    if (recoveredCount > 0) {
      console.log(`Recovered ${recoveredCount} pending signal outcome tracker item(s).`);
    }

    return recoveredCount;
  }

  trackSignal(input: TrackSignalInput): void {
    const symbol = normalizeSymbol(input.symbol);

    if (
      !input.signalId ||
      !symbol ||
      !isFinitePositiveNumber(input.startPrice) ||
      !Number.isFinite(input.createdAt)
    ) {
      return;
    }

    if (this.pendingSignals.has(input.signalId)) {
      return;
    }

    const explicitDirection =
      typeof input.direction === "string" ? toDirectionFromText(input.direction) : "unknown";

    this.pendingSignals.set(input.signalId, {
      signalId: input.signalId,
      symbol,
      startPrice: input.startPrice,
      createdAt: input.createdAt,
      direction: explicitDirection === "unknown" ? inferDirection(input.payload) : explicitDirection,
      maxUpPct: 0,
      maxDownPct: 0,
      completedHorizons: new Set(input.completedHorizons ?? []),
      recoveredOutcomeHorizons: new Set(input.recoveredOutcomeHorizons ?? [])
    });
  }

  observeMarketRows(rows: MarketPriceRow[], observedAt = Date.now()): void {
    if (this.pendingSignals.size === 0) {
      return;
    }

    const priceBySymbol = new Map<string, number>();

    for (const row of rows) {
      const symbol = normalizeSymbol(row.symbol);
      const price = getMarketPrice(row);

      if (symbol && price !== null) {
        priceBySymbol.set(symbol, price);
      }
    }

    for (const signal of this.pendingSignals.values()) {
      const price = priceBySymbol.get(signal.symbol);

      if (price === undefined) {
        continue;
      }

      this.observeSignalPrice(signal, price, observedAt);
    }
  }

  private observeSignalPrice(signal: PendingSignal, price: number, observedAt: number): void {
    const movePct = calculatePctMove(signal.startPrice, price);
    signal.maxUpPct = Math.max(signal.maxUpPct, movePct);
    signal.maxDownPct = Math.min(signal.maxDownPct, movePct);

    for (const horizonSec of OUTCOME_HORIZONS_SEC) {
      if (signal.completedHorizons.has(horizonSec)) {
        continue;
      }

      if (observedAt - signal.createdAt < horizonSec * 1000) {
        continue;
      }

      this.writeOutcome(signal, horizonSec, price, observedAt);
    }

    if (signal.completedHorizons.size === OUTCOME_HORIZONS_SEC.length) {
      this.pendingSignals.delete(signal.signalId);
    }
  }

  private writeOutcome(
    signal: PendingSignal,
    horizonSec: number,
    endPrice: number,
    observedAt: number
  ): void {
    const outcomeKey = `${signal.signalId}:${horizonSec}`;

    if (this.writtenOutcomeKeys.has(outcomeKey)) {
      signal.completedHorizons.add(horizonSec);
      return;
    }

    const moves = resolveOutcomeMoves(signal.direction, signal.maxUpPct, signal.maxDownPct);

    try {
      const outcomeResult = this.repository.addSignalOutcome({
        signalId: signal.signalId,
        createdAt: observedAt,
        horizonSec,
        startPrice: signal.startPrice,
        endPrice,
        maxFavorablePct: moves.maxFavorablePct,
          maxAdversePct: moves.maxAdversePct,
        outcome: {
          ...(signal.recoveredOutcomeHorizons.has(horizonSec)
            ? {
                recovered: true,
                recoveredAfterRestart: true,
                note: "Recovered after backend restart; intra-horizon MFE/MAE may be incomplete"
              }
            : {}),
          direction: signal.direction,
          horizonSec,
          signalCreatedAt: signal.createdAt,
          observedAt,
          startPrice: signal.startPrice,
          endPrice,
          endMovePct: roundPct(calculatePctMove(signal.startPrice, endPrice)),
          maxUpPct: roundPct(signal.maxUpPct),
          maxDownPct: roundPct(signal.maxDownPct),
          maxFavorablePct: moves.maxFavorablePct,
          maxAdversePct: moves.maxAdversePct
        }
      });

      if (!outcomeResult.created) {
        this.writtenOutcomeKeys.add(outcomeKey);
        signal.completedHorizons.add(horizonSec);
        return;
      }

      this.writtenOutcomeKeys.add(outcomeKey);
      signal.completedHorizons.add(horizonSec);
    } catch (error) {
      console.warn("Could not persist signal outcome to SQLite", error);
    }
  }
}

export const signalOutcomeTracker = new SignalOutcomeTracker();
