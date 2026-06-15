import { compactUsd, formatPercent } from "@/lib/format";
import { formatOpenInterestFreshness, isFreshOpenInterest } from "@/lib/open-interest";
import type {
  FundingSymbolState,
  LiquidationState,
  MarketFlowState,
  ScreenerRow
} from "@/lib/types";
import { ModuleInfoButton } from "./module-info-button";

interface MarketStoryProps {
  selectedSymbol: string | null;
  row: ScreenerRow | null;
  flow: MarketFlowState | null;
  funding: FundingSymbolState | null;
  liquidations: LiquidationState | null;
}

export function MarketStory({
  selectedSymbol,
  row,
  flow,
  funding,
  liquidations
}: MarketStoryProps) {
  const story = buildMarketStory({ selectedSymbol, row, flow, funding, liquidations });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Market Story
          </h2>
          <p className="text-xs text-slate-500">{selectedSymbol ?? "symbol context"}</p>
        </div>
        <ModuleInfoButton moduleId="marketStory" />
      </div>

      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-300">
        {story}
      </div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
        UI summary only, not a trading recommendation.
      </div>
    </div>
  );
}

function buildMarketStory({
  selectedSymbol,
  row,
  flow,
  funding,
  liquidations
}: MarketStoryProps): string {
  if (!selectedSymbol || !row) {
    return "Недостаточно данных для истории рынка";
  }

  const sentences: string[] = [];
  const attention: string[] = [];

  if (row.score >= 60) {
    attention.push(`score is elevated at ${row.score.toFixed(1)}`);
  }

  if (row.volumeImpulse >= 1.25) {
    attention.push(`volume impulse is ${row.volumeImpulse.toFixed(2)}`);
  }

  if (Math.abs(row.momentum30sPct) >= 0.1) {
    attention.push(`30s momentum is ${formatPercent(row.momentum30sPct)}`);
  }

  if (attention.length === 0) {
    return "Недостаточно данных для истории рынка";
  }

  sentences.push(`${row.symbol} is in focus because ${attention.join(", ")}.`);

  if (flow) {
    sentences.push(
      `Flow context shows CVD slope ${flow.cvd.slope.toFixed(2)} and ${
        isFreshOpenInterest(flow)
          ? `OI 5m ${formatPercent(flow.openInterest.oiChange5m)}`
          : formatOpenInterestFreshness(flow)
      }.`
    );
  } else if (row.buyRatio60s > 0) {
    sentences.push(`Flow context is partial: buy ratio is ${row.buyRatio60s.toFixed(2)}.`);
  }

  if (liquidations && liquidations.liquidations5m > 0) {
    sentences.push(`Liquidations add ${compactUsd(liquidations.liquidations5m)} in recent 5m context.`);
  } else if (row.liquidation5m > 0) {
    sentences.push(`Row liquidation context is ${compactUsd(row.liquidation5m)} over 5m.`);
  }

  const fundingRate = funding?.fundingRate ?? row.fundingRate;
  const riskParts = [`risk status is ${row.riskLevel}`];
  if (Math.abs(fundingRate) > 0.001) {
    riskParts.push(`funding is elevated at ${formatPercent(fundingRate * 100, 4)}`);
  }
  if (typeof row.spreadBps === "number" && row.spreadBps > 10) {
    riskParts.push(`spread is ${row.spreadBps.toFixed(2)} bps`);
  }
  sentences.push(`Risk context: ${riskParts.join(", ")}.`);

  return sentences.slice(0, 5).join(" ");
}
