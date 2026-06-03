import { clamp, round } from "../lib/math";
import type { ExecutionState } from "../execution/types";
import type { RegimeState } from "../regime/types";
import type { RegimeLearningPayload, RegimeLearningState } from "../regime-learning/types";
import type { ScreenerRow } from "../types/messages";
import type { ConflictSignalAgreement, ConflictState } from "./types";

const toDirection = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return clamp(value, -1, 1);
};

const mean = (values: readonly number[]): number => {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const variance = (values: readonly number[]): number => {
  if (!values.length) {
    return 0;
  }

  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
};

const resolveRiskVector = (regime: RegimeState, row: ScreenerRow | undefined): number => {
  const riskScore = regime.components.riskScore;
  if (Number.isFinite(riskScore) && riskScore !== 0) {
    return toDirection(riskScore);
  }

  if (row?.riskLevel === "LOW") {
    return 1;
  }

  if (row?.riskLevel === "MEDIUM") {
    return 0.25;
  }

  if (row?.riskLevel === "HIGH") {
    return -0.5;
  }

  if (row?.riskLevel === "CRITICAL") {
    return -1;
  }

  return 0;
};

const resolveAlignment = (signal: number, regime: number): number => {
  if (Math.abs(regime) < 0.05) {
    return Math.abs(signal) < 0.05 ? 1 : 0;
  }

  if (Math.abs(signal) < 0.05) {
    return 0;
  }

  return Math.sign(signal) === Math.sign(regime) ? 1 : 0;
};

export class SignalConflictEngine {
  build(input: {
    regime: RegimeState[];
    regimeLearning: RegimeLearningPayload | null | undefined;
    execution: ExecutionState[];
    rows: ScreenerRow[];
  }): ConflictState[] {
    const executionBySymbol = new Map<string, ExecutionState>(
      input.execution.map((item) => [item.symbol, item] as const)
    );
    const learningBySymbol = new Map<string, RegimeLearningState>(
      (input.regimeLearning?.symbols ?? []).map((item) => [item.symbol, item] as const)
    );
    const rowBySymbol = new Map<string, ScreenerRow>(
      input.rows.map((row) => [row.symbol, row] as const)
    );

    return input.regime
      .map((regime) => {
        const execution = executionBySymbol.get(regime.symbol);
        const learning = learningBySymbol.get(regime.symbol);
        const row = rowBySymbol.get(regime.symbol);
        const signalAgreement: ConflictSignalAgreement = {
          risk: round(resolveRiskVector(regime, row), 4),
          funding: round(toDirection(regime.components.fundingScore), 4),
          flow: round(toDirection(regime.components.flowScore), 4),
          liquidation: round(toDirection(regime.components.liquidationScore), 4),
          regime: round(toDirection(regime.finalScore), 4)
        };

        const signalVector = [
          signalAgreement.risk,
          signalAgreement.funding,
          signalAgreement.flow,
          signalAgreement.liquidation,
          signalAgreement.regime
        ];
        const conflictIndex = round(clamp(variance(signalVector), 0, 1), 4);
        const consensusScore = round(clamp(1 - conflictIndex, 0, 1), 4);
        const regimeVector = signalAgreement.regime;
        const alignmentScore = round(
          clamp(
            mean([
              resolveAlignment(signalAgreement.risk, regimeVector),
              resolveAlignment(signalAgreement.funding, regimeVector),
              resolveAlignment(signalAgreement.flow, regimeVector),
              resolveAlignment(signalAgreement.liquidation, regimeVector),
              1
            ]),
            0,
            1
          ),
          4
        );
        const baseExecutionConfidence = clamp((execution?.executionScore ?? 0) * 100, 0, 100);
        const learningConfidence = clamp(learning?.confidence ?? regime.confidence, 0, 100);
        const adjustedConfidence = round(
          clamp(
            ((baseExecutionConfidence * 0.6 + learningConfidence * 0.4) *
              (0.5 + 0.5 * consensusScore)),
            0,
            100
          ),
          2
        );

        return {
          symbol: regime.symbol,
          conflictIndex,
          consensusScore,
          alignmentScore,
          signalAgreement,
          adjustedConfidence
        };
      })
      .sort((left, right) => {
        return (
          right.adjustedConfidence - left.adjustedConfidence ||
          right.consensusScore - left.consensusScore ||
          left.conflictIndex - right.conflictIndex ||
          left.symbol.localeCompare(right.symbol)
        );
      });
  }
}
