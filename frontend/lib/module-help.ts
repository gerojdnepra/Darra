export interface ModuleHelpContent {
  title: string;
  shows: string;
  why: string;
  interpret: string;
  ignore: string;
}

export type ModuleHelpId =
  | "decisionDashboard"
  | "screener"
  | "signalTape"
  | "chart"
  | "marketFlow"
  | "cvd"
  | "oi"
  | "liquidations"
  | "fundingBasis"
  | "riskCenter"
  | "positionRiskOrchestrator"
  | "tradingTicket"
  | "activeTrades"
  | "account"
  | "feedHealth"
  | "decisionStack"
  | "symbolDetailRail"
  | "marketStory"
  | "knowledgeWorkspace"
  | "replay";

export const moduleHelp: Record<ModuleHelpId, ModuleHelpContent> = {
  decisionDashboard: {
    title: "Workflow Dashboard",
    shows: "A read-only state view for Signal, Decision, Context, Execution, Positions, Review and Trading Lessons.",
    why: "It makes the beta workflow visible before the supporting workspace panels.",
    interpret: "Read each card as current system readiness and evidence coverage.",
    ignore: "Ignore it as an execution surface; it can focus sections but never submits orders."
  },
  screener: {
    title: "Signal",
    shows: "Ranked symbols and signal context from the backend frame.",
    why: "It is the Signal stage of the beta workflow.",
    interpret: "Use score, momentum, volume impulse, spread, liquidations and tags as evidence.",
    ignore: "Ignore rows with stale data, weak liquidity, wide spreads or no matching setup."
  },
  signalTape: {
    title: "Decision",
    shows: "Recent alerts and unified signal events ready for ENTER, WAIT or SKIP.",
    why: "It is the Decision stage entry point after a signal becomes actionable.",
    interpret: "Use actionable, high-priority signals with flow and risk context.",
    ignore: "Ignore review/noise signals unless you are doing post-session analysis."
  },
  chart: {
    title: "Context",
    shows: "A symbol-focused context view built from current backend fields.",
    why: "It keeps price, flow and invalidation context together in one central workspace.",
    interpret: "Read zones as UI scaffolding until a real chart engine is added later.",
    ignore: "Ignore projected zones when the selected symbol has no fresh row data."
  },
  marketFlow: {
    title: "Market Flow",
    shows: "Backend open-interest, CVD and directional pressure context.",
    why: "Flow helps confirm whether attention is supported by positioning and aggression.",
    interpret: "Look for agreement between OI change, CVD slope, buy ratio and liquidation context.",
    ignore: "Ignore flow when the feed is degraded or values are missing for the selected symbol."
  },
  cvd: {
    title: "CVD",
    shows: "Cumulative volume delta direction from backend flow.",
    why: "It gives a compact view of aggressive buyer/seller pressure.",
    interpret: "Positive slope supports demand; negative slope warns of sell pressure.",
    ignore: "Ignore isolated CVD changes without liquidity, OI or price confirmation."
  },
  oi: {
    title: "Open Interest",
    shows: "Current OI and backend-computed OI changes.",
    why: "It helps distinguish fresh participation from thin price movement.",
    interpret: "Rising OI with aligned momentum can confirm participation.",
    ignore: "Ignore OI when exchange data is missing or stale."
  },
  liquidations: {
    title: "Liquidations",
    shows: "Recent liquidation pressure and heat by symbol.",
    why: "Liquidations can explain sudden acceleration or exhaustion.",
    interpret: "Use liquidation bias and 5m notional as context, not as a standalone entry.",
    ignore: "Ignore tiny liquidation prints on illiquid symbols."
  },
  fundingBasis: {
    title: "Funding Rate",
    shows: "Funding rate, annualized pressure and basis context.",
    why: "Extreme funding can make a setup crowded or expensive to hold.",
    interpret: "Treat high absolute funding/basis as a risk modifier.",
    ignore: "Ignore small funding moves for very short scalp decisions unless spread is also poor."
  },
  riskCenter: {
    title: "Risk Center",
    shows: "Backend portfolio, liquidation, VaR, funding and flow risk.",
    why: "It is the account-level safety context for the workspace.",
    interpret: "Respect high risk levels, critical alerts and margin stress.",
    ignore: "Do not use it as order authorization; the ticket and backend validation remain final."
  },
  positionRiskOrchestrator: {
    title: "Position Risk",
    shows: "Backend position capacity, liquidation stress, position-risk state and kill-switch status.",
    why: "It is read-only risk context for the Positions layer.",
    interpret: "Read it as current position capacity and gate context from backend snapshots.",
    ignore: "Ignore it as order authorization; Execution Ticket and backend validation remain final."
  },
  tradingTicket: {
    title: "Execution Ticket",
    shows: "Order-entry controls, Safety Check, Position Risk and Ready To Enter status.",
    why: "It is the Execution stage and the only UI surface that sends order intents.",
    interpret: "Review mode, quantity, protective levels and backend validation before submitting.",
    ignore: "Do not submit when confirmations, live gates or preflight checks are not ready."
  },
  activeTrades: {
    title: "Positions",
    shows: "Open live positions, paper positions, manual pins, lifecycle links and position risk context.",
    why: "It is the Positions stage after execution.",
    interpret: "Read paper/live state, lifecycle/review links and backend risk context as one position workspace.",
    ignore: "Ignore it as an order-entry surface; paper close/cancel controls keep their existing confirmations."
  },
  account: {
    title: "Execution",
    shows: "Execution Ticket, Safety Check, Position Risk, Ready To Enter status and account connectivity.",
    why: "Execution is its own workflow stage while account stays limited to connectivity, permissions, balances and status.",
    interpret: "Read the ticket and readiness summary before using account status for connection health.",
    ignore: "Do not treat Account connectivity as order authorization; Execution Ticket and backend validation remain final."
  },
  feedHealth: {
    title: "Feed Health",
    shows: "Backend feed, latency and frame transport status.",
    why: "Realtime decisions are only useful when data is fresh.",
    interpret: "Prefer live/healthy phases with recent messages and low latency.",
    ignore: "Ignore signal quality when feed state is degraded."
  },
  decisionStack: {
    title: "Decision Guide",
    shows: "Attention, flow, risk and readiness states for the selected symbol.",
    why: "It explains the path from radar to ticket without placing orders.",
    interpret: "PASS means enough context exists, WAIT means incomplete or mixed, BLOCK means a known gate is negative.",
    ignore: "Ignore it as an execution signal; it is an explanation layer only."
  },
  symbolDetailRail: {
    title: "Why It Matters",
    shows: "Why the selected symbol is in focus, flow confirmation, blockers, execution readiness and recent events.",
    why: "It turns backend fields into a compact human explanation beside the chart.",
    interpret: "GOOD is supportive context, WATCH is mixed or incomplete, BLOCKED is a known blocker, UNKNOWN means data is missing.",
    ignore: "Ignore it when no symbol is selected or when feed/risk data is stale."
  },
  marketStory: {
    title: "Signal Story",
    shows: "A short UI summary assembled from existing backend fields.",
    why: "It helps humans read the selected symbol quickly.",
    interpret: "Use it as context for investigation, not as an order instruction.",
    ignore: "Ignore it when the component says there is not enough data."
  },
  knowledgeWorkspace: {
    title: "Trading Lessons",
    shows: "Known links, unknown gaps, chain health, decision coverage, signal linkage, replay coverage, review completeness and playbook readiness.",
    why: "It makes saved lessons and missing context visible without adding new calculations.",
    interpret: "Read it as what the system knows, what it does not know and how much history can be reconstructed.",
    ignore: "Ignore it for trade timing, order sizing or execution decisions."
  },
  replay: {
    title: "Replay",
    shows: "Historical signal, decision, order, position and review timeline.",
    why: "It is a tool for reconstructing a Review.",
    interpret: "Use timeline and chain events to inspect what was visible and what happened next.",
    ignore: "Ignore replay when no reviewId or positionLifecycleId is available."
  }
};

export const getModuleHelp = (id: ModuleHelpId | string): ModuleHelpContent =>
  moduleHelp[id as ModuleHelpId] ?? {
    title: "Module",
    shows: "This module displays backend-driven terminal context.",
    why: "It helps explain one part of the current trading workspace.",
    interpret: "Compare it with price, flow, risk and account state before acting.",
    ignore: "Ignore this module when data is missing, stale or outside your workflow."
  };
