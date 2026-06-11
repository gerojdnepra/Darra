import type {
  FundingSymbolState,
  LiquidationState,
  LiveSafetyStateMessage,
  MarketFlowState,
  PositionRiskOrchestratorState,
  ScreenerRow
} from "@/lib/types";
import { LearningModeHelp } from "./learning-mode-help";
import { PanelHeader } from "./ui/panel-header";
import { StatusBadge } from "./ui/status-badge";

type DecisionStatus = "OK" | "CHECK" | "BLOCKED" | "WAITING";

interface DecisionStep {
  label: string;
  status: DecisionStatus;
  detail: string;
}

interface DecisionStackProps {
  selectedSymbol: string | null;
  row: ScreenerRow | null;
  flow: MarketFlowState | null;
  funding: FundingSymbolState | null;
  liquidations: LiquidationState | null;
  positionRiskOrchestrator: PositionRiskOrchestratorState | null | undefined;
  liveSafetyState: LiveSafetyStateMessage["payload"] | null;
  learningMode: boolean;
}

export function DecisionStack({
  selectedSymbol,
  row,
  flow,
  funding,
  liquidations,
  positionRiskOrchestrator,
  liveSafetyState,
  learningMode
}: DecisionStackProps) {
  const steps = buildDecisionSteps({
    row,
    flow,
    funding,
    liquidations,
    positionRiskOrchestrator,
    liveSafetyState,
    learningMode
  });

  return (
    <div>
      <PanelHeader
        title="Decision Stack"
        subtitle={selectedSymbol ?? "Select a symbol from Screener or Decision Inbox"}
        moduleId="decisionStack"
      />

      <LearningModeHelp moduleId="decisionStack" learningMode={learningMode} />

      <div className="mt-3 space-y-2">
        {steps.map((step, index) => (
          <div key={step.label} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Step {index + 1}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{step.label}</div>
              </div>
              <StatusBadge status={step.status}>{step.status}</StatusBadge>
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-400">{step.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-caution/25 bg-caution/10 p-3 text-xs leading-5 text-caution">
        Explanation only. Execution Workspace remains the only place that sends order intent.
      </div>
    </div>
  );
}

function buildDecisionSteps({
  row,
  flow,
  funding,
  liquidations,
  positionRiskOrchestrator,
  liveSafetyState,
  learningMode
}: Omit<DecisionStackProps, "selectedSymbol">): DecisionStep[] {
  if (!row) {
    return [
      { label: "Attention", status: "WAITING", detail: "waiting for data" },
      { label: "Flow Confirm", status: "WAITING", detail: "waiting for data" },
      { label: "Risk Check", status: "WAITING", detail: "waiting for data" },
      { label: "Execution Ready", status: "WAITING", detail: "waiting for data" }
    ];
  }

  const hasAttention =
    Number.isFinite(row.score) ||
    Number.isFinite(row.momentum30sPct) ||
    Number.isFinite(row.volumeImpulse);
  const attentionPass = row.score >= 60 || Math.abs(row.momentum30sPct) >= 0.2 || row.volumeImpulse >= 1.5;

  const hasFlow =
    !!flow ||
    row.buyRatio60s > 0 ||
    row.liquidation5m > 0 ||
    !!liquidations;
  const flowPass =
    !!flow &&
    (Math.abs(flow.cvd.slope) > 0 ||
      Math.abs(flow.openInterest.oiChange5m) > 0 ||
      row.buyRatio60s !== 0.5 ||
      row.liquidation5m > 0);

  const capacity = positionRiskOrchestrator?.positionCapacity.find(
    (item) => item.symbol === row.symbol
  );
  const doNotTrade = row.risk?.funding
    ? Math.abs(row.risk.funding.annualizedFundingPressureScore) > 75
    : false;
  const spreadBlocked = typeof row.spreadBps === "number" && row.spreadBps > 25;
  const riskBlocked =
    row.riskLevel === "CRITICAL" ||
    capacity?.safeToAdd === false ||
    positionRiskOrchestrator?.killSwitchState === "EMERGENCY" ||
    positionRiskOrchestrator?.killSwitchState === "REDUCE_RISK" ||
    doNotTrade ||
    spreadBlocked;
  const riskWait =
    row.riskLevel === "HIGH" ||
    positionRiskOrchestrator?.killSwitchState === "CAUTION" ||
    Math.abs(funding?.fundingRate ?? row.fundingRate) > 0.001;

  const liveBlocked =
    liveSafetyState?.killSwitchActive === true ||
    liveSafetyState?.ready === false ||
    liveSafetyState?.gates.killSwitchActive === true;
  const liveUnknown = !liveSafetyState;

  return [
    {
      label: "Attention",
      status: !hasAttention ? "WAITING" : attentionPass ? "OK" : "CHECK",
      detail: `score ${row.score.toFixed(1)}, momentum ${row.momentum30sPct.toFixed(2)}%, volume impulse ${row.volumeImpulse.toFixed(2)}`
    },
    {
      label: "Flow Confirm",
      status: !hasFlow ? "WAITING" : flowPass ? "OK" : "CHECK",
      detail: flow
        ? `CVD slope ${flow.cvd.slope.toFixed(2)}, OI 5m ${flow.openInterest.oiChange5m.toFixed(2)}, buy ratio ${row.buyRatio60s.toFixed(2)}`
        : `Using row context: buy ratio ${row.buyRatio60s.toFixed(2)}, liquidations ${row.liquidation5m.toFixed(0)}`
    },
    {
      label: "Risk Check",
      status: riskBlocked ? "BLOCKED" : riskWait ? "CHECK" : "OK",
      detail: capacity
        ? `${capacity.safeToAdd ? "safe to add" : "not safe to add"}: ${capacity.reason}`
        : `risk ${row.riskLevel}, spread ${row.spreadBps === null ? "--" : row.spreadBps.toFixed(2)} bps, funding ${(funding?.fundingRate ?? row.fundingRate).toFixed(6)}`
    },
    {
      label: "Execution Ready",
      status: liveBlocked ? "BLOCKED" : liveUnknown ? "WAITING" : "OK",
      detail: liveSafetyState
        ? `${liveSafetyState.mode}, ready ${liveSafetyState.ready ? "yes" : "no"}, kill switch ${liveSafetyState.killSwitchActive ? "active" : "clear"}`
        : "waiting for live safety state"
    }
  ];
}
