import { useMemo } from "react";
import { type CommandCenterTone } from "@/components/scalp-station/why-this-matters-helpers";
import type { AccountStreamStatus, ScreenerFrame } from "@/lib/types";

// Minimal type - only the fields actually used by the hook
// Compatible with DecisionInboxItem from scalp-station-app.tsx by allowing excess properties
export type CommandCenterSignalLike = {
  symbol: string;
  bias?: string | null;
  priority?: string | null;
  severity?: string | null;
  reason: string;
} & Record<string, unknown>;

type NormalizeAlertPriorityFn = (
  value: string | null | undefined
) => "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "IGNORE" | null;

type NormalizeSafeToCockpitStatusFn = (status: string | null | undefined) => "OK" | "CHECK" | "BLOCKED" | "WAITING";

export interface UseCommandCenterStateInput {
  phaseStatus: string;
  connectionState: string;
  accountStatusError: string | null;
  accountStream: AccountStreamStatus | null;
  orderEntryMode: "PAPER" | "TESTNET_LIVE";
  liveSafetyState: {
    killSwitchActive?: boolean;
    warnings?: Array<{ message: string }>;
  } | null;
  liveSafetyDisabledReasons: Array<{ code: string; message: string }>;
  selectedSymbol: string | null;
  latestActionableSignal: CommandCenterSignalLike | null;
  orderEntrySafeToAddStatus: string;
  orderEntrySafeToAddDetail: string;
  frame: ScreenerFrame | null;
  latencyMs: number | null;
  liveSafetyMode: string;
  liveSafetyReady: boolean;
  accountFeedStatus: string;
  accountStatusMessage: string;
  normalizeAlertPriority: NormalizeAlertPriorityFn;
  normalizeSafeToCockpitStatus: NormalizeSafeToCockpitStatusFn;
}

export interface CommandCenterChip {
  label: string;
  value: string;
  detail: string;
  tone: CommandCenterTone;
}

export interface CommandCenterState {
  chips: CommandCenterChip[];
}

export function useCommandCenterState(input: UseCommandCenterStateInput): CommandCenterState {
  const {
    phaseStatus,
    connectionState,
    accountStatusError,
    accountStream,
    orderEntryMode,
    liveSafetyState,
    liveSafetyDisabledReasons,
    selectedSymbol,
    latestActionableSignal,
    orderEntrySafeToAddStatus,
    orderEntrySafeToAddDetail,
    frame,
    latencyMs,
    liveSafetyMode,
    liveSafetyReady,
    accountFeedStatus,
    accountStatusMessage,
    normalizeAlertPriority,
    normalizeSafeToCockpitStatus
  } = input;

  return useMemo(() => {
    const backendTone: CommandCenterTone =
      phaseStatus === "live" ? "positive" : phaseStatus === "booting" ? "caution" : "negative";
    const wsTone: CommandCenterTone =
      connectionState === "open"
        ? "positive"
        : connectionState === "connecting"
          ? "caution"
          : "negative";
    const accountTone: CommandCenterTone = accountStatusError
      ? "negative"
      : accountStream?.connected
        ? "positive"
        : accountStream?.enabled
          ? "caution"
          : "neutral";
    const modeTone: CommandCenterTone = orderEntryMode === "TESTNET_LIVE" ? "caution" : "positive";
    const killSwitchTone: CommandCenterTone = liveSafetyState?.killSwitchActive
      ? "negative"
      : liveSafetyState
        ? "positive"
        : "caution";
    const focusTone: CommandCenterTone = selectedSymbol ? "accent" : "caution";
    const latestSignalTone: CommandCenterTone = latestActionableSignal ? "accent" : "neutral";
    const safeToAddTone: CommandCenterTone =
      orderEntrySafeToAddStatus === "BLOCK"
        ? "negative"
        : orderEntrySafeToAddStatus === "ALLOW"
          ? "positive"
          : "caution";
    const liveSafetyPrimaryBlocker = liveSafetyDisabledReasons[0] ?? null;
    let topBlocker = "Clear";
    let topBlockerDetail = "No blocking display signal in current snapshot.";
    let topBlockerTone: CommandCenterTone = "positive";

    if (liveSafetyState?.killSwitchActive) {
      topBlocker = "Kill switch active";
      topBlockerDetail = "Backend live safety reports an active kill switch.";
      topBlockerTone = "negative";
    } else if (liveSafetyPrimaryBlocker) {
      topBlocker = liveSafetyPrimaryBlocker.code;
      topBlockerDetail = liveSafetyPrimaryBlocker.message;
      topBlockerTone = "negative";
    } else if (orderEntrySafeToAddStatus === "BLOCK") {
      topBlocker = "Safe-To-Add BLOCK";
      topBlockerDetail = orderEntrySafeToAddDetail;
      topBlockerTone = "negative";
    } else if (accountStatusError) {
      topBlocker = "Account error";
      topBlockerDetail = accountStatusError;
      topBlockerTone = "negative";
    } else if (accountStream?.enabled && !accountStream.connected) {
      topBlocker = "Account degraded";
      topBlockerDetail = accountStatusMessage;
      topBlockerTone = "caution";
    } else if (connectionState !== "open") {
      topBlocker = "WebSocket disconnected";
      topBlockerDetail = connectionState === "connecting" ? "Backend WebSocket is connecting." : "Backend WebSocket is closed.";
      topBlockerTone = connectionState === "connecting" ? "caution" : "negative";
    } else if (!selectedSymbol) {
      topBlocker = "No focused symbol";
      topBlockerDetail = "Select a symbol from Signal or Decision Inbox.";
      topBlockerTone = "caution";
    }

    return {
      chips: [
        {
          label: "Backend",
          value: phaseStatus,
          detail: frame?.status.message ?? "Waiting for backend frame.",
          tone: backendTone
        },
        {
          label: "WS",
          value: connectionState,
          detail: latencyMs !== null ? `${latencyMs} ms RTT` : "latency pending",
          tone: wsTone
        },
        {
          label: "Account",
          value: accountStatusError
            ? "ERROR"
            : accountFeedStatus === "live"
              ? "LIVE"
              : accountFeedStatus.toUpperCase(),
          detail: accountStatusError ?? accountStatusMessage,
          tone: accountTone
        },
        {
          label: "Mode",
          value: orderEntryMode === "TESTNET_LIVE" ? "TESTNET" : "PAPER",
          detail: `${liveSafetyMode} / ${liveSafetyReady ? "ready" : "guarded"}`,
          tone: modeTone
        },
        {
          label: "Kill switch",
          value: liveSafetyState?.killSwitchActive ? "ACTIVE" : liveSafetyState ? "CLEAR" : "WAITING",
          detail: liveSafetyState?.warnings?.[0]?.message ?? "Backend live safety guard state.",
          tone: killSwitchTone
        },
        {
          label: "Focus",
          value: selectedSymbol ?? "NONE",
          detail: selectedSymbol ? "Selected symbol workflow." : "No focused symbol.",
          tone: focusTone
        },
        {
          label: "Latest Decision",
          value: latestActionableSignal
            ? `${latestActionableSignal.symbol} ${latestActionableSignal.bias}`
            : "NONE",
          detail: latestActionableSignal
            ? `${normalizeAlertPriority(latestActionableSignal.priority) ?? latestActionableSignal.severity ?? "signal"} / ${latestActionableSignal.reason}`
            : "No actionable Decision Inbox item.",
          tone: latestSignalTone
        },
        {
          label: "Safe-To-Add",
          value: normalizeSafeToCockpitStatus(orderEntrySafeToAddStatus),
          detail: orderEntrySafeToAddDetail,
          tone: safeToAddTone
        },
        {
          label: "top blocker",
          value: topBlocker,
          detail: topBlockerDetail,
          tone: topBlockerTone
        }
      ]
    };
  }, [
    accountFeedStatus,
    accountStatusError,
    accountStatusMessage,
    accountStream?.connected,
    accountStream?.enabled,
    connectionState,
    frame?.status.message,
    latestActionableSignal,
    latencyMs,
    liveSafetyDisabledReasons,
    liveSafetyMode,
    liveSafetyReady,
    liveSafetyState,
    normalizeAlertPriority,
    normalizeSafeToCockpitStatus,
    orderEntryMode,
    orderEntrySafeToAddDetail,
    orderEntrySafeToAddStatus,
    phaseStatus,
    selectedSymbol
  ]);
}
