import { round } from "../lib/math";
import type { PortfolioCorrelationState } from "./types";

interface CorrelationInput {
  symbol: string;
  returns: number[];
}

const computePearson = (left: number[], right: number[]): number => {
  const sampleSize = Math.min(left.length, right.length);
  if (sampleSize < 2) {
    return 0;
  }

  const leftSlice = left.slice(-sampleSize);
  const rightSlice = right.slice(-sampleSize);
  const leftMean = leftSlice.reduce((sum, value) => sum + value, 0) / sampleSize;
  const rightMean = rightSlice.reduce((sum, value) => sum + value, 0) / sampleSize;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const leftValue = (leftSlice[index] ?? 0) - leftMean;
    const rightValue = (rightSlice[index] ?? 0) - rightMean;
    covariance += leftValue * rightValue;
    leftVariance += leftValue ** 2;
    rightVariance += rightValue ** 2;
  }

  if (leftVariance === 0 || rightVariance === 0) {
    return 0;
  }

  return covariance / Math.sqrt(leftVariance * rightVariance);
};

export class CorrelationEngine {
  compute(inputs: CorrelationInput[]): PortfolioCorrelationState {
    const filtered = inputs.filter((input) => input.returns.length > 0);
    const symbols = filtered.map((input) => input.symbol);
    const correlationMatrix: Record<string, Record<string, number>> = {};
    const pairs: PortfolioCorrelationState["correlationHeatmap"]["pairs"] = [];
    const sampleSize =
      filtered.length > 0 ? Math.min(...filtered.map((input) => input.returns.length)) : 0;

    for (const symbol of symbols) {
      correlationMatrix[symbol] = {};
    }

    for (let rowIndex = 0; rowIndex < filtered.length; rowIndex += 1) {
      const left = filtered[rowIndex];
      if (!left) {
        continue;
      }

      for (let columnIndex = rowIndex; columnIndex < filtered.length; columnIndex += 1) {
        const right = filtered[columnIndex];
        if (!right) {
          continue;
        }

        const correlation =
          left.symbol === right.symbol ? 1 : round(computePearson(left.returns, right.returns), 4);

        correlationMatrix[left.symbol]![right.symbol] = correlation;
        correlationMatrix[right.symbol]![left.symbol] = correlation;

        if (left.symbol !== right.symbol) {
          pairs.push({
            symbolA: left.symbol,
            symbolB: right.symbol,
            correlation,
            intensity: round(Math.abs(correlation), 4)
          });
        }
      }
    }

    return {
      symbols,
      sampleSize,
      correlationMatrix,
      correlationHeatmap: {
        pairs: pairs.sort(
          (left, right) => right.intensity - left.intensity || left.symbolA.localeCompare(right.symbolA)
        )
      }
    };
  }
}
