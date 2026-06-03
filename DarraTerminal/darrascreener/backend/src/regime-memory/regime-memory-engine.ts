import type { AllocationState } from "../allocation/types";
import type { ConflictState } from "../conflict/types";
import type { ExecutionState } from "../execution/types";
import type { FundingSymbolState } from "../funding/types";
import { clamp, round } from "../lib/math";
import type { MarketFlowState } from "../market-flow/types";
import type { MetaRegimeGovernorState } from "../meta-regime-governor/types";
import type { RegimeState } from "../regime/types";
import type { RegimeLearningPayload, RegimeLearningState } from "../regime-learning/types";
import type { SignalIntelligenceState } from "../signal-intelligence/types";
import type { ScreenerRow } from "../types/messages";
import type {
  ContinuityState,
  RegimeEcho,
  RegimeFingerprint,
  RegimeMemoryState,
  RegimeMemorySymbolState
} from "./types";

interface MemorySnapshot {
  timestamp: number;
  fingerprint: RegimeFingerprint;
  marketState: SignalIntelligenceState["marketState"];
}

class RingMemoryBuffer {
  private readonly entries: Array<MemorySnapshot | null>;
  private head = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.entries = new Array<MemorySnapshot | null>(capacity).fill(null);
  }

  push(entry: MemorySnapshot): void {
    this.entries[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  latest(): MemorySnapshot | null {
    if (this.size === 0) {
      return null;
    }

    const index = (this.head - 1 + this.capacity) % this.capacity;
    return this.entries[index] ?? null;
  }

  values(): MemorySnapshot[] {
    const snapshots: MemorySnapshot[] = [];

    for (let offset = 0; offset < this.size; offset += 1) {
      const index = (this.head - this.size + offset + this.capacity) % this.capacity;
      const entry = this.entries[index];
      if (entry) {
        snapshots.push(entry);
      }
    }

    return snapshots;
  }
}

const DEFAULT_BUFFER_CAPACITY = 120;
const TOP_ECHOES_LIMIT = 3;

const scaleUnitToSigned = (value: number): number => round(clamp(value * 2 - 1, -1, 1), 4);
const scalePercentToSigned = (value: number): number => round(clamp(value / 50 - 1, -1, 1), 4);

const scaleExecutionScore = (value: number): number =>
  round(clamp((clamp(value, 0, 1.5) / 1.5) * 2 - 1, -1, 1), 4);

const resolveFundingPressure = (funding: FundingSymbolState | undefined): number => {
  if (!funding) {
    return 0.5;
  }

  return clamp(
    clamp(Math.abs(funding.annualizedFunding) / 0.6, 0, 1) * 0.65 +
      clamp(Math.abs(funding.basisPct) / 2, 0, 1) * 0.35,
    0,
    1
  );
};

const resolveFlowImbalance = (
  flow: MarketFlowState | undefined,
  row: ScreenerRow | undefined
): number => {
  if (!flow && !row) {
    return 0;
  }

  const oiComponent = flow
    ? clamp(
        (flow.openInterest.oiChange5m * 0.5 +
          flow.openInterest.oiChange15m * 0.3 +
          flow.openInterest.oiChange1h * 0.2) /
          10,
        -1,
        1
      )
    : 0;
  const divergenceComponent = flow
    ? flow.cvd.divergence === "bullish"
      ? 1
      : flow.cvd.divergence === "bearish"
        ? -1
        : 0
    : 0;
  const slopeBase = Math.max(Math.abs(flow?.cvd.value ?? 0), 100_000);
  const slopeComponent = flow ? clamp((flow.cvd.slope ?? 0) / slopeBase, -1, 1) : 0;
  const riskFlowComponent =
    row?.risk.flow.directionalBias === "LONG"
      ? clamp((row.risk.flow.flowPressureScore ?? 0) / 100, -1, 1)
      : row?.risk.flow.directionalBias === "SHORT"
        ? clamp((row.risk.flow.flowPressureScore ?? 0) / 100, -1, 1)
        : clamp((row?.risk.flow.flowPressureScore ?? 0) / 100, -1, 1);

  return round(
    clamp(
      oiComponent * 0.4 +
        divergenceComponent * 0.25 +
        slopeComponent * 0.15 +
        riskFlowComponent * 0.2,
      -1,
      1
    ),
    4
  );
};

const resolveLiquidationStress = (row: ScreenerRow | undefined): number =>
  clamp((row?.risk.liquidationDistance.liquidationPressureIndex ?? 50) / 100, 0, 1);

const cosineSimilarity = (left: RegimeFingerprint, right: RegimeFingerprint): number => {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude <= 0 || rightMagnitude <= 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const resolveContinuityState = (rrs: number): ContinuityState => {
  if (rrs > 0.75) {
    return "ECHOING";
  }

  if (rrs >= 0.5) {
    return "STABLE_LOOP";
  }

  if (rrs >= 0.25) {
    return "DRIFTING";
  }

  return "UNSTRUCTURED";
};

const buildFingerprint = (input: {
  signal: SignalIntelligenceState;
  regime: RegimeState | undefined;
  conflict: ConflictState | undefined;
  execution: ExecutionState | undefined;
  funding: FundingSymbolState | undefined;
  flow: MarketFlowState | undefined;
  row: ScreenerRow | undefined;
  metaRegimeGovernor: MetaRegimeGovernorState;
}): RegimeFingerprint => {
  const allocationConcentration = input.metaRegimeGovernor.diagnostics.allocationConcentration;
  const fundingPressure = resolveFundingPressure(input.funding);
  const flowImbalance = resolveFlowImbalance(input.flow, input.row);
  const liquidationStress = resolveLiquidationStress(input.row);

  return [
    scalePercentToSigned(input.signal.shs),
    scaleUnitToSigned(input.signal.mrs),
    scaleUnitToSigned(input.signal.sdp),
    scalePercentToSigned(input.regime?.confidence ?? 50),
    scaleUnitToSigned(input.conflict?.conflictIndex ?? 0.5),
    scaleExecutionScore(input.execution?.executionScore ?? 0.5),
    scaleUnitToSigned(allocationConcentration),
    scaleUnitToSigned(fundingPressure),
    round(flowImbalance, 4),
    scaleUnitToSigned(liquidationStress)
  ];
};

export class RegimeMemoryEngine {
  private readonly buffers = new Map<string, RingMemoryBuffer>();

  constructor(private readonly capacity = DEFAULT_BUFFER_CAPACITY) {}

  private getBuffer(symbol: string): RingMemoryBuffer {
    const existing = this.buffers.get(symbol);
    if (existing) {
      return existing;
    }

    const created = new RingMemoryBuffer(this.capacity);
    this.buffers.set(symbol, created);
    return created;
  }

  build(input: {
    generatedAt: number;
    rows: ScreenerRow[];
    funding: FundingSymbolState[];
    marketFlow: MarketFlowState[];
    regime: RegimeState[];
    regimeLearning: RegimeLearningPayload | null | undefined;
    execution: ExecutionState[];
    conflict: ConflictState[];
    signalIntelligence: SignalIntelligenceState[];
    metaRegimeGovernor: MetaRegimeGovernorState;
  }): RegimeMemoryState {
    const rowBySymbol = new Map(input.rows.map((item) => [item.symbol, item] as const));
    const fundingBySymbol = new Map(input.funding.map((item) => [item.symbol, item] as const));
    const flowBySymbol = new Map(input.marketFlow.map((item) => [item.symbol, item] as const));
    const regimeBySymbol = new Map(input.regime.map((item) => [item.symbol, item] as const));
    const learningBySymbol = new Map<string, RegimeLearningState>(
      (input.regimeLearning?.symbols ?? []).map((item) => [item.symbol, item] as const)
    );
    const executionBySymbol = new Map(input.execution.map((item) => [item.symbol, item] as const));
    const conflictBySymbol = new Map(input.conflict.map((item) => [item.symbol, item] as const));

    const symbols: RegimeMemorySymbolState[] = input.signalIntelligence
      .map((signal) => {
        const symbol = signal.symbol;
        const regime = regimeBySymbol.get(symbol);
        const learning = learningBySymbol.get(symbol);
        const execution = executionBySymbol.get(symbol);
        const conflict = conflictBySymbol.get(symbol);
        const funding = fundingBySymbol.get(symbol);
        const flow = flowBySymbol.get(symbol);
        const row = rowBySymbol.get(symbol);
        const fingerprint = buildFingerprint({
          signal,
          regime,
          conflict,
          execution,
          funding,
          flow,
          row,
          metaRegimeGovernor: input.metaRegimeGovernor
        });
        const buffer = this.getBuffer(symbol);
        const historicalValues = buffer.values();
        const previousSnapshot = buffer.latest();

        const regimeEchoes: RegimeEcho[] = historicalValues
          .map((snapshot) => ({
            timestamp: snapshot.timestamp,
            similarity: round(clamp(cosineSimilarity(fingerprint, snapshot.fingerprint), 0, 1), 4),
            marketState: snapshot.marketState
          }))
          .sort((left, right) => right.similarity - left.similarity || right.timestamp - left.timestamp)
          .slice(0, TOP_ECHOES_LIMIT);

        const rrs = round(average(regimeEchoes.map((item) => item.similarity)), 4);
        const previousSimilarity = previousSnapshot
          ? clamp(cosineSimilarity(fingerprint, previousSnapshot.fingerprint), 0, 1)
          : 0;
        const rdi = round(previousSnapshot ? 1 - previousSimilarity : 1, 4);
        const memoryConfidence = round(
          clamp(rrs * 0.6 + clamp(signal.shs / 100, 0, 1) * 0.4, 0, 1),
          4
        );

        buffer.push({
          timestamp: input.generatedAt,
          fingerprint,
          marketState: signal.marketState
        });

        return {
          symbol,
          marketState: signal.marketState,
          continuityState: resolveContinuityState(rrs),
          rrs,
          rdi,
          memoryConfidence,
          learningConfidence: round((learning?.confidence ?? regime?.confidence ?? 0) / 100, 4),
          fingerprint,
          regimeEchoes
        };
      })
      .sort((left, right) => {
        return (
          right.memoryConfidence - left.memoryConfidence ||
          right.rrs - left.rrs ||
          left.rdi - right.rdi ||
          right.learningConfidence - left.learningConfidence ||
          left.symbol.localeCompare(right.symbol)
        );
      });

    const lead = symbols[0] ?? null;

    return {
      generatedAt: input.generatedAt,
      symbol: lead?.symbol ?? null,
      marketState: lead?.marketState ?? null,
      continuityState: lead?.continuityState ?? "UNSTRUCTURED",
      rrs: lead?.rrs ?? 0,
      rdi: lead?.rdi ?? 1,
      memoryConfidence: lead?.memoryConfidence ?? 0,
      tradePermission: input.metaRegimeGovernor.tradePermission,
      marketMode: input.metaRegimeGovernor.marketMode,
      topRegimeEchoes: lead?.regimeEchoes ?? [],
      symbols
    };
  }
}
