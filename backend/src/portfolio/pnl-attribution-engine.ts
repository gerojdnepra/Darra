import { round } from "../lib/math";
import type { PortfolioPnlState, PortfolioPositionInput } from "./types";

export class PnlAttributionEngine {
  compute(positions: PortfolioPositionInput[]): PortfolioPnlState {
    const realized = 0;
    const funding = 0;
    const fees = 0;
    const unrealized = round(
      positions.reduce((sum, position) => sum + position.unrealizedPnlUsd, 0),
      2
    );

    return {
      realized,
      unrealized,
      funding,
      fees,
      net: round(realized + unrealized + funding - fees, 2)
    };
  }
}
