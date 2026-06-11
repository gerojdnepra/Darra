"use client";

import { compactUsd, formatPercent } from "@/lib/format";
import type {
  FundingSymbolState,
  LiquidationState,
  LiveSafetyStateMessage,
  MarketFlowState,
  PositionCapacityState,
  PositionRiskOrchestratorState,
  ScreenerAlert,
  ScreenerRow
} from "@/lib/types";
import { LearningModeHelp } from "./learning-mode-help";
import { PanelHeader } from "./ui/panel-header";
import { StatusBadge, type StatusBadgeStatus } from "./ui/status-badge";

type RailStatus = "GOOD" | "WATCH" | "BLOCKED" | "UNKNOWN";

interface RailBlock {
  title: string;
  status: RailStatus;
  summary: string;
  items: string[];
}

interface SymbolDetailRailProps {
  selectedSymbol: string | null;
  row: ScreenerRow | null;
  flow: MarketFlowState | null;
  funding: FundingSymbolState | null;
  liquidations: LiquidationState | null;
  positionCapacity: PositionCapacityState | null | undefined;
  positionRiskOrchestrator: PositionRiskOrchestratorState | null | undefined;
  liveSafetyState: LiveSafetyStateMessage["payload"] | null;
  alerts: ScreenerAlert[];
  learningMode: boolean;
}

const valueOrDash = (value: number | null | undefined, digits = 2): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";

const railStatusToBadgeStatus = (status: RailStatus): StatusBadgeStatus => {
  if (status === "GOOD") {
    return "OK";
  }

  if (status === "WATCH") {
    return "CHECK";
  }

  return status;
};

const percentOrDash = (value: number | null | undefined, digits = 2): string =>
  typeof value === "number" && Number.isFinite(value) ? formatPercent(value, digits) : "--";

const fundingLabel = (row: ScreenerRow | null, funding: FundingSymbolState | null): string => {
  const value = funding?.fundingRate ?? row?.fundingRate;

  return typeof value === "number" && Number.isFinite(value)
    ? formatPercent(value * 100, 4)
    : "--";
};

const uniqueItems = (items: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();

  return items
    .map((item) => item?.trim())
    .filter((item): item is string => !!item)
    .filter((item) => {
      if (seen.has(item)) {
        return false;
      }

      seen.add(item);
      return true;
    });
};

export function SymbolDetailRail({
  selectedSymbol,
  row,
  flow,
  funding,
  liquidations,
  positionCapacity,
  positionRiskOrchestrator,
  liveSafetyState,
  alerts,
  learningMode
}: SymbolDetailRailProps) {
  const blocks = buildRailBlocks({
    selectedSymbol,
    row,
    flow,
    funding,
    liquidations,
    positionCapacity,
    positionRiskOrchestrator,
    liveSafetyState,
    alerts,
    learningMode
  });

  return (
    <aside className="h-full">
      <PanelHeader
        title="Symbol Detail Rail"
        subtitle={selectedSymbol ? `Why ${selectedSymbol} is in focus` : "Select a symbol to explain focus"}
        moduleId="symbolDetailRail"
        className="items-start"
      />

      <LearningModeHelp moduleId="symbolDetailRail" learningMode={learningMode} />

      <div className="mt-3 space-y-2">
        {blocks.map((block) => (
          <section key={block.title} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-100">{block.title}</div>
              <StatusBadge status={railStatusToBadgeStatus(block.status)}>
                {block.status}
              </StatusBadge>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">{block.summary}</p>
            {block.items.length ? (
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-500">
                {block.items.slice(0, 4).map((item) => (
                  <li key={item} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-caution/25 bg-caution/10 p-3 text-xs leading-5 text-caution">
        Explanation only. This rail does not send order intent or change risk gates.
      </div>
    </aside>
  );
}

function buildRailBlocks({
  selectedSymbol,
  row,
  flow,
  funding,
  liquidations,
  positionCapacity,
  positionRiskOrchestrator,
  liveSafetyState,
  alerts,
  learningMode
}: SymbolDetailRailProps): RailBlock[] {
  if (!selectedSymbol || !row) {
    const symbol = selectedSymbol ?? "No symbol";

    return [
      {
        title: "Why selected",
        status: "UNKNOWN",
        summary: `${symbol}: waiting for screener row context.`,
        items: ["Choose a row from Screener, Watchlist or Decision Inbox."]
      },
      {
        title: "Flow confirmation",
        status: "UNKNOWN",
        summary: "Waiting for price, CVD, OI, buy ratio and liquidation context.",
        items: []
      },
      {
        title: "Risk blockers",
        status: "UNKNOWN",
        summary: "No selected row means no blocker explanation yet.",
        items: []
      },
      {
        title: "Execution readiness",
        status: liveSafetyState ? "WATCH" : "UNKNOWN",
        summary: liveSafetyState
          ? `Safety mode ${liveSafetyState.mode}, ready ${liveSafetyState.ready ? "yes" : "no"}.`
          : "Waiting for live safety state.",
        items: []
      },
      {
        title: "Recent signal events",
        status: "UNKNOWN",
        summary: "No symbol-specific events can be shown until a symbol is selected.",
        items: []
      }
    ];
  }

  const whyTrade = row.whyTrade ?? [];
  const whyNotTrade = row.whyNotTrade ?? [];
  const criticalWhyNot = whyNotTrade.some((item) => item.severity === "critical");
  const warningWhyNot = whyNotTrade.some((item) => item.severity === "warning");
  const fundingValue = funding?.fundingRate ?? row.fundingRate;
  const spreadBlocked = typeof row.spreadBps === "number" && row.spreadBps > 25;
  const spreadWatch = typeof row.spreadBps === "number" && row.spreadBps > 12;
  const capacityBlocked = positionCapacity?.safeToAdd === false;
  const killSwitchBlocked =
    positionRiskOrchestrator?.killSwitchState === "EMERGENCY" ||
    positionRiskOrchestrator?.killSwitchState === "REDUCE_RISK" ||
    positionRiskOrchestrator?.killSwitchState === "STOP_ADDING";
  const liveBlocked =
    liveSafetyState?.ready === false ||
    liveSafetyState?.killSwitchActive === true ||
    liveSafetyState?.gates.killSwitchActive === true;
  const hasFlow =
    !!flow ||
    row.buyRatio60s !== 0.5 ||
    row.liquidation5m > 0 ||
    !!liquidations;
  const flowSignals = [
    flow ? `CVD slope ${valueOrDash(flow.cvd.slope, 2)} with ${flow.cvd.divergence} divergence` : null,
    flow ? `OI 5m ${percentOrDash(flow.openInterest.oiChange5m, 2)}` : null,
    `Buy ratio ${valueOrDash(row.buyRatio60s, 2)}`,
    `Liquidation bias ${row.liquidationBias}`,
    liquidations ? `5m liquidations ${compactUsd(liquidations.liquidations5m)}` : null
  ];
  const flowConfirmed =
    hasFlow &&
    ((flow ? Math.abs(flow.cvd.slope) > 0 || Math.abs(flow.openInterest.oiChange5m) > 0 : false) ||
      row.volumeImpulse >= 1.5 ||
      row.liquidation5m > 0);
  const recentAlerts = alerts
    .filter((alert) => alert.symbol === row.symbol)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 4);

  return [
    {
      title: "Why selected",
      status: whyTrade.length || row.score >= 60 || row.volumeImpulse >= 1.5 ? "GOOD" : "WATCH",
      summary: `${row.symbol} is focused from screener context: score ${row.score.toFixed(1)}, ${row.bias} bias, ${row.volumeImpulse.toFixed(2)}x volume impulse.`,
      items: uniqueItems([
        ...whyTrade.map((item) =>
          item.value !== undefined ? `${item.label}: ${item.value}` : item.label
        ),
        `Momentum ${formatPercent(row.momentum30sPct, 2)} / ${formatPercent(row.momentum2mPct, 2)}`,
        `Tags ${row.tags.length ? row.tags.slice(0, 4).join(", ") : "none"}`
      ])
    },
    {
      title: "Flow confirmation",
      status: !hasFlow ? "UNKNOWN" : flowConfirmed ? "GOOD" : "WATCH",
      summary: flowConfirmed
        ? "Movement has supporting flow context in the current frontend snapshot."
        : "Flow context is incomplete or mixed; keep it in watch state.",
      items: uniqueItems(flowSignals)
    },
    {
      title: "Risk blockers",
      status:
        criticalWhyNot || capacityBlocked || killSwitchBlocked || spreadBlocked || row.riskLevel === "CRITICAL"
          ? "BLOCKED"
          : warningWhyNot || spreadWatch || row.riskLevel === "HIGH"
            ? "WATCH"
            : "GOOD",
      summary: capacityBlocked
        ? `Position capacity blocks adding exposure: ${positionCapacity?.reason ?? "no reason provided"}.`
        : `Risk level ${row.riskLevel}, spread ${row.spreadBps === null ? "--" : `${row.spreadBps.toFixed(2)} bps`}, funding ${fundingLabel(row, funding)}.`,
      items: uniqueItems([
        ...whyNotTrade.map((item) =>
          item.value !== undefined ? `${item.label}: ${item.value}` : item.label
        ),
        positionCapacity ? `Safe-to-add ${positionCapacity.safeToAdd ? "yes" : "no"}: ${positionCapacity.reason}` : "Position capacity waiting",
        positionRiskOrchestrator ? `Kill switch ${positionRiskOrchestrator.killSwitchState}` : "Risk orchestrator waiting",
        `Liquidation bias ${row.liquidationBias}`
      ])
    },
    {
      title: "Execution readiness",
      status: liveBlocked || capacityBlocked ? "BLOCKED" : !liveSafetyState || !positionCapacity ? "UNKNOWN" : "GOOD",
      summary: liveSafetyState
        ? `Safety mode ${liveSafetyState.mode}, ready ${liveSafetyState.ready ? "yes" : "no"}, kill switch ${liveSafetyState.killSwitchActive ? "active" : "clear"}.`
        : "Waiting for live safety state and capacity context.",
      items: uniqueItems([
        liveSafetyState ? `Live trading ${liveSafetyState.liveTrading}` : "Live safety waiting",
        liveSafetyState ? `Typed confirm ${liveSafetyState.gates.requireTypedConfirm ? "required" : "not required"}` : null,
        positionCapacity ? `Capacity score ${positionCapacity.capacityScore.toFixed(1)}` : "Capacity waiting",
        positionRiskOrchestrator ? `Global risk multiplier ${positionRiskOrchestrator.globalRiskMultiplier.toFixed(2)}` : null
      ])
    },
    {
      title: "Recent signal events",
      status: recentAlerts.length === 0 ? "UNKNOWN" : recentAlerts.some((alert) => alert.severity === "critical") ? "WATCH" : "GOOD",
      summary:
        recentAlerts.length === 0
          ? "No recent selected-symbol alerts in the current frame."
          : `${recentAlerts.length} recent selected-symbol event${recentAlerts.length === 1 ? "" : "s"} in the current frame.`,
      items: recentAlerts.map((alert) => {
        const time = new Date(alert.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });

        return `${time} ${alert.severity.toUpperCase()} ${alert.bias}: ${alert.reason}`;
      })
    }
  ];
}
