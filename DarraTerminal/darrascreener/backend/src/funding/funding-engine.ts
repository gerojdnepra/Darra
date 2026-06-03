import { round } from "../lib/math";
import type { ScreenerRow } from "../types/messages";
import type { FundingSortMode, FundingSortedViews, FundingSymbolState } from "./types";

const FUNDING_INTERVALS_PER_DAY = 3;
const DAYS_PER_YEAR = 365;

export class FundingEngine {
  build(rows: ScreenerRow[]): FundingSymbolState[] {
    return rows
      .map((row) => {
        const fundingRate = row.risk.funding.fundingRate;
        const markPrice = round(row.markPrice, 6);
        const basisPct = round(row.risk.funding.basisPct, 4);
        const indexPrice = round(markPrice - row.risk.funding.basisUsd, 6);
        const annualizedFunding = round(
          fundingRate * FUNDING_INTERVALS_PER_DAY * DAYS_PER_YEAR,
          6
        );

        return {
          symbol: row.symbol,
          fundingRate,
          annualizedFunding,
          basisPct,
          premiumPct: basisPct,
          markPrice,
          indexPrice,
          };
      })
      .filter(
        (item) =>
          item.markPrice > 0 || item.indexPrice > 0 || item.fundingRate !== 0 || item.basisPct !== 0
      )
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  getFundingSorted(
    states: FundingSymbolState[],
    mode: FundingSortMode
  ): FundingSymbolState[] {
    const sorted = [...states];

    sorted.sort((left, right) => {
      if (mode === "highest") {
        return (
          right.fundingRate - left.fundingRate ||
          Math.abs(right.basisPct) - Math.abs(left.basisPct) ||
          left.symbol.localeCompare(right.symbol)
        );
      }

      if (mode === "lowest") {
        return (
          left.fundingRate - right.fundingRate ||
          Math.abs(right.basisPct) - Math.abs(left.basisPct) ||
          left.symbol.localeCompare(right.symbol)
        );
      }

      return (
        Math.abs(right.basisPct) - Math.abs(left.basisPct) ||
        right.fundingRate - left.fundingRate ||
        left.symbol.localeCompare(right.symbol)
      );
    });

    return sorted;
  }

  buildSortedViews(states: FundingSymbolState[]): FundingSortedViews {
    return {
      highest: this.getFundingSorted(states, "highest"),
      lowest: this.getFundingSorted(states, "lowest"),
      basis: this.getFundingSorted(states, "basis")
    };
  }
}
