"use client";

import type {
  CSSProperties,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import QRCode from "qrcode";
import { CriticalAlertOverlay } from "@/components/critical-alert-overlay";
import { SignalBillboardOverlay } from "@/components/signal-billboard-overlay";
import { SocialAuthPanel } from "@/components/social-auth-panel";
import {
  defaultDashboardPanelLayout,
  desktopDashboardPanels,
  desktopModuleSections,
  desktopSectionDomIds,
  isDashboardPanelId,
  normalizeDashboardPanelCoordinate,
  normalizeDashboardPanelHeight,
  normalizeDashboardPanelLayout,
  normalizeDashboardPanelOrder,
  normalizeDashboardPanelSpan,
  normalizeDashboardPanelWidth,
  normalizeDashboardPanelFreeHeight
} from "@/lib/module-sections";
import { getDesktopBridge } from "@/lib/desktop-shell";
import {
  createRuntimeSyncSourceId,
  runtimeSyncChannelName,
  type RuntimeSyncPayload
} from "@/lib/runtime-sync";
import { renderTelemetry, type RenderTelemetryState } from "@/lib/render-telemetry";
import {
  computeSignalBillboardFrameHeightPx,
  signalBillboardBottomSizeRange,
  signalBillboardFrameHeightRange,
  signalBillboardOpacityRange,
  signalBillboardTopSizeRange
} from "@/lib/signal-billboard";
import {
  defaultSignalSoundId,
  playCriticalAlertSound,
  playSignalSound,
  signalSoundPresets
} from "@/lib/signal-sounds";
import {
  buildCabinetQrPayload,
  createCabinetProfile,
  createGuestSession,
  normalizeBinanceHandle,
  sortCabinetProfiles
} from "@/lib/cabinet";
import { compactUsd, formatClock, formatPercent, formatPrice } from "@/lib/format";
import {
  listCabinetProfiles,
  loadCabinetProfileRecord,
  loadCabinetSession,
  loadPersistedState,
  saveCabinetProfileRecord,
  saveCabinetSession,
  savePersistedState
} from "@/lib/indexed-db";
import {
  defaultVoiceProfileId,
  getVoiceProfilePreset,
  normalizeVoiceProfileId,
  russianVoiceProfileId,
  voiceProfilePresets
} from "@/lib/voice-profiles";
import type { VoiceProfilePreset } from "@/lib/voice-profiles";
import {
  loadTtsModels,
  normalizeSpeechProviderId,
  pickTtsModel,
  requestTtsAudio,
  toEdgePitch,
  toEdgeRate,
  type TtsModelSummary
} from "@/lib/tts";
import type {
  Bias,
  CabinetProfile,
  CabinetSession,
  CollapsedSectionsState,
  CollapsibleSectionId,
  ConflictState,
  CreateJournalEntryInput,
  DashboardSettings,
  DashboardPanelId,
  DoNotTradeResult,
  FundingSortMode,
  AllocationState,
  ExecutionState,
  JournalAnalyticsBucket,
  JournalAnalyticsPayload,
  JournalEntryFilters,
  JournalEntryRecord,
  JournalEntrySide,
  LearningPerformanceBucket,
  LearningReportPayload,
  LiquidationHeat,
  LiquidationHeatEntry,
  LiquidationState,
  MarketFlowState,
  FundingSymbolState,
  PositionSizingResult,
  PortfolioAnalyticsGroupState,
  RegimeLearningState,
  RegimeState,
  SignalIntelligenceState,
  PersistedState,
  ScreenerAlert,
  ScreenerFrame,
  ScreenerRow,
  ServerMessage,
  SectionVisibilityState,
  SignalOutcomeRecord,
  SignalReplayPayload,
  SignalStatisticsBucket,
  SignalStatisticsFilters,
  SignalStatisticsPayload,
  SignalStatisticsRecentOutcome,
  SignalSoundId,
  SpeechProviderId,
  UpdateJournalEntryPatch,
  VisibleSectionsMessage,
  VolumeMilestoneEvent,
  VoiceProfileId
} from "@/lib/types";
import { getPersistableState, useScreenerStore } from "@/store/use-screener-store";

const biasColor = (value: number): string =>
  value >= 0 ? "text-positive" : "text-negative";

const scoreColor = (score: number): string => {
  if (score >= 65) {
    return "text-positive";
  }
  if (score <= 35) {
    return "text-negative";
  }
  return "text-slate-200";
};

const riskStatusClasses = (
  status: "disabled" | "syncing" | "live" | "stale" | null | undefined
): string => {
  if (status === "live") {
    return "border-positive/30 bg-positive/10 text-positive";
  }
  if (status === "stale") {
    return "border-caution/30 bg-caution/10 text-caution";
  }
  if (status === "syncing") {
    return "border-accent/30 bg-accent/10 text-accent";
  }
  return "border-white/10 bg-white/5 text-slate-300";
};

const riskLevelClasses = (
  level:
    | "LOW"
    | "MEDIUM"
    | "HIGH"
    | "CRITICAL"
    | "critical"
    | "warning"
    | "safe"
    | null
    | undefined
): string => {
  if (level === "CRITICAL" || level === "critical") {
    return "border-negative/35 bg-negative/12 text-negative";
  }
  if (level === "HIGH" || level === "warning") {
    return "border-caution/35 bg-caution/12 text-caution";
  }
  if (level === "MEDIUM") {
    return "border-accent/35 bg-accent/12 text-accent";
  }
  return "border-positive/30 bg-positive/10 text-positive";
};

const alertSeverityClasses = (
  severity: "info" | "high" | "critical" | null | undefined
): string => {
  if (severity === "critical") {
    return "border-negative/35 bg-negative/10 text-negative";
  }
  if (severity === "high") {
    return "border-caution/35 bg-caution/10 text-caution";
  }
  return "border-white/10 bg-white/5 text-slate-300";
};

const flowBiasClasses = (bias: "LONG" | "SHORT" | "NEUTRAL" | null | undefined): string => {
  if (bias === "LONG") {
    return "text-positive";
  }
  if (bias === "SHORT") {
    return "text-negative";
  }
  return "text-slate-300";
};

const marketFlowDivergenceClasses = (
  divergence: "bullish" | "bearish" | "none" | null | undefined
): string => {
  if (divergence === "bullish") {
    return "border-positive/30 bg-positive/10 text-positive";
  }
  if (divergence === "bearish") {
    return "border-negative/30 bg-negative/10 text-negative";
  }
  return "border-white/10 bg-white/5 text-slate-300";
};

const liquidationHeatClasses = (heat: LiquidationHeat | null | undefined): string => {
  if (heat === "extreme") {
    return "border-negative/40 bg-negative/12 text-negative";
  }
  if (heat === "high") {
    return "border-caution/40 bg-caution/10 text-caution";
  }
  if (heat === "medium") {
    return "border-accent/35 bg-accent/12 text-accent";
  }
  return "border-white/10 bg-white/5 text-slate-300";
};

const regimeBiasClasses = (bias: "LONG" | "SHORT" | "NEUTRAL" | null | undefined): string => {
  if (bias === "LONG") {
    return "border-positive/35 bg-positive/10 text-positive";
  }
  if (bias === "SHORT") {
    return "border-negative/35 bg-negative/10 text-negative";
  }
  return "border-white/10 bg-white/5 text-slate-300";
};

const executionTierClasses = (tier: "A_TIER" | "B_TIER" | "IGNORE" | null | undefined): string => {
  if (tier === "A_TIER") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (tier === "B_TIER") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const signalAgreementFillClasses = (value: number): string => {
  if (value > 0.05) {
    return "bg-positive";
  }

  if (value < -0.05) {
    return "bg-negative";
  }

  return "bg-slate-500";
};

const allocationTierClasses = (tier: "A" | "B" | "C" | null | undefined): string => {
  if (tier === "A") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (tier === "B") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const marketStateClasses = (
  state: "STABLE_TREND" | "TRANSITIONAL" | "CHOP" | "DISORDER" | null | undefined
): string => {
  if (state === "STABLE_TREND") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (state === "TRANSITIONAL") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  if (state === "CHOP") {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const tradePermissionClasses = (
  permission: "ALLOWED" | "REDUCED" | "BLOCKED" | null | undefined
): string => {
  if (permission === "ALLOWED") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (permission === "REDUCED") {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const positionRiskStressClasses = (
  level: "LOW" | "MEDIUM" | "HIGH" | "EXTREME" | null | undefined
): string => {
  if (level === "LOW") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (level === "MEDIUM") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  if (level === "HIGH") {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const positionRiskKillSwitchClasses = (
  state: "NORMAL" | "CAUTION" | "STOP_ADDING" | "REDUCE_RISK" | "EMERGENCY" | null | undefined
): string => {
  if (state === "NORMAL") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (state === "CAUTION") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  if (state === "STOP_ADDING" || state === "REDUCE_RISK") {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const positionRiskSafeClasses = (value: boolean | null | undefined): string =>
  value === true
    ? "border-positive/35 bg-positive/10 text-positive"
    : value === false
      ? "border-negative/35 bg-negative/12 text-negative"
      : "border-white/10 bg-white/5 text-slate-300";

const opportunityVerdictClasses = (value: string | null | undefined): string => {
  if (value === "TRADE") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (value === "WAIT") {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  if (value === "DO_NOT_TRADE") {
    return "border-negative/35 bg-negative/12 text-negative";
  }

  return "border-white/10 bg-white/5 text-slate-400";
};

const setupTypeClasses = (value: string | null | undefined): string =>
  !value || value === "UNKNOWN"
    ? "border-white/10 bg-white/5 text-slate-400"
    : "border-accent/35 bg-accent/10 text-accent";

const winRateClasses = (value: number | null | undefined): string => {
  if (typeof value !== "number") {
    return "text-slate-300";
  }

  if (value >= 55) {
    return "text-positive";
  }

  if (value <= 40) {
    return "text-negative";
  }

  return "text-caution";
};

const marketModeClasses = (
  mode: "NORMAL" | "RISK_OFF" | "DEGRADED" | "EXTREME_UNCERTAINTY" | null | undefined
): string => {
  if (mode === "NORMAL") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (mode === "RISK_OFF") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  if (mode === "DEGRADED") {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const overrideModeClasses = (
  mode: "NONE" | "FORCED_NEUTRAL" | null | undefined
): string => {
  if (mode === "FORCED_NEUTRAL") {
    return "border-caution/40 bg-caution/12 text-caution";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const doNotTradeClasses = (value: string | null | undefined): string => {
  if (value === "ALLOW" || value === "OK") {
    return "border-positive/30 bg-positive/10 text-positive";
  }

  if (value === "REDUCE_SIZE" || value === "CAUTION") {
    return "border-yellow-400/30 bg-yellow-400/10 text-yellow-200";
  }

  if (value === "WAIT") {
    return "border-accent/30 bg-accent/10 text-accent";
  }

  if (value === "BLOCK" || value === "BLOCKED" || value === "EMERGENCY") {
    return "border-negative/30 bg-negative/10 text-negative";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const alertPriorityClasses = (value: string | null | undefined): string => {
  if (value === "CRITICAL") {
    return "border-negative/40 bg-negative/12 text-negative";
  }

  if (value === "HIGH") {
    return "border-caution/40 bg-caution/12 text-caution";
  }

  if (value === "MEDIUM") {
    return "border-accent/35 bg-accent/10 text-accent";
  }

  if (value === "LOW") {
    return "border-white/10 bg-white/5 text-slate-300";
  }

  if (value === "IGNORE") {
    return "border-slate-500/20 bg-slate-500/10 text-slate-500";
  }

  return "border-white/10 bg-white/5 text-slate-400";
};

const continuityStateClasses = (
  state: "ECHOING" | "STABLE_LOOP" | "DRIFTING" | "UNSTRUCTURED" | null | undefined
): string => {
  if (state === "ECHOING") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (state === "STABLE_LOOP") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  if (state === "DRIFTING") {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const forecastBiasClasses = (
  bias: "LONG_BIASED" | "SHORT_BIASED" | "NEUTRAL" | null | undefined
): string => {
  if (bias === "LONG_BIASED") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (bias === "SHORT_BIASED") {
    return "border-negative/35 bg-negative/12 text-negative";
  }

  return "border-white/10 bg-white/5 text-slate-300";
};

const stabilityHorizonClasses = (
  bucket: "LOW" | "MODERATE" | "STABLE" | null | undefined
): string => {
  if (bucket === "STABLE") {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (bucket === "MODERATE") {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  return "border-caution/35 bg-caution/12 text-caution";
};

const calibrationRateClasses = (value: number | null | undefined): string => {
  if (typeof value !== "number") {
    return "border-white/10 bg-white/5 text-slate-300";
  }

  if (value >= 0.65) {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (value >= 0.5) {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  if (value >= 0.35) {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const calibrationErrorClasses = (value: number | null | undefined): string => {
  if (typeof value !== "number") {
    return "border-white/10 bg-white/5 text-slate-300";
  }

  if (value <= 0.12) {
    return "border-positive/35 bg-positive/10 text-positive";
  }

  if (value <= 0.22) {
    return "border-accent/35 bg-accent/12 text-accent";
  }

  if (value <= 0.35) {
    return "border-caution/35 bg-caution/12 text-caution";
  }

  return "border-negative/35 bg-negative/12 text-negative";
};

const adjustmentValueClasses = (value: number | null | undefined): string => {
  if (typeof value !== "number") {
    return "text-slate-300";
  }

  if (value > 0.02) {
    return "text-positive";
  }

  if (value < -0.02) {
    return "text-negative";
  }

  return "text-slate-300";
};

const correlationCellStyle = (value: number): CSSProperties => {
  const intensity = Math.min(Math.abs(value), 1);

  if (value >= 0) {
    return {
      backgroundColor: `rgba(52, 211, 153, ${0.12 + intensity * 0.35})`,
      color: intensity > 0.45 ? "#07111b" : "#d1fae5"
    };
  }

  return {
    backgroundColor: `rgba(248, 113, 113, ${0.12 + intensity * 0.35})`,
    color: intensity > 0.45 ? "#18080a" : "#fee2e2"
  };
};

const formatUsdMetric = (value: number | null | undefined): string =>
  typeof value === "number" ? compactUsd(value) : "--";

const formatSignedUsdMetric = (value: number | null | undefined): string => {
  if (typeof value !== "number") {
    return "--";
  }

  return `${value >= 0 ? "+" : "-"}${compactUsd(Math.abs(value))}`;
};

const formatMetricPercent = (value: number | null | undefined): string =>
  typeof value === "number" ? `${value.toFixed(1)}%` : "--";

const formatPositionRiskPercent = (value: number | null | undefined): string =>
  typeof value === "number" ? `${value.toFixed(1)}%` : "—";

const formatMetricNumber = (value: number | null | undefined, digits = 0): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const tagClass = (tag: string): string => {
  if (tag === "TRADE") {
    return "border-caution/40 bg-caution/10 text-caution";
  }
  if (tag === "WATCH") {
    return "border-accent/40 bg-accent/10 text-accent";
  }
  if (tag === "LIQ SWEEP") {
    return "border-caution/40 bg-caution/10 text-caution";
  }
  if (tag === "VOL SPIKE") {
    return "border-positive/30 bg-positive/10 text-positive";
  }
  if (tag === "WIDE") {
    return "border-negative/40 bg-negative/10 text-negative";
  }
  return "border-white/10 bg-white/5 text-slate-200";
};

const normalizeCoinName = (symbol: string): string =>
  symbol.replace(/(USDT|USDC|BUSD|FDUSD)$/i, "") || symbol;

const formatPairLabel = (symbol: string): string =>
  symbol.trim().toUpperCase().replace(/(USDT|USDC|BUSD|FDUSD)$/i, " $1").trim();

const volumeMilestoneBadgeLabel = (event: VolumeMilestoneEvent): string =>
  event.direction === "below"
    ? `below ${compactUsd(event.thresholdQuoteVolume24h)}`
    : `above ${compactUsd(event.thresholdQuoteVolume24h)}`;

const volumeMilestoneBadgeClass = (event: VolumeMilestoneEvent): string =>
  event.direction === "below"
    ? "text-rose-200"
    : "text-emerald-200";

const volumeMilestoneCardClass = (event: VolumeMilestoneEvent): string =>
  event.direction === "below"
    ? "border-rose-300/18 bg-rose-500/10 hover:border-rose-300/40 focus:ring-rose-300/30"
    : "border-emerald-300/18 bg-emerald-500/10 hover:border-emerald-300/40 focus:ring-emerald-300/30";

const formatNullableUsd = (value: number | null): string =>
  value === null ? "n/a" : compactUsd(value);

const formatNullablePercent = (value: number | null): string =>
  value === null ? "n/a" : formatPercent(value, 1);

const formatTelemetryKb = (value: number | null | undefined): string =>
  typeof value === "number" ? `${value.toFixed(2)} KB` : "--";

const isLiquidationAlert = (alert: ScreenerAlert): boolean =>
  alert.reason.toLowerCase().includes("liquidation");

const isRevivingCoinAlert = (alert: ScreenerAlert): boolean =>
  alert.kind === "reviving_coin" || alert.reason.toLowerCase().includes("reviving coin");

const getLanguagePrefix = (lang: string): string => lang.trim().toLowerCase().split(/[-_]/)[0] ?? "";

const normalizeVoiceMatchText = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .trim();

const getSpeechVoiceId = (voice: SpeechSynthesisVoice): string => voice.voiceURI || voice.name;

const isVoiceCompatibleWithLanguage = (
  voice: SpeechSynthesisVoice,
  targetLanguage: string
): boolean => getLanguagePrefix(voice.lang) === getLanguagePrefix(targetLanguage);

const isRussianVoiceProfile = (voiceProfileId: VoiceProfileId): boolean =>
  getLanguagePrefix(getVoiceProfilePreset(voiceProfileId).lang) === "ru";

const severitySpeechLabel = (
  severity: ScreenerAlert["severity"],
  voiceProfileId: VoiceProfileId
): string => {
  if (isRussianVoiceProfile(voiceProfileId)) {
    if (severity === "critical") {
      return "\u043a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439";
    }

    if (severity === "high") {
      return "\u0432\u044b\u0441\u043e\u043a\u0438\u0439 \u043f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442";
    }

    return "\u0438\u043d\u0444\u043e";
  }

  if (severity === "critical") {
    return "critical";
  }

  if (severity === "high") {
    return "high priority";
  }

  return "info";
};

const buildAlertSpeech = (
  alert: ScreenerAlert,
  baseAssetsBySymbol: Map<string, string>,
  voiceProfileId: VoiceProfileId
): string => {
  const pairName = formatPairLabel(alert.symbol);
  const coinName = baseAssetsBySymbol.get(alert.symbol) ?? normalizeCoinName(alert.symbol);
  const speechLabel = alert.severity === "critical" ? pairName : coinName;
  const liquidationSignal = isLiquidationAlert(alert);
  const severity = severitySpeechLabel(alert.severity, voiceProfileId);

  if (isRussianVoiceProfile(voiceProfileId)) {
    const criticalDirection =
      alert.bias === "LONG"
        ? "\u041b\u0435\u0442\u0438\u0442 \u0432\u0432\u0435\u0440\u0445"
        : alert.bias === "SHORT"
          ? "\u041b\u0435\u0442\u0438\u0442 \u0432\u043d\u0438\u0437"
          : "\u0411\u0435\u0437 \u044f\u0432\u043d\u043e\u0433\u043e \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f";

    if (alert.severity === "critical") {
      return `${speechLabel}. ${criticalDirection}. ${liquidationSignal ? "\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u043b\u0438\u043a\u0432\u0438\u0434\u0430\u0446\u0438\u0438." : "\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0441\u0438\u0433\u043d\u0430\u043b."}`;
    }

    const direction =
      alert.bias === "LONG"
        ? "\u0414\u0432\u0438\u0436\u0435\u043d\u0438\u0435 \u0432\u0432\u0435\u0440\u0445"
        : alert.bias === "SHORT"
          ? "\u0414\u0432\u0438\u0436\u0435\u043d\u0438\u0435 \u0432\u043d\u0438\u0437"
          : "\u0411\u0435\u0437 \u044f\u0432\u043d\u043e\u0433\u043e \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f";
    const signalKind = liquidationSignal
      ? "\u041b\u0438\u043a\u0432\u0438\u0434\u0430\u0446\u0438\u0438"
      : "\u0421\u0438\u0433\u043d\u0430\u043b";

    return `${speechLabel}. ${signalKind}. ${direction}. ${severity}.`;
  }

  if (alert.severity === "critical") {
    if (alert.bias === "LONG") {
      return `${speechLabel}. Flying up. ${liquidationSignal ? "Critical liquidation." : "Critical signal."}`;
    }

    if (alert.bias === "SHORT") {
      return `${speechLabel}. Flying down. ${liquidationSignal ? "Critical liquidation." : "Critical signal."}`;
    }
  }

  const suffix = liquidationSignal ? "Liquidation." : "Signal.";

  return `${speechLabel}. ${alert.bias.toLowerCase()}. ${suffix} ${severity}.`;
};

const feedStatusLabel = (connected: boolean): string => (connected ? "live" : "disconnected");

const phaseStatusLabel = (frame: ScreenerFrame | null): string => {
  if (!frame) {
    return "booting";
  }

  return frame.status.phase === "live" &&
    frame.status.marketStream.connected &&
    frame.status.publicStream.connected
    ? "live"
    : "disconnected";
};

const pulseSpeechLabel = (
  regime: ScreenerFrame["overview"]["dominantRegime"],
  voiceProfileId: VoiceProfileId
): string => {
  if (isRussianVoiceProfile(voiceProfileId)) {
    if (regime === "risk-on") {
      return "\u043f\u0443\u043b\u044c\u0441 \u0440\u044b\u043d\u043a\u0430, \u0440\u0438\u0441\u043a \u043e\u043d";
    }

    if (regime === "risk-off") {
      return "\u043f\u0443\u043b\u044c\u0441 \u0440\u044b\u043d\u043a\u0430, \u0440\u0438\u0441\u043a \u043e\u0444\u0444";
    }

    return "\u043f\u0443\u043b\u044c\u0441 \u0440\u044b\u043d\u043a\u0430, \u0431\u0430\u043b\u0430\u043d\u0441";
  }

  if (regime === "risk-on") {
    return "risk on";
  }

  if (regime === "risk-off") {
    return "risk off";
  }

  return "balanced";
};

const feedRecoverySpeech = (
  feed: "market" | "book" | "phase",
  voiceProfileId: VoiceProfileId
): string => {
  if (isRussianVoiceProfile(voiceProfileId)) {
    if (feed === "market") {
      return "\u043c\u0430\u0440\u043a\u0435\u0442 \u043f\u043e\u0442\u043e\u043a \u0441\u043d\u043e\u0432\u0430 \u0432 \u044d\u0444\u0438\u0440\u0435";
    }

    if (feed === "book") {
      return "\u043a\u043d\u0438\u0433\u0430 \u043e\u0440\u0434\u0435\u0440\u043e\u0432 \u0441\u043d\u043e\u0432\u0430 \u0432 \u044d\u0444\u0438\u0440\u0435";
    }

    return "\u043f\u043e\u0442\u043e\u043a\u0438 \u0441\u043d\u043e\u0432\u0430 \u0432 \u044d\u0444\u0438\u0440\u0435";
  }

  if (feed === "market") {
    return "market feed live";
  }

  if (feed === "book") {
    return "book feed live";
  }

  return "feeds back live";
};

const accountCredentialSourceLabel = (
  source: ScreenerFrame["status"]["accountStream"]["credentialSource"] | "none"
): string => {
  if (source === "session") {
    return "session override";
  }

  if (source === "env") {
    return "server env";
  }

  return "not connected";
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to a legacy copy path when clipboard permissions are blocked.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
};

const sectionLabels: Array<{ id: CollapsibleSectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "filters", label: "Filters" },
  { id: "screener", label: "Darra Terminal" },
  { id: "account", label: "Binance Account" },
  { id: "activeTrades", label: "Active Trades" },
  { id: "riskCenter", label: "Risk Center" },
  { id: "correlationHeatmap", label: "Correlation Heatmap" },
  { id: "varPanel", label: "VaR" },
  { id: "fundingBasis", label: "Funding" },
  { id: "marketFlow", label: "Market Flow" },
  { id: "signalIntelligence", label: "Signal Intelligence" },
  { id: "metaRegimeGovernor", label: "Meta Regime Governor" },
  { id: "positionRiskOrchestrator", label: "Position Risk Orchestrator" },
  { id: "regimeMemory", label: "Regime Memory" },
  { id: "regimePrediction", label: "Regime Prediction" },
  { id: "regimeFeedbackCalibration", label: "Regime Feedback Calibration" },
  { id: "pnlAttribution", label: "PnL Attribution" },
  { id: "signalStatistics", label: "Signal Statistics" },
  { id: "learningCenter", label: "Learning Center" },
  { id: "tradeJournal", label: "Trade Journal" },
  { id: "watchlist", label: "Watchlist" },
  { id: "volumeMilestones", label: "100M Volume" },
  { id: "volumeThresholdMilestones", label: "1-100M Volume" },
  { id: "alerts", label: "Signal Tape" },
  { id: "frameTelemetry", label: "Frame Telemetry" },
  { id: "renderTelemetry", label: "Render Telemetry" },
  { id: "health", label: "Feed Health" }
];

const frameSectionsByPanel: Record<CollapsibleSectionId, string[]> = {
  overview: ["overview"],
  filters: ["settings", "status"],
  screener: ["rows"],
  account: ["risk", "portfolioAnalytics"],
  activeTrades: ["rows"],
  riskCenter: ["risk"],
  correlationHeatmap: ["risk"],
  varPanel: ["risk"],
  fundingBasis: ["funding", "fundingSorted"],
  marketFlow: ["marketFlow", "liquidations", "regime"],
  signalIntelligence: ["signalIntelligence"],
  metaRegimeGovernor: ["metaRegimeGovernor"],
  positionRiskOrchestrator: ["positionRiskOrchestrator"],
  regimeMemory: ["regimeMemory"],
  regimePrediction: ["regimePrediction"],
  regimeFeedbackCalibration: ["regimeFeedbackCalibration"],
  pnlAttribution: ["portfolioAnalytics"],
  signalStatistics: [],
  learningCenter: [],
  tradeJournal: [],
  watchlist: ["rows"],
  volumeMilestones: ["volumeMilestones"],
  volumeThresholdMilestones: ["volumeThresholdMilestones"],
  alerts: ["alerts"],
  frameTelemetry: ["frameTelemetry"],
  renderTelemetry: [],
  health: ["status", "overview", "frameTelemetry"]
};

const baselineVisibleFrameSections = ["type", "generatedAt", "settings", "status", "overview"];

const resolveVisibleFrameSections = ({
  desktopSection,
  visibleSections,
  collapsedSections
}: {
  desktopSection?: CollapsibleSectionId;
  visibleSections: SectionVisibilityState;
  collapsedSections: CollapsedSectionsState;
}): string[] => {
  const sections = new Set(baselineVisibleFrameSections);
  const activePanels = desktopSection
    ? [desktopSection]
    : desktopModuleSections.filter((section) => visibleSections[section] && !collapsedSections[section]);

  for (const panel of activePanels) {
    for (const section of frameSectionsByPanel[panel]) {
      sections.add(section);
    }
  }

  return Array.from(sections);
};

const defaultGuestCabinetHeadline = "Local guest";
const signalNotificationChannelId = "scalpstation_signals_v2";
const signalNotificationSound = "signal_chime.wav";
const initialAlertReplayWindowMs = 120_000;
const fundingViewOptions: Array<{ id: FundingSortMode; label: string }> = [
  { id: "highest", label: "Highest Funding" },
  { id: "lowest", label: "Lowest Funding" },
  { id: "basis", label: "Largest Basis" }
];
const signalStatisticsHorizonOptions = [
  { value: 60, label: "60s" },
  { value: 300, label: "5m" },
  { value: 900, label: "15m" },
  { value: 3600, label: "1h" }
] as const;
const signalStatisticsPeriodOptions = [
  { value: 3_600_000, label: "1h" },
  { value: 86_400_000, label: "24h" },
  { value: 604_800_000, label: "7d" },
  { value: 0, label: "all" }
] as const;
const signalStatisticsLimitOptions = [50, 100, 250, 500] as const;
const signalStatisticsRequestThrottleMs = 2_000;
const journalPeriodOptions = [
  { value: 86_400_000, label: "1d" },
  { value: 604_800_000, label: "7d" },
  { value: 2_592_000_000, label: "30d" },
  { value: 0, label: "all" }
] as const;
const journalLimitOptions = [50, 100, 250] as const;
const initialAlertReplayLimit = 3;
const signalBillboardLifetimeMs = 2_400;
const speechQualityBoostHints = [
  "natural",
  "neural",
  "neural2",
  "online",
  "premium",
  "enhanced",
  "studio",
  "wavenet",
  "google",
  "microsoft",
  "desktop",
  "samsung"
];
const speechQualityPenaltyHints = [
  "espeak",
  "pico",
  "festival",
  "speech dispatcher",
  "robot",
  "compact"
];

const scoreSpeechVoice = (
  voice: SpeechSynthesisVoice,
  preset: VoiceProfilePreset
): number => {
  const name = normalizeVoiceMatchText(`${voice.name} ${voice.voiceURI}`);
  const lang = normalizeVoiceMatchText(voice.lang);
  const targetLang = normalizeVoiceMatchText(preset.lang);
  const targetLanguagePrefix = getLanguagePrefix(targetLang);
  let score = 0;

  if (lang === targetLang) {
    score += 14;
  } else if (getLanguagePrefix(lang) === targetLanguagePrefix) {
    score += 10;
  } else if (targetLanguagePrefix !== "en" && lang.startsWith("en")) {
    score += 2;
  }

  if (voice.default) {
    score += 1;
  }

  if (voice.localService) {
    score += 3;
  } else {
    score -= 1;
  }

  for (const hint of preset.preferredNames) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score += 5;
    }
  }

  for (const hint of preset.avoidedNames ?? []) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score -= 4;
    }
  }

  for (const hint of speechQualityBoostHints) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score += 3;
    }
  }

  for (const hint of speechQualityPenaltyHints) {
    if (name.includes(normalizeVoiceMatchText(hint))) {
      score -= 6;
    }
  }

  return score;
};

const pickSpeechVoice = (
  voices: SpeechSynthesisVoice[],
  preset: VoiceProfilePreset,
  preferredVoiceUri: string | null = null
): SpeechSynthesisVoice | null => {
  const targetLanguagePrefix = getLanguagePrefix(preset.lang);
  const matchingLanguageVoices = voices.filter(
    (voice) => getLanguagePrefix(voice.lang) === targetLanguagePrefix
  );
  const candidates = matchingLanguageVoices.length > 0 ? matchingLanguageVoices : voices;

  if (candidates.length === 0) {
    return null;
  }

  if (preferredVoiceUri) {
    const preferredVoice = candidates.find((voice) => getSpeechVoiceId(voice) === preferredVoiceUri);

    if (preferredVoice) {
      return preferredVoice;
    }
  }

  if (preset.id === defaultVoiceProfileId) {
    return candidates.find((voice) => voice.default) ?? candidates[0];
  }

  return [...candidates].sort(
    (left, right) => scoreSpeechVoice(right, preset) - scoreSpeechVoice(left, preset)
  )[0];
};

interface BackgroundSignalMonitorPlugin {
  start(options: { backendWsUrl: string }): Promise<{ running: boolean }>;
  stop(): Promise<{ running: boolean }>;
}

type AccountAction = "connect" | "disconnect" | null;
type SpeechCategory = "signal" | "status" | "preview";

interface SpeechQueueItem {
  text: string;
  category: SpeechCategory;
}

interface SignalBillboard {
  id: string;
  symbol: string;
  bias: Bias;
  severity: ScreenerAlert["severity"];
}

const BackgroundSignalMonitor =
  registerPlugin<BackgroundSignalMonitorPlugin>("BackgroundSignalMonitor");

const loopbackBackendHosts = new Set(["localhost", "127.0.0.1", "::1"]);

type DashboardPanelStyle = CSSProperties & {
  "--dashboard-panel-order"?: number;
  "--dashboard-panel-span"?: number;
  "--dashboard-panel-min-height"?: string;
  "--dashboard-panel-x"?: string;
  "--dashboard-panel-y"?: string;
  "--dashboard-panel-width"?: string;
  "--dashboard-panel-height"?: string;
};

type DashboardSurfaceStyle = CSSProperties & {
  "--dashboard-free-layout-height"?: string;
};

type DashboardResizeEdge =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-right"
  | "bottom-right"
  | "bottom-left"
  | "top-left";

const dashboardPanelDragBlockSelector =
  "button, input, select, textarea, a, [role='button'], [contenteditable='true'], .dashboard-panel-resize-edge, .dashboard-panel-move-handle";

const isLoopbackBackendWsUrl = (value: string): boolean => {
  try {
    return loopbackBackendHosts.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
};

export function ScalpStationApp({
  desktopSection
}: {
  desktopSection?: CollapsibleSectionId;
}) {
  const {
    connectionState,
    latencyMs,
    frame,
    signalStatistics,
    signalStatisticsUpdatedAt,
    signalReplay,
    signalReplayLoading,
    signalReplayError,
    journalEntries,
    journalAnalytics,
    journalAnalyticsLoading,
    journalAnalyticsUpdatedAt,
    learningReport,
    learningReportLoading,
    learningReportUpdatedAt,
    journalLoading,
    journalError,
    selectedJournalEntry,
    backendWsUrl,
    settings,
    watchlist,
    activeTrades,
    uiPreferences,
    profileNotes,
    search,
    setConnectionState,
    applyServerMessage,
    setSignalReplayLoading,
    clearSignalReplay,
    setSelectedJournalEntry,
    requestJournalEntries,
    requestJournalAnalytics,
    requestLearningReport,
    createJournalEntry,
    updateJournalEntry,
    deleteJournalEntry,
    setBackendWsUrl,
    setSettings,
    setSearch,
    toggleWatchlist,
    removeWatchlist,
    toggleActiveTrade,
    removeActiveTrade,
    hydratePersistedState,
    toggleSection,
    setSoundEnabled,
    setSignalAnimationEnabled,
    setSignalSoundEnabled,
    setSignalBillboardPreference,
    setSelectedSignalSoundId,
    setVoiceProfile,
    setSpeechProvider,
    setSelectedSpeechVoiceUri,
    setSelectedTtsModelId,
    setNotificationPreference,
    setSectionVisibility,
    setDashboardLayoutMode,
    setDashboardPanelOrder,
    setDashboardPanelLayout,
    setDashboardPanelSize,
    setProfileNotes
  } = useScreenerStore();

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const signalStatisticsRequestTimerRef = useRef<number | null>(null);
  const lastSignalStatisticsRequestAtRef = useRef(0);
  const latestSettingsRef = useRef<DashboardSettings>(settings);
  const latestWatchlistRef = useRef(watchlist);
  const latestActiveTradesRef = useRef(activeTrades);
  const latestVisibleFrameSectionsRef = useRef<string[]>(baselineVisibleFrameSections);
  const latestSignalStatisticsFiltersRef = useRef<SignalStatisticsFilters>({
    horizonSec: 300,
    sinceMs: 86_400_000,
    limit: 50
  });
  const latestJournalFiltersRef = useRef<JournalEntryFilters>({
    sinceMs: 604_800_000,
    limit: 100
  });
  const dashboardDragSourceRef = useRef<DashboardPanelId | null>(null);
  const dashboardWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const soundEnabledRef = useRef(uiPreferences.soundEnabled);
  const signalAnimationEnabledRef = useRef(uiPreferences.signalAnimationEnabled);
  const signalSoundEnabledRef = useRef(uiPreferences.signalSoundEnabled);
  const selectedSignalSoundIdRef = useRef<SignalSoundId>(
    uiPreferences.selectedSignalSoundId ?? defaultSignalSoundId
  );
  const voiceProfileRef = useRef<VoiceProfileId>(
    normalizeVoiceProfileId(uiPreferences.voiceProfile)
  );
  const speechProviderRef = useRef<SpeechProviderId>(
    normalizeSpeechProviderId(uiPreferences.speechProvider)
  );
  const selectedSpeechVoiceUriRef = useRef<string | null>(
    uiPreferences.selectedSpeechVoiceUri ?? null
  );
  const selectedTtsModelIdRef = useRef<string | null>(uiPreferences.selectedTtsModelId ?? null);
  const notificationPreferencesRef = useRef(uiPreferences.notifications);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const primedAlertHistoryRef = useRef(false);
  const connectionSnapshotRef = useRef<{
    phase: string;
    marketFeed: string;
    bookFeed: string;
    pulse: ScreenerFrame["overview"]["dominantRegime"];
  } | null>(null);
  const speechQueueRef = useRef<SpeechQueueItem[]>([]);
  const speakingRef = useRef(false);
  const currentSpeechCategoryRef = useRef<SpeechCategory | null>(null);
  const speechVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const activeSpeechAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeSpeechAudioUrlRef = useRef<string | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const nativeNotificationReadyRef = useRef(false);
  const nativeNotificationChannelReadyRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const copiedAlertTimerRef = useRef<number | null>(null);
  const copiedVolumeEventTimerRef = useRef<number | null>(null);
  const signalBillboardTimerRef = useRef<number | null>(null);
  const criticalAlertSoundTimerRef = useRef<number | null>(null);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const skipNextPersistenceSyncRef = useRef(false);
  const syncSourceIdRef = useRef("");
  const [activeTradeDraft, setActiveTradeDraft] = useState("");
  const [watchlistDraft, setWatchlistDraft] = useState("");
  const [binanceApiKeyDraft, setBinanceApiKeyDraft] = useState("");
  const [binanceApiSecretDraft, setBinanceApiSecretDraft] = useState("");
  const [accountActionPending, setAccountActionPending] = useState<AccountAction>(null);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);
  const [copiedAlertId, setCopiedAlertId] = useState<string | null>(null);
  const [copiedVolumeEventId, setCopiedVolumeEventId] = useState<string | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [cabinetSession, setCabinetSessionState] = useState<CabinetSession>(createGuestSession());
  const [cabinetProfiles, setCabinetProfiles] = useState<CabinetProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<CabinetProfile | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [binanceHandleDraft, setBinanceHandleDraft] = useState("");
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [cabinetMessage, setCabinetMessage] = useState<string | null>(null);
  const [cabinetBusy, setCabinetBusy] = useState(false);
  const [cabinetQrDataUrl, setCabinetQrDataUrl] = useState<string | null>(null);
  const [nativeNotificationStatus, setNativeNotificationStatus] =
    useState("phone notifications pending");
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [availableTtsModels, setAvailableTtsModels] = useState<TtsModelSummary[]>([]);
  const [renderTelemetryState, setRenderTelemetryState] = useState<RenderTelemetryState>(
    renderTelemetry.getSnapshot()
  );
  const [ttsModelsLoading, setTtsModelsLoading] = useState(false);
  const [ttsModelsError, setTtsModelsError] = useState<string | null>(null);
  const [signalBillboard, setSignalBillboard] = useState<SignalBillboard | null>(null);
  const [criticalAlertQueue, setCriticalAlertQueue] = useState<ScreenerAlert[]>([]);
  const [activeCriticalAlert, setActiveCriticalAlert] = useState<ScreenerAlert | null>(null);
  const [fundingViewMode, setFundingViewMode] = useState<FundingSortMode>("highest");
  const [signalStatisticsHorizonSec, setSignalStatisticsHorizonSec] = useState(300);
  const [signalStatisticsSinceMs, setSignalStatisticsSinceMs] = useState(86_400_000);
  const [signalStatisticsLimit, setSignalStatisticsLimit] = useState(50);
  const [journalSinceMs, setJournalSinceMs] = useState(604_800_000);
  const [journalSymbolFilter, setJournalSymbolFilter] = useState("");
  const [journalSideFilter, setJournalSideFilter] = useState<JournalEntrySide | "all">("all");
  const [journalLimit, setJournalLimit] = useState(100);
  const [journalFormSeed, setJournalFormSeed] = useState<CreateJournalEntryInput | null>(null);
  const [journalAutoNotice, setJournalAutoNotice] = useState<string | null>(null);
  const [positionSizingSymbol, setPositionSizingSymbol] = useState("BTCUSDT");
  const [positionSizingDirection, setPositionSizingDirection] =
    useState<"long" | "short" | "">("long");
  const [positionSizingEntryPrice, setPositionSizingEntryPrice] = useState("");
  const [positionSizingStopDistancePct, setPositionSizingStopDistancePct] = useState("");
  const [positionSizingCustomEquity, setPositionSizingCustomEquity] = useState("");
  const [positionSizingRiskPerTradePct, setPositionSizingRiskPerTradePct] = useState("");
  const [positionSizingResult, setPositionSizingResult] =
    useState<PositionSizingResult | null>(null);
  const [positionSizingLoading, setPositionSizingLoading] = useState(false);
  const [positionSizingError, setPositionSizingError] = useState<string | null>(null);
  const [draggedDashboardPanel, setDraggedDashboardPanel] =
    useState<DashboardPanelId | null>(null);
  const [dashboardDragOverPanel, setDashboardDragOverPanel] =
    useState<DashboardPanelId | null>(null);
  const [resizingDashboardPanel, setResizingDashboardPanel] =
    useState<DashboardPanelId | null>(null);
  const [moduleViewReady, setModuleViewReady] = useState(desktopSection === undefined);
  const activeTradeSet = useMemo(() => new Set(activeTrades), [activeTrades]);
  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);
  const accountStream = frame?.status.accountStream ?? null;
  const accountPositionSymbols = frame?.status.accountStream.activePositions ?? [];
  const accountPositionSet = useMemo(
    () => new Set(accountPositionSymbols),
    [accountPositionSymbols]
  );
  const activeTradeSummary = useMemo(() => {
    const manualCount = activeTrades.length;
    const accountCount = accountPositionSymbols.length;

    if (manualCount === 0 && accountCount === 0) {
      return "No trade symbols yet";
    }

    if (manualCount > 0 && accountCount > 0) {
      return `${manualCount} manual, ${accountCount} Binance positions`;
    }

    if (manualCount > 0) {
      return `${manualCount} manual trade symbols`;
    }

    return `${accountCount} Binance positions`;
  }, [activeTrades, accountPositionSymbols]);

  const baseAssetsBySymbol = useMemo(
    () => new Map(frame?.rows?.map((row) => [row.symbol, row.baseAsset]) ?? []),
    [frame?.rows]
  );
  const phaseStatus = phaseStatusLabel(frame);
  const marketFeedStatus = feedStatusLabel(frame?.status.marketStream.connected ?? false);
  const bookFeedStatus = feedStatusLabel(frame?.status.publicStream.connected ?? false);
  const accountFeedStatus = frame
    ? frame.status.accountStream.enabled
      ? feedStatusLabel(frame.status.accountStream.connected)
      : "disabled"
    : "booting";
  const accountCredentialSource = accountStream?.credentialSource ?? "none";
  const accountSourceLabel = accountCredentialSourceLabel(accountCredentialSource);
  const accountKeyLabel = accountStream?.keyLabel ?? null;
  const accountStatusMessage =
    accountStream?.message ?? "account stream disabled: connect Binance API keys";
  const accountStatusError = accountStream?.error ?? null;
  const visibleSections = uiPreferences.visibleSections;
  const dashboardPanelOrder = useMemo(
    () => normalizeDashboardPanelOrder(uiPreferences.dashboardPanelOrder),
    [uiPreferences.dashboardPanelOrder]
  );
  const dashboardPanelOrderMap = useMemo(
    () =>
      new Map(
        dashboardPanelOrder.map((panel, index) => [panel, (index + 1) * 10] as const)
      ),
    [dashboardPanelOrder]
  );
  const dashboardPanelLayout = useMemo(
    () => normalizeDashboardPanelLayout(uiPreferences.dashboardPanelLayout),
    [uiPreferences.dashboardPanelLayout]
  );
  const isFreeDashboardLayout = !desktopSection && uiPreferences.dashboardLayoutMode === "free";
  const currentVoiceProfileId = normalizeVoiceProfileId(uiPreferences.voiceProfile);
  const currentSpeechProviderId = normalizeSpeechProviderId(uiPreferences.speechProvider);
  const currentSignalSoundId = uiPreferences.selectedSignalSoundId ?? defaultSignalSoundId;
  const signalBillboardPreferences = uiPreferences.signalBillboard;
  const currentSignalSoundPreset =
    signalSoundPresets.find((preset) => preset.id === currentSignalSoundId) ??
    signalSoundPresets[0];
  const selectedSpeechVoiceUri = uiPreferences.selectedSpeechVoiceUri ?? null;
  const selectedTtsModelId = uiPreferences.selectedTtsModelId ?? null;
  const selectedVoiceProfile = getVoiceProfilePreset(currentVoiceProfileId);
  const russianVoicePreset = getVoiceProfilePreset(russianVoiceProfileId);
  const getDashboardPanelSpan = (panel: DashboardPanelId): number =>
    dashboardPanelLayout[panel]?.colSpan ?? defaultDashboardPanelLayout[panel].colSpan;
  const getDashboardPanelMinHeight = (panel: DashboardPanelId): number =>
    dashboardPanelLayout[panel]?.minHeightPx ??
    defaultDashboardPanelLayout[panel].minHeightPx;
  const getDashboardPanelFreeBounds = (panel: DashboardPanelId) => ({
    x: dashboardPanelLayout[panel]?.x ?? defaultDashboardPanelLayout[panel].x,
    y: dashboardPanelLayout[panel]?.y ?? defaultDashboardPanelLayout[panel].y,
    widthPx:
      dashboardPanelLayout[panel]?.widthPx ?? defaultDashboardPanelLayout[panel].widthPx,
    heightPx:
      dashboardPanelLayout[panel]?.heightPx ?? defaultDashboardPanelLayout[panel].heightPx
  });
  const getDashboardPanelStyle = (panel: DashboardPanelId): DashboardPanelStyle => {
    const fallbackIndex = desktopDashboardPanels.indexOf(panel);
    const freeBounds = getDashboardPanelFreeBounds(panel);

    return {
      "--dashboard-panel-order":
        dashboardPanelOrderMap.get(panel) ?? Math.max(fallbackIndex + 1, 1) * 10,
      "--dashboard-panel-span": getDashboardPanelSpan(panel),
      "--dashboard-panel-min-height": `${getDashboardPanelMinHeight(panel)}px`,
      "--dashboard-panel-x": `${freeBounds.x}px`,
      "--dashboard-panel-y": `${freeBounds.y}px`,
      "--dashboard-panel-width": `${freeBounds.widthPx}px`,
      "--dashboard-panel-height": `${freeBounds.heightPx}px`
    };
  };
  const dashboardFreeLayoutHeight = Math.max(
    900,
    ...desktopDashboardPanels.map((panel) => {
      const bounds = getDashboardPanelFreeBounds(panel);

      return bounds.y + bounds.heightPx + 32;
    })
  );
  const dashboardSurfaceStyle: DashboardSurfaceStyle = isFreeDashboardLayout
    ? { "--dashboard-free-layout-height": `${dashboardFreeLayoutHeight}px` }
    : {};
  const resetDashboardDragState = () => {
    dashboardDragSourceRef.current = null;
    setDraggedDashboardPanel(null);
    setDashboardDragOverPanel(null);
  };
  const moveDashboardPanel = (source: DashboardPanelId, target: DashboardPanelId) => {
    if (source === target) {
      return;
    }

    const nextOrder = [...dashboardPanelOrder];
    const sourceIndex = nextOrder.indexOf(source);
    const targetIndex = nextOrder.indexOf(target);

    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, source);
    setDashboardPanelOrder(nextOrder);
  };
  const arrangeDashboardPanelsFree = () => {
    if (typeof window === "undefined") {
      return;
    }

    const rootWidth =
      dashboardWorkspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const gap = 12;
    const usableWidth = Math.max(rootWidth - gap * 2, 320);
    const nextLayout = normalizeDashboardPanelLayout(dashboardPanelLayout);
    let x = gap;
    let y = 112;
    let rowHeight = 0;

    for (const panel of dashboardPanelOrder) {
      const current = nextLayout[panel] ?? defaultDashboardPanelLayout[panel];
      const widthPx = Math.min(
        normalizeDashboardPanelWidth(panel, current.widthPx),
        usableWidth
      );
      const heightPx = normalizeDashboardPanelFreeHeight(panel, current.heightPx);

      if (x > gap && x + widthPx > usableWidth + gap) {
        x = gap;
        y += rowHeight + gap;
        rowHeight = 0;
      }

      nextLayout[panel] = {
        ...current,
        x,
        y,
        widthPx,
        heightPx
      };

      x += widthPx + gap;
      rowHeight = Math.max(rowHeight, heightPx);
    }

    setDashboardPanelLayout(nextLayout);
  };
  const toggleDashboardLayoutMode = () => {
    if (isFreeDashboardLayout) {
      setDashboardLayoutMode("grid");
      return;
    }

    setDashboardLayoutMode("free");
    window.requestAnimationFrame(arrangeDashboardPanelsFree);
  };
  const handleDashboardPanelFreeMoveStart = (
    event: ReactPointerEvent<HTMLElement>,
    panel: DashboardPanelId
  ) => {
    if (!isFreeDashboardLayout || typeof window === "undefined") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = getDashboardPanelFreeBounds(panel);

    setResizingDashboardPanel(panel);

    // Snap threshold in pixels — how close an edge needs to be to snap
    const SNAP_THRESHOLD = 12;

    const snapToEdges = (rawX: number, rawY: number): { x: number; y: number } => {
      let snappedX = rawX;
      let snappedY = rawY;

      const movingRight = rawX + startBounds.widthPx; // right edge of moving panel
      const movingBottom = rawY + startBounds.heightPx; // bottom edge of moving panel

      for (const otherId of desktopDashboardPanels) {
        if (otherId === panel) continue;
        const other = getDashboardPanelFreeBounds(otherId);
        const otherRight = other.x + other.widthPx;
        const otherBottom = other.y + other.heightPx;

        // ── Horizontal snapping ─────────────────────────────────────────────
        // Moving panel's left edge → other panel's right edge
        if (Math.abs(rawX - otherRight) < SNAP_THRESHOLD) {
          snappedX = otherRight;
        }
        // Moving panel's right edge → other panel's left edge
        else if (Math.abs(movingRight - other.x) < SNAP_THRESHOLD) {
          snappedX = other.x - startBounds.widthPx;
        }
        // Moving panel's left edge → other panel's left edge (align left)
        else if (Math.abs(rawX - other.x) < SNAP_THRESHOLD) {
          snappedX = other.x;
        }
        // Moving panel's right edge → other panel's right edge (align right)
        else if (Math.abs(movingRight - otherRight) < SNAP_THRESHOLD) {
          snappedX = otherRight - startBounds.widthPx;
        }

        // ── Vertical snapping ────────────────────────────────────────────────
        // Moving panel's top edge → other panel's bottom edge
        if (Math.abs(rawY - otherBottom) < SNAP_THRESHOLD) {
          snappedY = otherBottom;
        }
        // Moving panel's bottom edge → other panel's top edge
        else if (Math.abs(movingBottom - other.y) < SNAP_THRESHOLD) {
          snappedY = other.y - startBounds.heightPx;
        }
        // Moving panel's top edge → other panel's top edge (align top)
        else if (Math.abs(rawY - other.y) < SNAP_THRESHOLD) {
          snappedY = other.y;
        }
        // Moving panel's bottom edge → other panel's bottom edge (align bottom)
        else if (Math.abs(movingBottom - otherBottom) < SNAP_THRESHOLD) {
          snappedY = otherBottom - startBounds.heightPx;
        }
      }

      return { x: snappedX, y: snappedY };
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const deltaX = pointerEvent.clientX - startX;
      const deltaY = pointerEvent.clientY - startY;
      const rawX = normalizeDashboardPanelCoordinate(startBounds.x + deltaX, startBounds.x);
      const rawY = normalizeDashboardPanelCoordinate(startBounds.y + deltaY, startBounds.y);
      const { x, y } = snapToEdges(rawX, rawY);

      setDashboardPanelSize(panel, { x, y });
    };

    const stopMove = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopMove);
      window.removeEventListener("pointercancel", stopMove);
      setResizingDashboardPanel(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopMove);
    window.addEventListener("pointercancel", stopMove);
  };
  const handleDashboardPanelHeaderPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    panel: DashboardPanelId
  ) => {
    if (!isFreeDashboardLayout || desktopSection || event.button !== 0) {
      return;
    }

    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(dashboardPanelDragBlockSelector)) {
      return;
    }

    const panelRect = event.currentTarget.getBoundingClientRect();

    if (event.clientY - panelRect.top > 58) {
      return;
    }

    handleDashboardPanelFreeMoveStart(event, panel);
  };
  const handleDashboardPanelDragStart = (
    event: DragEvent<HTMLElement>,
    panel: DashboardPanelId
  ) => {
    if (desktopSection || isFreeDashboardLayout) {
      event.preventDefault();
      return;
    }

    dashboardDragSourceRef.current = panel;
    setDraggedDashboardPanel(panel);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-darra-dashboard-panel", panel);
    event.dataTransfer.setData("text/plain", panel);
  };
  const handleDashboardPanelDragOver = (
    event: DragEvent<HTMLElement>,
    panel: DashboardPanelId
  ) => {
    const source = dashboardDragSourceRef.current ?? draggedDashboardPanel;

    if (!source || source === panel) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDashboardDragOverPanel(panel);
  };
  const handleDashboardPanelDragLeave = (
    event: DragEvent<HTMLElement>,
    panel: DashboardPanelId
  ) => {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    if (dashboardDragOverPanel === panel) {
      setDashboardDragOverPanel(null);
    }
  };
  const handleDashboardPanelDrop = (
    event: DragEvent<HTMLElement>,
    panel: DashboardPanelId
  ) => {
    event.preventDefault();

    const transferredPanel =
      event.dataTransfer.getData("application/x-darra-dashboard-panel") ||
      event.dataTransfer.getData("text/plain");
    const source = dashboardDragSourceRef.current ?? transferredPanel;

    if (isDashboardPanelId(source)) {
      moveDashboardPanel(source, panel);
    }

    resetDashboardDragState();
  };
  const handleDashboardPanelResizeStart = (
    event: ReactPointerEvent<HTMLElement>,
    panel: DashboardPanelId,
    edge: DashboardResizeEdge
  ) => {
    if (desktopSection || typeof window === "undefined") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const root = event.currentTarget.closest(".dashboard-swiper");
    const rootWidth =
      root instanceof HTMLElement ? root.getBoundingClientRect().width : window.innerWidth;
    const columnWidth = Math.max(rootWidth / 12, 48);
    const startX = event.clientX;
    const startY = event.clientY;
    const startSpan = getDashboardPanelSpan(panel);
    const startMinHeight = getDashboardPanelMinHeight(panel);
    const startFreeBounds = getDashboardPanelFreeBounds(panel);
    const growsRight = edge.includes("right");
    const growsLeft = edge.includes("left");
    const growsDown = edge.includes("bottom");
    const growsUp = edge.includes("top");

    setResizingDashboardPanel(panel);

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (isFreeDashboardLayout) {
        const deltaX = pointerEvent.clientX - startX;
        const deltaY = pointerEvent.clientY - startY;
        const nextWidth = growsRight
          ? normalizeDashboardPanelWidth(panel, startFreeBounds.widthPx + deltaX)
          : growsLeft
            ? normalizeDashboardPanelWidth(panel, startFreeBounds.widthPx - deltaX)
            : startFreeBounds.widthPx;
        const nextHeight = growsDown
          ? normalizeDashboardPanelFreeHeight(panel, startFreeBounds.heightPx + deltaY)
          : growsUp
            ? normalizeDashboardPanelFreeHeight(panel, startFreeBounds.heightPx - deltaY)
            : startFreeBounds.heightPx;

        setDashboardPanelSize(panel, {
          x: growsLeft
            ? normalizeDashboardPanelCoordinate(
                startFreeBounds.x + startFreeBounds.widthPx - nextWidth,
                startFreeBounds.x
              )
            : startFreeBounds.x,
          y: growsUp
            ? normalizeDashboardPanelCoordinate(
                startFreeBounds.y + startFreeBounds.heightPx - nextHeight,
                startFreeBounds.y
              )
            : startFreeBounds.y,
          widthPx: nextWidth,
          heightPx: nextHeight
        });
        return;
      }

      const deltaColumns = Math.round((pointerEvent.clientX - startX) / columnWidth);
      const deltaHeight = pointerEvent.clientY - startY;
      const nextSpan =
        growsRight || growsLeft
          ? normalizeDashboardPanelSpan(
              panel,
              startSpan + (growsRight ? deltaColumns : -deltaColumns)
            )
          : startSpan;
      const nextMinHeight =
        growsDown || growsUp
          ? normalizeDashboardPanelHeight(
              panel,
              startMinHeight + (growsDown ? deltaHeight : -deltaHeight)
            )
          : startMinHeight;

      setDashboardPanelSize(panel, {
        colSpan: nextSpan,
        minHeightPx: nextMinHeight
      });
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      setResizingDashboardPanel(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };
  const dashboardPanelDropProps = (panel: DashboardPanelId) => ({
    "data-dashboard-panel": panel,
    "data-dashboard-panel-dragging": draggedDashboardPanel === panel ? "true" : undefined,
    "data-dashboard-panel-over": dashboardDragOverPanel === panel ? "true" : undefined,
    "data-dashboard-panel-resizing": resizingDashboardPanel === panel ? "true" : undefined,
    onDragOver: (event: DragEvent<HTMLElement>) => handleDashboardPanelDragOver(event, panel),
    onDragLeave: (event: DragEvent<HTMLElement>) => handleDashboardPanelDragLeave(event, panel),
    onDrop: (event: DragEvent<HTMLElement>) => handleDashboardPanelDrop(event, panel),
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) =>
      handleDashboardPanelHeaderPointerDown(event, panel),
    style: getDashboardPanelStyle(panel)
  });
  const renderDashboardResizeHandle = (panel: DashboardPanelId) =>
    desktopSection ? null : (
      <button
        type="button"
        aria-label="Resize dashboard panel"
        title="Тянуть вправо или влево, двойной клик сбросит ширину"
        onPointerDown={(event) => handleDashboardPanelResizeStart(event, panel, "right")}
        onDoubleClick={() =>
          setDashboardPanelSize(panel, defaultDashboardPanelLayout[panel])
        }
        className="dashboard-panel-resize-handle rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400 transition hover:border-caution/40 hover:text-caution"
      >
        Size
      </button>
    );
  const renderDashboardResizeFrame = (panel: DashboardPanelId) =>
    desktopSection ? null : (
      <div className="dashboard-panel-resize-frame" aria-hidden="true">
        <span
          className="dashboard-panel-free-drag-strip"
          onPointerDown={(event) => handleDashboardPanelFreeMoveStart(event, panel)}
        />
        {(
          [
            "top",
            "right",
            "bottom",
            "left",
            "top-right",
            "bottom-right",
            "bottom-left",
            "top-left"
          ] as DashboardResizeEdge[]
        ).map((edge) => (
          <span
            key={`${panel}-${edge}`}
            className={`dashboard-panel-resize-edge dashboard-panel-resize-edge--${edge}`}
            onPointerDown={(event) => handleDashboardPanelResizeStart(event, panel, edge)}
            onDoubleClick={() =>
              setDashboardPanelSize(panel, defaultDashboardPanelLayout[panel])
            }
          />
        ))}
      </div>
    );
  const renderDashboardDragHandle = (panel: DashboardPanelId) =>
    desktopSection ? null : (
      <button
        type="button"
        draggable={!isFreeDashboardLayout}
        aria-label="Move dashboard panel"
        title="Перетащить панель"
        onPointerDown={(event) => handleDashboardPanelFreeMoveStart(event, panel)}
        onDragStart={(event) => handleDashboardPanelDragStart(event, panel)}
        onDragEnd={resetDashboardDragState}
        className="dashboard-panel-move-handle rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400 transition hover:border-accent/40 hover:text-accent"
      >
        Move
      </button>
    );
  const renderDashboardPanelHandles = (panel: DashboardPanelId) =>
    desktopSection ? null : (
      <>
        {renderDashboardDragHandle(panel)}
      </>
    );
  const availableRussianVoices = useMemo(
    () =>
      [...availableSpeechVoices]
        .filter((voice) => isVoiceCompatibleWithLanguage(voice, russianVoicePreset.lang))
        .sort(
          (left, right) =>
            scoreSpeechVoice(right, russianVoicePreset) - scoreSpeechVoice(left, russianVoicePreset)
        ),
    [availableSpeechVoices, russianVoicePreset]
  );
  const selectedSpeechVoice = useMemo(
    () =>
      availableSpeechVoices.find((voice) => getSpeechVoiceId(voice) === selectedSpeechVoiceUri) ??
      null,
    [availableSpeechVoices, selectedSpeechVoiceUri]
  );
  const selectedRussianSpeechVoice = useMemo(
    () =>
      availableRussianVoices.find((voice) => getSpeechVoiceId(voice) === selectedSpeechVoiceUri) ??
      null,
    [availableRussianVoices, selectedSpeechVoiceUri]
  );
  const visibleTtsModels = useMemo(
    () =>
      availableTtsModels.filter((model) =>
        currentVoiceProfileId === russianVoiceProfileId ? model.multilingual : true
      ),
    [availableTtsModels, currentVoiceProfileId]
  );
  const selectedTtsModel = useMemo(
    () => availableTtsModels.find((model) => model.id === selectedTtsModelId) ?? null,
    [availableTtsModels, selectedTtsModelId]
  );
  const suggestedTtsModel = useMemo(
    () => pickTtsModel(availableTtsModels, currentVoiceProfileId, selectedTtsModelId),
    [availableTtsModels, currentVoiceProfileId, selectedTtsModelId]
  );
  const cabinetProfileLabel = activeProfile?.profileName ?? defaultGuestCabinetHeadline;
  const cabinetHandleLabel = activeProfile?.binanceHandle ?? "guest";
  const moduleDomId = desktopSection ? desktopSectionDomIds[desktopSection] : null;
  const signalStatisticsFilters = useMemo<SignalStatisticsFilters>(
    () => ({
      horizonSec: signalStatisticsHorizonSec,
      ...(signalStatisticsSinceMs > 0 ? { sinceMs: signalStatisticsSinceMs } : {}),
      limit: signalStatisticsLimit
    }),
    [signalStatisticsHorizonSec, signalStatisticsSinceMs, signalStatisticsLimit]
  );
  const journalFilters = useMemo<JournalEntryFilters>(
    () => ({
      ...(journalSymbolFilter.trim() ? { symbol: journalSymbolFilter.trim().toUpperCase() } : {}),
      ...(journalSideFilter !== "all" ? { side: journalSideFilter } : {}),
      ...(journalSinceMs > 0 ? { sinceMs: journalSinceMs } : {}),
      limit: journalLimit
    }),
    [journalSymbolFilter, journalSideFilter, journalSinceMs, journalLimit]
  );

  useEffect(() => {
    latestSignalStatisticsFiltersRef.current = signalStatisticsFilters;
  }, [signalStatisticsFilters]);

  useEffect(() => {
    latestJournalFiltersRef.current = journalFilters;
  }, [journalFilters]);

  if (!syncSourceIdRef.current) {
    syncSourceIdRef.current = createRuntimeSyncSourceId();
  }

  const cabinetQrPayload = useMemo(() => {
    const previewHandle = normalizeBinanceHandle(
      binanceHandleDraft || activeProfile?.binanceHandle || ""
    );
    const previewName = profileNameDraft.trim() || activeProfile?.profileName || "Darra Terminal";
    const qrSeed = activeProfile?.qrSeed ?? "preview";

    if (!previewHandle) {
      return null;
    }

    return buildCabinetQrPayload({
      profileName: previewName,
      binanceHandle: previewHandle,
      qrSeed
    });
  }, [activeProfile, binanceHandleDraft, profileNameDraft]);

  const sendSocketMessage = (payload: Record<string, unknown>): boolean => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setAccountFormError("Connection is not ready yet.");
      return false;
    }

    socketRef.current.send(JSON.stringify(payload));
    return true;
  };

  const handlePositionSizingCalculate = (): void => {
    const symbol = positionSizingSymbol.trim().toUpperCase();
    const entryPrice = Number(positionSizingEntryPrice);
    const stopDistancePct = Number(positionSizingStopDistancePct);
    const customEquityUsdt = Number(positionSizingCustomEquity);
    const riskPerTradePct = Number(positionSizingRiskPerTradePct);

    if (!symbol) {
      setPositionSizingError("Symbol is required.");
      return;
    }

    if (positionSizingDirection !== "long" && positionSizingDirection !== "short") {
      setPositionSizingError("Direction must be long or short.");
      return;
    }

    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      setPositionSizingError("Entry price must be greater than 0.");
      return;
    }

    if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) {
      setPositionSizingError("Stop distance must be greater than 0.");
      return;
    }

    if (positionSizingCustomEquity.trim() && (!Number.isFinite(customEquityUsdt) || customEquityUsdt <= 0)) {
      setPositionSizingError("Custom equity must be greater than 0.");
      return;
    }

    if (positionSizingRiskPerTradePct.trim() && (!Number.isFinite(riskPerTradePct) || riskPerTradePct <= 0)) {
      setPositionSizingError("Risk per trade must be greater than 0.");
      return;
    }

    const payload: {
      symbol: string;
      direction: "long" | "short";
      entryPrice: number;
      stopDistancePct: number;
      customEquityUsdt?: number;
      riskPerTradePct?: number;
    } = {
      symbol,
      direction: positionSizingDirection,
      entryPrice,
      stopDistancePct
    };

    if (positionSizingCustomEquity.trim()) {
      payload.customEquityUsdt = customEquityUsdt;
    }

    if (positionSizingRiskPerTradePct.trim()) {
      payload.riskPerTradePct = riskPerTradePct;
    }

    setPositionSizingSymbol(symbol);
    setPositionSizingError(null);
    setPositionSizingLoading(true);

    const sent = sendSocketMessage({
      type: "request_position_sizing",
      payload
    });

    if (!sent) {
      setPositionSizingLoading(false);
      setPositionSizingError("Connection is not ready yet.");
    }
  };

  const requestSignalStatistics = (
    filters: SignalStatisticsFilters = signalStatisticsFilters,
    force = false
  ): boolean => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return false;
    }

    const now = Date.now();
    const elapsedMs = now - lastSignalStatisticsRequestAtRef.current;

    if (!force && elapsedMs < signalStatisticsRequestThrottleMs) {
      if (signalStatisticsRequestTimerRef.current === null) {
        signalStatisticsRequestTimerRef.current = window.setTimeout(() => {
          signalStatisticsRequestTimerRef.current = null;
          requestSignalStatistics(latestSignalStatisticsFiltersRef.current, true);
        }, signalStatisticsRequestThrottleMs - elapsedMs);
      }

      return true;
    }

    if (signalStatisticsRequestTimerRef.current !== null) {
      window.clearTimeout(signalStatisticsRequestTimerRef.current);
      signalStatisticsRequestTimerRef.current = null;
    }

    lastSignalStatisticsRequestAtRef.current = now;
    socketRef.current.send(
      JSON.stringify({
        type: "request_signal_statistics",
        filters
      })
    );
    return true;
  };

  const requestJournalData = (filters: JournalEntryFilters = journalFilters): boolean => {
    const entriesSent = requestJournalEntries(sendSocketMessage, filters);
    const analyticsSent = requestJournalAnalytics(sendSocketMessage, filters);

    return entriesSent || analyticsSent;
  };

  const requestLearningData = (): boolean => requestLearningReport(sendSocketMessage);

  const requestSignalReplay = (signalId: string): boolean => {
    const normalizedSignalId = signalId.trim();

    if (!normalizedSignalId || socketRef.current?.readyState !== WebSocket.OPEN) {
      return false;
    }

    setSignalReplayLoading(true);
    socketRef.current.send(
      JSON.stringify({
        type: "request_signal_replay",
        signalId: normalizedSignalId
      })
    );
    return true;
  };

  const openJournalCreateForm = (input: CreateJournalEntryInput | null = null) => {
    setSelectedJournalEntry(null);
    setJournalFormSeed(input);
  };

  const openJournalEditForm = (entry: JournalEntryRecord) => {
    setJournalFormSeed(null);
    setSelectedJournalEntry(entry);
  };

  const closeJournalForm = () => {
    setJournalFormSeed(null);
    setSelectedJournalEntry(null);
  };

  const submitJournalEntry = (
    input: CreateJournalEntryInput,
    entryId: string | null = selectedJournalEntry?.id ?? null
  ): boolean => {
    const sent = entryId
      ? updateJournalEntry(sendSocketMessage, entryId, input as UpdateJournalEntryPatch)
      : createJournalEntry(sendSocketMessage, input);

    if (sent) {
      closeJournalForm();
      window.setTimeout(() => requestJournalData(journalFilters), 50);
    }

    return sent;
  };

  const removeJournalEntry = (id: string): boolean => {
    const sent = deleteJournalEntry(sendSocketMessage, id);

    if (sent) {
      window.setTimeout(() => requestJournalData(journalFilters), 50);
    }

    return sent;
  };

  const refreshCabinetProfiles = async (): Promise<CabinetProfile[]> => {
    const profiles = sortCabinetProfiles(await listCabinetProfiles());
    setCabinetProfiles(profiles);
    return profiles;
  };

  const persistCurrentState = async (
    overrideProfile: CabinetProfile | null = activeProfile,
    overrideSession: CabinetSession = cabinetSession
  ): Promise<void> => {
    const snapshot = getPersistableState();

    if (overrideSession.mode === "authenticated" && overrideProfile) {
      await saveCabinetProfileRecord({
        profile: {
          ...overrideProfile,
          updatedAt: Date.now()
        },
        state: snapshot
      });
      return;
    }

    await savePersistedState(snapshot);
  };

  const broadcastRuntimeState = (
    snapshot: PersistedState = getPersistableState(),
    session: CabinetSession = cabinetSession,
    profile: CabinetProfile | null = activeProfile
  ): void => {
    syncChannelRef.current?.postMessage({
      type: "state",
      sourceId: syncSourceIdRef.current,
      profile,
      session,
      state: snapshot
    } satisfies RuntimeSyncPayload);
  };

  const syncSpeechVoices = (): SpeechSynthesisVoice[] => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      speechVoicesRef.current = [];
      setAvailableSpeechVoices([]);
      return [];
    }

    const seenVoiceIds = new Set<string>();
    const voices = window.speechSynthesis.getVoices().filter((voice) => {
      const voiceId = getSpeechVoiceId(voice);

      if (seenVoiceIds.has(voiceId)) {
        return false;
      }

      seenVoiceIds.add(voiceId);
      return true;
    });

    speechVoicesRef.current = voices;
    setAvailableSpeechVoices(voices);
    return voices;
  };

  const stopSystemSpeechSynthesis = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
  };

  const stopEdgeSpeechPlayback = () => {
    ttsAbortControllerRef.current?.abort();
    ttsAbortControllerRef.current = null;

    const audio = activeSpeechAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      activeSpeechAudioRef.current = null;
    }

    const audioUrl = activeSpeechAudioUrlRef.current;
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      activeSpeechAudioUrlRef.current = null;
    }
  };

  const cancelSpeechPlayback = () => {
    stopSystemSpeechSynthesis();
    stopEdgeSpeechPlayback();
    speakingRef.current = false;
    currentSpeechCategoryRef.current = null;
  };

  const speakTextWithSystem = (
    text: string,
    voiceProfileId: VoiceProfileId,
    category: SpeechCategory,
    preferredVoiceUri: string | null = selectedSpeechVoiceUriRef.current
  ): boolean => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return false;
    }

    const preset = getVoiceProfilePreset(voiceProfileId);
    const voices =
      speechVoicesRef.current.length > 0 ? speechVoicesRef.current : syncSpeechVoices();
    const selectedVoice = pickSpeechVoice(voices, preset, preferredVoiceUri);
    const targetLanguagePrefix = getLanguagePrefix(preset.lang);
    const voiceMatchesTargetLanguage =
      selectedVoice !== null && getLanguagePrefix(selectedVoice.lang) === targetLanguagePrefix;
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = voiceMatchesTargetLanguage ? selectedVoice.lang : preset.lang;
    utterance.rate = preset.rate;
    utterance.pitch = preset.pitch;
    utterance.volume = 1;

    if (selectedVoice && (preset.id === defaultVoiceProfileId || voiceMatchesTargetLanguage)) {
      utterance.voice = selectedVoice;
    }

    utterance.onend = () => {
      speakingRef.current = false;
      currentSpeechCategoryRef.current = null;
      flushSpeechQueue();
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      currentSpeechCategoryRef.current = null;
      flushSpeechQueue();
    };

    stopEdgeSpeechPlayback();
    speakingRef.current = true;
    currentSpeechCategoryRef.current = category;
    window.speechSynthesis.speak(utterance);
    return true;
  };

  const speakTextWithEdge = (
    text: string,
    voiceProfileId: VoiceProfileId,
    category: SpeechCategory,
    preferredModelId: string | null = selectedTtsModelIdRef.current,
    preferredVoiceUri: string | null = selectedSpeechVoiceUriRef.current
  ): boolean => {
    if (typeof window === "undefined") {
      return false;
    }

    const preset = getVoiceProfilePreset(voiceProfileId);
    const selectedModel = pickTtsModel(availableTtsModels, voiceProfileId, preferredModelId);

    if (!selectedModel) {
      return speakTextWithSystem(text, voiceProfileId, category, preferredVoiceUri);
    }

    stopSystemSpeechSynthesis();
    stopEdgeSpeechPlayback();
    speakingRef.current = true;
    currentSpeechCategoryRef.current = category;

    const abortController = new AbortController();
    ttsAbortControllerRef.current = abortController;

    void (async () => {
      try {
        const audioBlob = await requestTtsAudio({
          backendWsUrl,
          text,
          voiceId: selectedModel.id,
          lang: preset.lang,
          rate: toEdgeRate(preset.rate),
          pitch: toEdgePitch(preset.pitch),
          signal: abortController.signal
        });

        if (abortController.signal.aborted) {
          return;
        }

        const objectUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(objectUrl);

        activeSpeechAudioRef.current = audio;
        activeSpeechAudioUrlRef.current = objectUrl;

        const finishEdgePlayback = () => {
          if (activeSpeechAudioRef.current === audio) {
            activeSpeechAudioRef.current = null;
          }

          if (activeSpeechAudioUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            activeSpeechAudioUrlRef.current = null;
          }

          if (ttsAbortControllerRef.current === abortController) {
            ttsAbortControllerRef.current = null;
          }

          speakingRef.current = false;
          currentSpeechCategoryRef.current = null;
          flushSpeechQueue();
        };

        audio.onended = finishEdgePlayback;
        audio.onerror = finishEdgePlayback;
        await audio.play();
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        stopEdgeSpeechPlayback();
        speakingRef.current = false;
        currentSpeechCategoryRef.current = null;

        if (!speakTextWithSystem(text, voiceProfileId, category, preferredVoiceUri)) {
          flushSpeechQueue();
        }
      }
    })();

    return true;
  };

  const speakText = (
    text: string,
    voiceProfileId: VoiceProfileId,
    category: SpeechCategory,
    preferredVoiceUri: string | null = selectedSpeechVoiceUriRef.current,
    preferredModelId: string | null = selectedTtsModelIdRef.current
  ): boolean => {
    if (speechProviderRef.current === "edge") {
      return speakTextWithEdge(text, voiceProfileId, category, preferredModelId, preferredVoiceUri);
    }

    return speakTextWithSystem(text, voiceProfileId, category, preferredVoiceUri);
  };

  const flushSpeechQueue = () => {
    if (typeof window === "undefined" || !soundEnabledRef.current) {
      return;
    }

    if (speakingRef.current) {
      return;
    }

    const nextItem = speechQueueRef.current.shift();
    if (!nextItem) {
      return;
    }

    if (
      !speakText(
        nextItem.text,
        voiceProfileRef.current,
        nextItem.category,
        selectedSpeechVoiceUriRef.current,
        selectedTtsModelIdRef.current
      )
    ) {
      speakingRef.current = false;
      currentSpeechCategoryRef.current = null;
      flushSpeechQueue();
    }
  };

  const enqueueSignalSpeech = (text: string) => {
    if (!text) {
      return;
    }

    // Signals should never wait behind stale feed-status chatter.
    speechQueueRef.current = speechQueueRef.current.filter((item) => item.category === "signal");

    if (
      currentSpeechCategoryRef.current !== null &&
      currentSpeechCategoryRef.current !== "signal"
    ) {
      cancelSpeechPlayback();
    }

    speechQueueRef.current.push({
      text,
      category: "signal"
    });
    flushSpeechQueue();
  };

  const enqueueStatusSpeech = (text: string) => {
    if (!text) {
      return;
    }

    if (
      currentSpeechCategoryRef.current === "signal" ||
      speechQueueRef.current.some((item) => item.category === "signal")
    ) {
      return;
    }

    const lastQueuedItem = speechQueueRef.current[speechQueueRef.current.length - 1];
    if (
      lastQueuedItem &&
      lastQueuedItem.category === "status" &&
      lastQueuedItem.text === text
    ) {
      return;
    }

    speechQueueRef.current.push({
      text,
      category: "status"
    });
    flushSpeechQueue();
  };

  const dropQueuedStatusSpeech = () => {
    speechQueueRef.current = speechQueueRef.current.filter((item) => item.category !== "status");

    if (currentSpeechCategoryRef.current === "status") {
      cancelSpeechPlayback();
    }
  };

  const enqueueCriticalAlerts = (alerts: ScreenerAlert[]) => {
    if (alerts.length === 0) {
      return;
    }

    setCriticalAlertQueue((current) => {
      const knownIds = new Set([
        ...current.map((alert) => alert.id),
        ...(activeCriticalAlert ? [activeCriticalAlert.id] : [])
      ]);
      const nextAlerts = alerts.filter((alert) => !knownIds.has(alert.id));

      return nextAlerts.length > 0 ? [...current, ...nextAlerts] : current;
    });
  };

  const closeCriticalAlert = () => {
    setActiveCriticalAlert(null);
  };

  const openCriticalAlertChart = (symbol: string) => {
    if (typeof window === "undefined") {
      return;
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }

    window.open(
      `https://www.binance.com/en/futures/${encodeURIComponent(normalizedSymbol)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const setRevivingCoinSetting = <Key extends keyof DashboardSettings["revivingCoins"]>(
    key: Key,
    value: DashboardSettings["revivingCoins"][Key]
  ) => {
    setSettings({
      revivingCoins: {
        ...settings.revivingCoins,
        [key]: value
      }
    });
  };
  const setVolumeMilestoneSetting = <Key extends keyof DashboardSettings["volumeMilestones"]>(
    key: Key,
    value: DashboardSettings["volumeMilestones"][Key]
  ) => {
    setSettings({
      volumeMilestones: {
        ...settings.volumeMilestones,
        [key]: value
      }
    });
  };

  const enqueueSignalBillboard = (alert: ScreenerAlert) => {
    if (
      typeof window === "undefined" ||
      !signalAnimationEnabledRef.current ||
      alert.bias === "NEUTRAL"
    ) {
      return;
    }

    const id = `${alert.id}-${Date.now()}`;
    const symbol = formatPairLabel(alert.symbol);
    const desktopBridge = getDesktopBridge();

    if (desktopBridge) {
      void desktopBridge.showSignalOverlay({
        eventId: alert.id,
        symbol,
        bias: alert.bias,
        severity: alert.severity,
        preferences: signalBillboardPreferences
      });
      return;
    }

    if (signalBillboardTimerRef.current !== null) {
      window.clearTimeout(signalBillboardTimerRef.current);
      signalBillboardTimerRef.current = null;
    }

    setSignalBillboard({
      id,
      symbol,
      bias: alert.bias,
      severity: alert.severity
    });

    const timerId = window.setTimeout(() => {
      setSignalBillboard((current) => (current?.id === id ? null : current));

      if (signalBillboardTimerRef.current === timerId) {
        signalBillboardTimerRef.current = null;
      }
    }, signalBillboardLifetimeMs);

    signalBillboardTimerRef.current = timerId;
  };

  const previewSignalAnimation = () => {
    if (typeof window === "undefined" || !signalAnimationEnabledRef.current) {
      return;
    }

    const desktopBridge = getDesktopBridge();
    if (desktopBridge) {
      void desktopBridge.showSignalOverlay({
        eventId: `preview-${Date.now()}`,
        symbol: "BTC USDT",
        bias: "LONG",
        severity: "high",
        preferences: signalBillboardPreferences
      });
      return;
    }

    enqueueSignalBillboard({
      id: `preview-${Date.now()}`,
      symbol: "BTCUSDT",
      bias: "LONG",
      reason: "preview",
      severity: "high",
      notionalUsd: 0,
      createdAt: Date.now()
    });
  };

  const resolvePreferredRussianVoiceUri = (
    preferredVoiceUri: string | null | undefined = selectedSpeechVoiceUriRef.current
  ): string | null => {
    const voices =
      speechVoicesRef.current.length > 0 ? speechVoicesRef.current : syncSpeechVoices();
    const autoPickedVoice = pickSpeechVoice(voices, russianVoicePreset, preferredVoiceUri ?? null);

    return autoPickedVoice ? getSpeechVoiceId(autoPickedVoice) : null;
  };

  const resolvePreferredTtsModelId = (
    voiceProfileId: VoiceProfileId,
    preferredModelId: string | null | undefined = selectedTtsModelIdRef.current
  ): string | null => {
    const model = pickTtsModel(availableTtsModels, voiceProfileId, preferredModelId ?? null);
    return model?.id ?? null;
  };

  const previewVoiceProfile = (
    voiceProfileId: VoiceProfileId,
    preferredVoiceUri: string | null = selectedSpeechVoiceUriRef.current,
    preferredModelId: string | null = selectedTtsModelIdRef.current
  ) => {
    if (typeof window === "undefined" || !soundEnabledRef.current) {
      return;
    }

    speechQueueRef.current = [];
    cancelSpeechPlayback();
    speakText(
      getVoiceProfilePreset(voiceProfileId).previewText,
      voiceProfileId,
      "preview",
      preferredVoiceUri,
      preferredModelId
    );
  };

  const handleVoiceProfileSelect = (voiceProfileId: VoiceProfileId) => {
    const preferredVoiceUri =
      speechProviderRef.current === "system" && voiceProfileId === russianVoiceProfileId
        ? resolvePreferredRussianVoiceUri()
        : selectedSpeechVoiceUriRef.current;
    const preferredModelId =
      speechProviderRef.current === "edge"
        ? resolvePreferredTtsModelId(voiceProfileId)
        : selectedTtsModelIdRef.current;

    if (
      speechProviderRef.current === "system" &&
      voiceProfileId === russianVoiceProfileId &&
      preferredVoiceUri !== selectedSpeechVoiceUriRef.current
    ) {
      selectedSpeechVoiceUriRef.current = preferredVoiceUri;
      setSelectedSpeechVoiceUri(preferredVoiceUri);
    }

    if (
      speechProviderRef.current === "edge" &&
      preferredModelId !== selectedTtsModelIdRef.current
    ) {
      selectedTtsModelIdRef.current = preferredModelId;
      setSelectedTtsModelId(preferredModelId);
    }

    voiceProfileRef.current = voiceProfileId;
    setVoiceProfile(voiceProfileId);
    previewVoiceProfile(voiceProfileId, preferredVoiceUri, preferredModelId);
  };

  const handleRussianVoiceSelect = (voiceUri: string | null) => {
    const nextVoiceUri = voiceUri ?? resolvePreferredRussianVoiceUri(null);

    speechProviderRef.current = "system";
    setSpeechProvider("system");
    selectedSpeechVoiceUriRef.current = nextVoiceUri;
    setSelectedSpeechVoiceUri(nextVoiceUri);
    voiceProfileRef.current = russianVoiceProfileId;
    setVoiceProfile(russianVoiceProfileId);
    previewVoiceProfile(russianVoiceProfileId, nextVoiceUri);
  };

  const handleSpeechProviderSelect = (provider: SpeechProviderId) => {
    speechProviderRef.current = provider;
    setSpeechProvider(provider);

    const nextVoiceUri =
      provider === "system" && voiceProfileRef.current === russianVoiceProfileId
        ? resolvePreferredRussianVoiceUri()
        : selectedSpeechVoiceUriRef.current;
    const nextModelId =
      provider === "edge"
        ? resolvePreferredTtsModelId(voiceProfileRef.current)
        : selectedTtsModelIdRef.current;

    if (provider === "system" && nextVoiceUri !== selectedSpeechVoiceUriRef.current) {
      selectedSpeechVoiceUriRef.current = nextVoiceUri;
      setSelectedSpeechVoiceUri(nextVoiceUri);
    }

    if (provider === "edge" && nextModelId !== selectedTtsModelIdRef.current) {
      selectedTtsModelIdRef.current = nextModelId;
      setSelectedTtsModelId(nextModelId);
    }

    previewVoiceProfile(voiceProfileRef.current, nextVoiceUri, nextModelId);
  };

  const handleTtsModelSelect = (modelId: string | null) => {
    const nextModelId = modelId ?? resolvePreferredTtsModelId(voiceProfileRef.current, null);

    speechProviderRef.current = "edge";
    setSpeechProvider("edge");
    selectedTtsModelIdRef.current = nextModelId;
    setSelectedTtsModelId(nextModelId);
    previewVoiceProfile(voiceProfileRef.current, selectedSpeechVoiceUriRef.current, nextModelId);
  };

  const ensureNativeNotifications = async (): Promise<boolean> => {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) {
      setNativeNotificationStatus("browser preview");
      return false;
    }

    if (nativeNotificationReadyRef.current && nativeNotificationChannelReadyRef.current) {
      return true;
    }

    try {
      let permission = await LocalNotifications.checkPermissions();

      if (permission.display !== "granted") {
        permission = await LocalNotifications.requestPermissions();
      }

      if (permission.display !== "granted") {
        setNativeNotificationStatus("notifications blocked");
        nativeNotificationReadyRef.current = false;
        return false;
      }

      nativeNotificationReadyRef.current = true;

      if (!nativeNotificationChannelReadyRef.current) {
        await LocalNotifications.createChannel({
          id: signalNotificationChannelId,
          name: "Darra Terminal Signals",
          description: "Live trading signal alerts",
          sound: signalNotificationSound,
          importance: 5,
          visibility: 1,
          lights: true,
          lightColor: "#38BDF8",
          vibration: true
        });
        nativeNotificationChannelReadyRef.current = true;
      }

      setNativeNotificationStatus("phone notifications on");
      return true;
    } catch {
      setNativeNotificationStatus("notifications unavailable");
      return false;
    }
  };

  const playSelectedSignalSound = (
    signalSoundId: SignalSoundId = selectedSignalSoundIdRef.current
  ) => {
    if (!soundEnabledRef.current) {
      return;
    }

    playSignalSound(signalSoundId, audioContextRef);
  };

  const startBackgroundSignalMonitor = async (): Promise<void> => {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) {
      return;
    }

    if (isLoopbackBackendWsUrl(backendWsUrl)) {
      setNativeNotificationStatus("set LAN backend URL");
      return;
    }

    const ready = await ensureNativeNotifications();

    if (!ready) {
      return;
    }

    try {
      await BackgroundSignalMonitor.start({ backendWsUrl });
      setNativeNotificationStatus("background monitor on");
    } catch {
      setNativeNotificationStatus("background monitor failed");
    }
  };

  const stopBackgroundSignalMonitor = async (): Promise<void> => {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) {
      return;
    }

    try {
      await BackgroundSignalMonitor.stop();
      setNativeNotificationStatus("background monitor off");
    } catch {
      setNativeNotificationStatus("background monitor stop failed");
    }
  };

  useEffect(() => {
    let cancelled = false;

    const hydrateCabinet = async () => {
      try {
        const [storedSession, profiles] = await Promise.all([
          loadCabinetSession(),
          listCabinetProfiles()
        ]);

        if (cancelled) {
          return;
        }

        const sortedProfiles = sortCabinetProfiles(profiles);
        const session = storedSession ?? createGuestSession();

        setCabinetProfiles(sortedProfiles);
        setCabinetSessionState(session);

        if (session.mode === "authenticated" && session.profileId) {
          const record = await loadCabinetProfileRecord(session.profileId);

          if (cancelled) {
            return;
          }

          if (record) {
            hydratePersistedState(record.state);
            setActiveProfile(record.profile);
            setProfileNameDraft(record.profile.profileName);
            setBinanceHandleDraft(record.profile.binanceHandle);
            setCabinetMessage(`Cabinet loaded for ${record.profile.binanceHandle}.`);
            setStorageHydrated(true);
            return;
          }

          await saveCabinetSession(createGuestSession());
          setCabinetSessionState(createGuestSession());
        }

        const guestState = await loadPersistedState();

        if (cancelled) {
          return;
        }

        hydratePersistedState(guestState);
        setActiveProfile(null);
        setStorageHydrated(true);
      } catch {
        if (!cancelled) {
          setStorageHydrated(true);
        }
      }
    };

    void hydrateCabinet();

    return () => {
      cancelled = true;
    };
  }, [hydratePersistedState]);

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      return;
    }

    const channel = new BroadcastChannel(runtimeSyncChannelName);
    syncChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<RuntimeSyncPayload>) => {
      const payload = event.data;

      if (
        !storageHydrated ||
        payload?.type !== "state" ||
        payload.sourceId === syncSourceIdRef.current
      ) {
        return;
      }

      skipNextPersistenceSyncRef.current = true;
      hydratePersistedState(payload.state);
      setCabinetSessionState(payload.session);
      setActiveProfile(payload.profile);
      setProfileNameDraft(payload.profile?.profileName ?? "");
      setBinanceHandleDraft(payload.profile?.binanceHandle ?? "");
      setCabinetMessage(
        payload.session.mode === "authenticated" && payload.profile
          ? `Cabinet synced: ${payload.profile.binanceHandle}.`
          : "Guest mode synced."
      );

      void listCabinetProfiles()
        .then((profiles) => setCabinetProfiles(sortCabinetProfiles(profiles)))
        .catch(() => undefined);
    };

    return () => {
      channel.close();

      if (syncChannelRef.current === channel) {
        syncChannelRef.current = null;
      }
    };
  }, [hydratePersistedState, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    const handle = window.setTimeout(() => {
      if (skipNextPersistenceSyncRef.current) {
        skipNextPersistenceSyncRef.current = false;
        return;
      }

      const snapshot = getPersistableState();
      void persistCurrentState()
        .then(() => {
          broadcastRuntimeState(snapshot);
        })
        .catch(() => undefined);
    }, 150);

    return () => {
      window.clearTimeout(handle);
    };
  }, [
    activeTrades,
    activeProfile,
    cabinetSession,
    broadcastRuntimeState,
    profileNotes,
    settings,
    storageHydrated,
    uiPreferences,
    watchlist
  ]);

  useEffect(() => {
    latestSettingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    latestWatchlistRef.current = watchlist;
  }, [watchlist]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!desktopSection || !moduleDomId) {
      delete document.body.dataset.desktopShell;
      setModuleViewReady(true);
      return;
    }

    const root = document.querySelector(".dashboard-swiper");
    const target = document.getElementById(moduleDomId);

    if (!(root instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      setModuleViewReady(false);
      return;
    }

    document.body.dataset.desktopShell = "module";

    const hiddenElements = new Set<HTMLElement>();
    const hideElement = (element: HTMLElement) => {
      if (element.style.display === "none") {
        return;
      }

      hiddenElements.add(element);
      element.style.display = "none";
    };

    for (const child of Array.from(root.children)) {
      if (child !== target && !child.contains(target)) {
        hideElement(child as HTMLElement);
      }
    }

    for (const candidate of Array.from(root.querySelectorAll<HTMLElement>(".swipe-page, .contents"))) {
      if (
        candidate === target ||
        candidate.contains(target) ||
        target.contains(candidate)
      ) {
        continue;
      }

      hideElement(candidate);
    }

    for (const section of desktopModuleSections) {
      const sectionElement = document.getElementById(desktopSectionDomIds[section]);

      if (sectionElement && sectionElement.id !== moduleDomId) {
        hideElement(sectionElement);
      }
    }

    setModuleViewReady(true);

    return () => {
      delete document.body.dataset.desktopShell;

      for (const element of hiddenElements) {
        element.style.display = "";
      }
    };
  }, [desktopSection, moduleDomId]);

  useEffect(() => {
    latestActiveTradesRef.current = activeTrades;
  }, [activeTrades]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const synthesis = window.speechSynthesis;
    const syncAvailableVoices = () => {
      syncSpeechVoices();
    };

    syncAvailableVoices();
    synthesis.addEventListener("voiceschanged", syncAvailableVoices);

    return () => {
      synthesis.removeEventListener("voiceschanged", syncAvailableVoices);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!backendWsUrl.trim()) {
      setAvailableTtsModels([]);
      setTtsModelsError(null);
      setTtsModelsLoading(false);
      return;
    }

    setTtsModelsLoading(true);

    void loadTtsModels(backendWsUrl)
      .then(({ defaultModelId, models }) => {
        if (cancelled) {
          return;
        }

        setAvailableTtsModels(models);
        setTtsModelsError(null);

        const resolvedModelId =
          pickTtsModel(
            models,
            voiceProfileRef.current,
            selectedTtsModelIdRef.current ?? defaultModelId ?? null
          )?.id ??
          defaultModelId ??
          null;

        if (resolvedModelId !== selectedTtsModelIdRef.current) {
          selectedTtsModelIdRef.current = resolvedModelId;
          setSelectedTtsModelId(resolvedModelId);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setAvailableTtsModels([]);
        setTtsModelsError(error instanceof Error ? error.message : "Could not load TTS models.");
      })
      .finally(() => {
        if (!cancelled) {
          setTtsModelsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backendWsUrl, setSelectedTtsModelId]);

  useEffect(() => {
    const desktopBridge = getDesktopBridge();

    if (!desktopBridge) {
      return;
    }

    let cancelled = false;

    desktopBridge
      .getState()
      .then((snapshot) => {
        if (!cancelled && snapshot.backendWsUrl && snapshot.backendWsUrl !== backendWsUrl) {
          setBackendWsUrl(snapshot.backendWsUrl);
        }
      })
      .catch(() => {
        // Keep the baked/default backend URL when the desktop bridge is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [backendWsUrl, setBackendWsUrl]);

  useEffect(() => {
    const desktopBridge = getDesktopBridge();

    if (!desktopBridge) {
      return;
    }

    void desktopBridge.updateAlertMonitorSettings({
      backendWsUrl,
      soundEnabled: uiPreferences.soundEnabled,
      signalSoundEnabled: uiPreferences.signalSoundEnabled,
      signalAnimationEnabled: uiPreferences.signalAnimationEnabled,
      signalBillboard: uiPreferences.signalBillboard,
      notifications: uiPreferences.notifications
    });
  }, [
    backendWsUrl,
    uiPreferences.notifications,
    uiPreferences.signalAnimationEnabled,
    uiPreferences.signalBillboard,
    uiPreferences.signalSoundEnabled,
    uiPreferences.soundEnabled
  ]);

  useEffect(() => {
    soundEnabledRef.current = uiPreferences.soundEnabled;
    signalAnimationEnabledRef.current = uiPreferences.signalAnimationEnabled;
    signalSoundEnabledRef.current = uiPreferences.signalSoundEnabled;
    selectedSignalSoundIdRef.current = uiPreferences.selectedSignalSoundId ?? defaultSignalSoundId;
    voiceProfileRef.current = normalizeVoiceProfileId(uiPreferences.voiceProfile);
    speechProviderRef.current = normalizeSpeechProviderId(uiPreferences.speechProvider);
    selectedSpeechVoiceUriRef.current = uiPreferences.selectedSpeechVoiceUri ?? null;
    selectedTtsModelIdRef.current = uiPreferences.selectedTtsModelId ?? null;
    notificationPreferencesRef.current = uiPreferences.notifications;

    if (!uiPreferences.signalAnimationEnabled) {
      setSignalBillboard(null);

      if (signalBillboardTimerRef.current !== null) {
        window.clearTimeout(signalBillboardTimerRef.current);
        signalBillboardTimerRef.current = null;
      }

      const desktopBridge = getDesktopBridge();
      if (desktopBridge) {
        void desktopBridge.hideSignalOverlay();
      }
    }

    if (uiPreferences.soundEnabled || typeof window === "undefined") {
      return;
    }

    speechQueueRef.current = [];
    cancelSpeechPlayback();
  }, [
    uiPreferences.signalAnimationEnabled,
    uiPreferences.signalSoundEnabled,
    uiPreferences.selectedSignalSoundId,
    uiPreferences.notifications,
    uiPreferences.selectedTtsModelId,
    uiPreferences.speechProvider,
    uiPreferences.selectedSpeechVoiceUri,
    uiPreferences.soundEnabled,
    uiPreferences.voiceProfile
  ]);

  useEffect(() => {
    return () => {
      cancelSpeechPlayback();
    };
  }, []);

  useEffect(() => {
    if (activeCriticalAlert || criticalAlertQueue.length === 0) {
      return;
    }

    const [nextAlert, ...remainingAlerts] = criticalAlertQueue;

    if (!nextAlert) {
      return;
    }

    setActiveCriticalAlert(nextAlert);
    setCriticalAlertQueue(remainingAlerts);
  }, [activeCriticalAlert, criticalAlertQueue]);

  useEffect(() => {
    if (criticalAlertSoundTimerRef.current !== null) {
      window.clearInterval(criticalAlertSoundTimerRef.current);
      criticalAlertSoundTimerRef.current = null;
    }

    if (
      !activeCriticalAlert ||
      !settings.revivingCoins.soundEnabled ||
      !uiPreferences.soundEnabled
    ) {
      return;
    }

    playCriticalAlertSound(audioContextRef);

    const repeatMs = Math.max(settings.revivingCoins.soundRepeatSeconds, 2) * 1000;
    criticalAlertSoundTimerRef.current = window.setInterval(() => {
      playCriticalAlertSound(audioContextRef);
    }, repeatMs);

    return () => {
      if (criticalAlertSoundTimerRef.current !== null) {
        window.clearInterval(criticalAlertSoundTimerRef.current);
        criticalAlertSoundTimerRef.current = null;
      }
    };
  }, [
    activeCriticalAlert,
    settings.revivingCoins.soundEnabled,
    settings.revivingCoins.soundRepeatSeconds,
    uiPreferences.soundEnabled
  ]);

  useEffect(() => {
    if (!uiPreferences.soundEnabled) {
      void stopBackgroundSignalMonitor();
      return;
    }

    void startBackgroundSignalMonitor();
  }, [backendWsUrl, uiPreferences.soundEnabled]);

  useEffect(() => {
    if (!cabinetQrPayload) {
      setCabinetQrDataUrl(null);
      return;
    }

    let cancelled = false;

    QRCode.toDataURL(cabinetQrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: {
        dark: "#0b1017",
        light: "#f0b90b"
      }
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setCabinetQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCabinetQrDataUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cabinetQrPayload]);

  useEffect(() => {
    return () => {
      if (copiedAlertTimerRef.current !== null) {
        window.clearTimeout(copiedAlertTimerRef.current);
      }

      if (copiedVolumeEventTimerRef.current !== null) {
        window.clearTimeout(copiedVolumeEventTimerRef.current);
      }

      if (signalBillboardTimerRef.current !== null) {
        window.clearTimeout(signalBillboardTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const openSocket = () => {
      if (disposed) {
        return;
      }

      setConnectionState("connecting");

      let socket: WebSocket;

      try {
        socket = new WebSocket(backendWsUrl.trim());
      } catch (error) {
        setConnectionState("closed");
        console.warn(
          error instanceof Error
            ? `Could not open backend WebSocket: ${error.message}`
            : "Could not open backend WebSocket."
        );
        return;
      }

      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }

        setConnectionState("open");
        socket.send(JSON.stringify({ type: "hello" }));
        socket.send(
          JSON.stringify({
            type: "visible_sections",
            sections: latestVisibleFrameSectionsRef.current
          } satisfies VisibleSectionsMessage)
        );
        socket.send(JSON.stringify({ type: "request_snapshot" }));
        socket.send(
          JSON.stringify({
            type: "set_settings",
            payload: {
              focusUniverseSize: latestSettingsRef.current.focusUniverseSize,
              revivingCoins: latestSettingsRef.current.revivingCoins,
              volumeMilestones: latestSettingsRef.current.volumeMilestones
            }
          })
        );
        socket.send(
          JSON.stringify({
            type: "set_watchlist",
            payload: { symbols: latestWatchlistRef.current }
          })
        );
        socket.send(
          JSON.stringify({
            type: "set_active_trades",
            payload: { symbols: latestActiveTradesRef.current }
          })
        );
        socket.send(
          JSON.stringify({
            type: "request_signal_statistics",
            filters: latestSignalStatisticsFiltersRef.current
          })
        );
        socket.send(
          JSON.stringify({
            type: "request_journal_entries",
            filters: latestJournalFiltersRef.current
          })
        );
        socket.send(
          JSON.stringify({
            type: "request_journal_analytics",
            filters: latestJournalFiltersRef.current
          })
        );
        socket.send(
          JSON.stringify({
            type: "request_learning_report"
          })
        );
      };

      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }

        try {
          const message = JSON.parse(event.data) as ServerMessage;
          applyServerMessage(message);
          if (message.type === "position_sizing") {
            setPositionSizingResult(message.payload);
            setPositionSizingLoading(false);
            setPositionSizingError(null);
          }
          if (message.type === "journal_auto_event") {
            const eventText =
              message.payload.event === "created"
                ? "created"
                : message.payload.event === "closed"
                  ? "closed"
                  : "updated";
            setJournalAutoNotice(`Auto journal entry ${eventText} from Binance position.`);
            requestJournalData(latestJournalFiltersRef.current);
          }
        } catch {
          return;
        }
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }

        dropQueuedStatusSpeech();
        setConnectionState("closed");
        reconnectTimerRef.current = window.setTimeout(openSocket, 2_000);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    openSocket();

    pingTimerRef.current = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "ping",
            payload: {
              sentAt: Date.now()
            }
          })
        );
      }
    }, 15_000);

    return () => {
      disposed = true;

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current !== null) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (signalStatisticsRequestTimerRef.current !== null) {
        window.clearTimeout(signalStatisticsRequestTimerRef.current);
        signalStatisticsRequestTimerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [applyServerMessage, backendWsUrl, setConnectionState]);

  useEffect(() => {
    requestSignalStatistics(signalStatisticsFilters);
  }, [connectionState, signalStatisticsFilters]);

  useEffect(() => {
    requestJournalData(journalFilters);
  }, [connectionState, journalFilters]);

  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "set_settings",
          payload: {
            focusUniverseSize: settings.focusUniverseSize,
            revivingCoins: settings.revivingCoins,
            volumeMilestones: settings.volumeMilestones
          }
        })
      );
    }
  }, [settings.focusUniverseSize, settings.revivingCoins, settings.volumeMilestones]);

  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "set_watchlist",
          payload: { symbols: watchlist }
        })
      );
    }
  }, [watchlist]);

  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "set_active_trades",
          payload: { symbols: activeTrades }
        })
      );
    }
  }, [activeTrades]);

  useEffect(() => {
    if (!frame) {
      return;
    }

    const alerts = frame.alerts ?? [];
    let freshAlerts: ScreenerAlert[];

    if (!primedAlertHistoryRef.current) {
      const now = Date.now();
      freshAlerts = alerts
        .filter(
          (alert) =>
            Number.isFinite(alert.createdAt) &&
            alert.createdAt <= now + 5_000 &&
            now - alert.createdAt <= initialAlertReplayWindowMs
        )
        .slice(0, initialAlertReplayLimit);
      seenAlertIdsRef.current = new Set(alerts.map((alert) => alert.id));
      primedAlertHistoryRef.current = true;
    } else {
      freshAlerts = alerts.filter((alert) => !seenAlertIdsRef.current.has(alert.id));
    }

    for (const alert of alerts) {
      seenAlertIdsRef.current.add(alert.id);
    }

    if (seenAlertIdsRef.current.size > 400) {
      seenAlertIdsRef.current = new Set(alerts.map((alert) => alert.id));
    }

    const notificationPreferences = notificationPreferencesRef.current;
    const criticalAlerts = [...freshAlerts].reverse().filter(isRevivingCoinAlert);
    const eligibleAlerts = [...freshAlerts].reverse().filter((alert) => {
      if (isLiquidationAlert(alert)) {
        return notificationPreferences.liquidationSignals;
      }

      return notificationPreferences.tradeSignals;
    });

    enqueueCriticalAlerts(criticalAlerts);

    for (const alert of eligibleAlerts) {
      enqueueSignalBillboard(alert);
    }

    if (!soundEnabledRef.current || eligibleAlerts.length === 0) {
      return;
    }

    if (signalSoundEnabledRef.current) {
      playSelectedSignalSound();
    }

    for (const alert of eligibleAlerts) {
      enqueueSignalSpeech(buildAlertSpeech(alert, baseAssetsBySymbol, voiceProfileRef.current));
    }
  }, [frame, baseAssetsBySymbol]);

  useEffect(() => {
    if (!frame) {
      return;
    }

    const snapshot = {
      phase: phaseStatus,
      marketFeed: marketFeedStatus,
      bookFeed: bookFeedStatus,
      pulse: frame.overview.dominantRegime
    };

    const previousSnapshot = connectionSnapshotRef.current;
    connectionSnapshotRef.current = snapshot;

    if (!previousSnapshot || !soundEnabledRef.current) {
      return;
    }

    const notificationPreferences = notificationPreferencesRef.current;
    const statusSpeechParts: string[] = [];
    const voiceProfileId = voiceProfileRef.current;
    const marketFeedRecovered =
      previousSnapshot.marketFeed !== snapshot.marketFeed && snapshot.marketFeed === "live";
    const bookFeedRecovered =
      previousSnapshot.bookFeed !== snapshot.bookFeed && snapshot.bookFeed === "live";
    const phaseRecovered = previousSnapshot.phase !== snapshot.phase && snapshot.phase === "live";
    const feedsFullyLive =
      snapshot.phase === "live" &&
      snapshot.marketFeed === "live" &&
      snapshot.bookFeed === "live";

    if (notificationPreferences.systemStatus) {
      if (marketFeedRecovered) {
        statusSpeechParts.push(feedRecoverySpeech("market", voiceProfileId));
      }

      if (bookFeedRecovered) {
        statusSpeechParts.push(feedRecoverySpeech("book", voiceProfileId));
      }

      if (!marketFeedRecovered && !bookFeedRecovered && phaseRecovered) {
        statusSpeechParts.push(feedRecoverySpeech("phase", voiceProfileId));
      }
    }

    if (statusSpeechParts.length > 0) {
      enqueueStatusSpeech(statusSpeechParts.join(". "));
    }

    if (
      notificationPreferences.pulseChanges &&
      feedsFullyLive &&
      previousSnapshot.pulse !== snapshot.pulse
    ) {
      enqueueStatusSpeech(pulseSpeechLabel(snapshot.pulse, voiceProfileId));
    }
  }, [frame, phaseStatus, marketFeedStatus, bookFeedStatus]);

  useEffect(() => {
    if (!accountActionPending || !accountStream) {
      return;
    }

    const connectCompleted =
      accountActionPending === "connect" &&
      (accountCredentialSource === "session" || accountStatusError !== null);
    const disconnectCompleted =
      accountActionPending === "disconnect" &&
      (accountCredentialSource !== "session" || accountStatusError !== null);

    if (!connectCompleted && !disconnectCompleted) {
      return;
    }

    setAccountActionPending(null);
  }, [
    accountActionPending,
    accountCredentialSource,
    accountStream?.credentialSource,
    accountStream?.connected,
    accountStream?.error,
    accountStream?.message,
    accountStatusError
  ]);

  useEffect(() => {
    if (connectionState === "open") {
      return;
    }

    setAccountActionPending(null);
  }, [connectionState]);

  useEffect(() => {
    if (accountCredentialSource !== "session" || accountStatusError) {
      return;
    }

    setBinanceApiKeyDraft("");
    setBinanceApiSecretDraft("");
    setAccountFormError(null);
  }, [accountCredentialSource, accountStatusError]);

  const handleAlertClick = async (alert: ScreenerAlert) => {
    const copied = await copyTextToClipboard(alert.symbol);

    if (!copied) {
      return;
    }

    if (copiedAlertTimerRef.current !== null) {
      window.clearTimeout(copiedAlertTimerRef.current);
    }

    setCopiedAlertId(alert.id);
    copiedAlertTimerRef.current = window.setTimeout(() => {
      setCopiedAlertId(null);
      copiedAlertTimerRef.current = null;
    }, 1_500);
  };

  const handleVolumeMilestoneClick = async (eventId: string, symbol: string) => {
    const copied = await copyTextToClipboard(symbol);

    if (!copied) {
      return;
    }

    if (copiedVolumeEventTimerRef.current !== null) {
      window.clearTimeout(copiedVolumeEventTimerRef.current);
    }

    setCopiedVolumeEventId(eventId);
    copiedVolumeEventTimerRef.current = window.setTimeout(() => {
      setCopiedVolumeEventId(null);
      copiedVolumeEventTimerRef.current = null;
    }, 1_500);
  };

  const filteredRows = useMemo(() => {
    if (!frame?.rows) {
      return [];
    }

    const term = search.trim().toUpperCase();
    const key = settings.sortBy;
    const matchesStandardFilters = (row: ScreenerRow) =>
      row.quoteVolume24h >= settings.minimumQuoteVolume &&
      (settings.biasFilter === "ALL" ? true : row.bias === settings.biasFilter) &&
      (settings.showOnlyWatchlist ? watchlistSet.has(row.symbol) : true) &&
      (term ? row.symbol.includes(term) || row.baseAsset.includes(term) : true);

    const sorted = [...frame.rows]
      .sort((left, right) => {
        return (right[key] as number) - (left[key] as number);
      });

    const activeRows = sorted.filter((row) => row.isActiveTrade);
    const regularRows = sorted.filter((row) => !row.isActiveTrade && matchesStandardFilters(row));

    return [...activeRows, ...regularRows];
  }, [frame, search, settings, watchlistSet]);

  const activeRowsCount = filteredRows.filter((row) => row.isActiveTrade).length;

  const addActiveTradeDraft = () => {
    const tokens = activeTradeDraft
      .split(/[,\s]+/)
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);

    if (tokens.length === 0) {
      return;
    }

    for (const token of tokens) {
      if (!activeTradeSet.has(token)) {
        toggleActiveTrade(token);
      }
    }

    setActiveTradeDraft("");
  };

  const addWatchlistDraft = () => {
    const tokens = watchlistDraft
      .split(/[,\s]+/)
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);

    if (tokens.length === 0) {
      return;
    }

    for (const token of tokens) {
      toggleWatchlist(token);
    }

    setWatchlistDraft("");
  };

  const handleBinanceConnect = () => {
    const apiKey = binanceApiKeyDraft.trim();
    const apiSecret = binanceApiSecretDraft.trim();

    if (!apiKey || !apiSecret) {
      setAccountFormError("Enter Binance API key and secret.");
      return;
    }

    setAccountFormError(null);

    if (
      !sendSocketMessage({
        type: "connect_binance_account",
        payload: {
          apiKey,
          apiSecret
        }
      })
    ) {
      return;
    }

    setAccountActionPending("connect");
  };

  const handleBinanceDisconnect = () => {
    setAccountFormError(null);
    dropQueuedStatusSpeech();

    if (
      !sendSocketMessage({
        type: "disconnect_binance_account"
      })
    ) {
      return;
    }

    setAccountActionPending("disconnect");
  };

  const handleCabinetLogin = async (profileId?: string) => {
    const normalizedHandle = normalizeBinanceHandle(
      binanceHandleDraft || activeProfile?.binanceHandle || ""
    );
    const targetProfileId = profileId?.toLowerCase() ?? normalizedHandle.toLowerCase();

    if (!targetProfileId) {
      setCabinetError("Enter Binance handle or UID to create the cabinet profile.");
      return;
    }

    setCabinetBusy(true);
    setCabinetError(null);

    try {
      await persistCurrentState();

      const existingRecord = await loadCabinetProfileRecord(targetProfileId);
      const nextHandle =
        (existingRecord?.profile.binanceHandle ?? normalizedHandle) ||
        targetProfileId.toUpperCase();
      const nextProfileName =
        existingRecord?.profile.profileName || profileNameDraft.trim() || nextHandle;
      const nextProfile = createCabinetProfile({
        existingProfile: existingRecord?.profile,
        profileName: nextProfileName,
        binanceHandle: nextHandle
      });
      const nextState = existingRecord?.state ?? getPersistableState();

      await saveCabinetProfileRecord({
        profile: nextProfile,
        state: nextState
      });
      await saveCabinetSession({
        mode: "authenticated",
        profileId: nextProfile.id
      });

      hydratePersistedState(nextState);
      setActiveProfile(nextProfile);
      setCabinetSessionState({
        mode: "authenticated",
        profileId: nextProfile.id
      });
      setProfileNameDraft(nextProfile.profileName);
      setBinanceHandleDraft(nextProfile.binanceHandle);
      setCabinetMessage(`Cabinet active: ${nextProfile.binanceHandle}.`);
      await refreshCabinetProfiles();
      setCabinetOpen(false);
    } catch {
      setCabinetError("Could not open cabinet profile. Please try again.");
    } finally {
      setCabinetBusy(false);
    }
  };

  const handleCabinetLogout = async () => {
    setCabinetBusy(true);
    setCabinetError(null);

    try {
      await persistCurrentState();
      await saveCabinetSession(createGuestSession());

      const guestState = await loadPersistedState();
      hydratePersistedState(guestState);
      setCabinetSessionState(createGuestSession());
      setActiveProfile(null);
      setCabinetMessage("Guest mode restored.");
      setCabinetOpen(false);
    } catch {
      setCabinetError("Could not return to guest mode.");
    } finally {
      setCabinetBusy(false);
    }
  };

  const collapsedSections = uiPreferences.collapsedSections;
  const visibleFrameSections = useMemo(
    () =>
      resolveVisibleFrameSections({
        desktopSection,
        visibleSections,
        collapsedSections
      }),
    [desktopSection, visibleSections, collapsedSections]
  );
  useEffect(() => {
    latestVisibleFrameSectionsRef.current = visibleFrameSections;

    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: VisibleSectionsMessage = {
      type: "visible_sections",
      sections: visibleFrameSections
    };

    socketRef.current.send(JSON.stringify(message));
  }, [visibleFrameSections]);
  useEffect(
    () =>
      renderTelemetry.subscribe(() => {
        setRenderTelemetryState(renderTelemetry.getSnapshot());
      }),
    []
  );
  useLayoutEffect(() => {
    renderTelemetry.markRenderCommitted(frame?.generatedAt ?? null);
  }, [frame]);
  const notificationPreferences = uiPreferences.notifications;
  const riskFrame = frame?.risk ?? null;
  const riskPositions = riskFrame?.positions ?? [];
  const riskAlerts = riskFrame?.alerts ?? [];
  const riskRows = frame?.rows ?? [];
  const topRiskRows = useMemo(
    () =>
      [...riskRows]
        .sort((left, right) => right.riskScore - left.riskScore || right.score - left.score)
        .slice(0, 6),
    [riskRows]
  );
  const fundingRows = frame?.funding ?? [];
  const fundingSorted = frame?.fundingSorted;
  const activeFundingRows = useMemo<FundingSymbolState[]>(() => {
    if (!fundingSorted) {
      return fundingRows;
    }

    if (fundingViewMode === "lowest") {
      return fundingSorted.lowest;
    }

    if (fundingViewMode === "basis") {
      return fundingSorted.basis;
    }

    return fundingSorted.highest;
  }, [fundingRows, fundingSorted, fundingViewMode]);
  const pnlLeaders = useMemo(
    () =>
      [...riskRows]
        .sort(
          (left, right) =>
            Math.abs(right.risk.pnlAttribution.total) -
              Math.abs(left.risk.pnlAttribution.total) ||
            right.riskScore - left.riskScore
        )
        .slice(0, 6),
    [riskRows]
  );
  const marketFlowRows = frame?.marketFlow ?? [];
  const liquidationDashboard = frame?.liquidations;
  const portfolioAnalytics = frame?.portfolioAnalytics ?? null;
  const regimeRows = frame?.regime ?? [];
  const leadRegime = regimeRows[0] ?? null;
  const regimeLearningPayload = frame?.regimeLearning ?? null;
  const regimeLearningRows = regimeLearningPayload?.symbols ?? [];
  const executionRows = frame?.execution ?? [];
  const conflictRows = frame?.conflict ?? [];
  const allocationRows = frame?.allocation ?? [];
  const signalIntelligenceRows = frame?.signalIntelligence ?? [];
  const metaRegimeGovernor = frame?.metaRegimeGovernor ?? null;
  const positionRiskOrchestrator = frame?.positionRiskOrchestrator ?? null;
  const regimeMemory = frame?.regimeMemory ?? null;
  const regimePrediction = frame?.regimePrediction ?? null;
  const regimeFeedbackCalibration = frame?.regimeFeedbackCalibration ?? null;
  const regimeLearningBySymbol = useMemo(
    () => new Map<string, RegimeLearningState>(regimeLearningRows.map((item) => [item.symbol, item])),
    [regimeLearningRows]
  );
  const leadRegimeLearning = leadRegime ? regimeLearningBySymbol.get(leadRegime.symbol) ?? null : null;
  const portfolioPrimaryAnalytics = portfolioAnalytics?.byPortfolio.primary ?? null;
  const portfolioStrategyAnalytics = portfolioAnalytics?.byStrategy.unassigned ?? null;
  const topLiquidationSymbols = liquidationDashboard?.topLiquidationSymbols ?? [];
  const liquidationHeatRanking = liquidationDashboard?.heatRanking ?? [];
  const liquidationBySymbol = liquidationDashboard?.bySymbol ?? {};
  const topLiquidationStates = useMemo(
    () =>
      topLiquidationSymbols
        .map((symbol) => liquidationBySymbol[symbol])
        .filter((state): state is LiquidationState => Boolean(state)),
    [liquidationBySymbol, topLiquidationSymbols]
  );
  const liquidationHeatBySymbol = useMemo(
    () =>
      new Map<string, LiquidationHeatEntry>(
        liquidationHeatRanking.map((entry) => [entry.symbol, entry])
      ),
    [liquidationHeatRanking]
  );
  const portfolioSymbolAnalytics = useMemo(
    () =>
      Object.entries(portfolioAnalytics?.bySymbol ?? {}) as Array<
        [string, PortfolioAnalyticsGroupState]
      >,
    [portfolioAnalytics?.bySymbol]
  );
  const portfolioCorrelationSymbols = portfolioPrimaryAnalytics?.correlation.symbols.slice(0, 8) ?? [];
  const portfolioCorrelationMatrix = useMemo(
    () =>
      portfolioCorrelationSymbols.map((symbol) =>
        portfolioCorrelationSymbols.map(
          (peer) => portfolioPrimaryAnalytics?.correlation.correlationMatrix[symbol]?.[peer] ?? 0
        )
      ),
    [portfolioCorrelationSymbols, portfolioPrimaryAnalytics?.correlation.correlationMatrix]
  );
  const portfolioCorrelationPairs =
    portfolioPrimaryAnalytics?.correlation.correlationHeatmap.pairs.slice(0, 8) ?? [];
  const correlationPreviewSymbols = riskFrame?.correlation.symbols.slice(0, 10) ?? [];
  const correlationPreviewMatrix = useMemo(
    () =>
      (riskFrame?.correlation.matrix ?? [])
        .slice(0, correlationPreviewSymbols.length)
        .map((row) => row.slice(0, correlationPreviewSymbols.length)),
    [riskFrame?.correlation.matrix, correlationPreviewSymbols]
  );
  const volumeMilestones = frame?.volumeMilestones ?? [];
  const volumeThresholdMilestones = frame?.volumeThresholdMilestones ?? [];
  const volumeMilestonePanel = visibleSections.volumeMilestones ? (
    <section
      id="volume-milestones"
      {...dashboardPanelDropProps("volumeMilestones")}
      className="swipe-page order-[15] rounded-lg border border-emerald-300/20 bg-panel p-3 shadow-panel"
    >
      {renderDashboardResizeFrame("volumeMilestones")}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
            100M Volume
          </h2>
          <span className="text-[11px] text-slate-500">
            {volumeMilestones.length} recent crossings around{" "}
            {compactUsd(settings.volumeMilestones.minQuoteVolume24h)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("volumeMilestones")}
          <PanelToggleButton
            collapsed={collapsedSections.volumeMilestones}
            onClick={() => toggleSection("volumeMilestones")}
          />
        </div>
      </div>

      {!collapsedSections.volumeMilestones ? (
        <div className="scrollbar-thin mt-2 max-h-[360px] space-y-1.5 overflow-y-auto">
          {volumeMilestones.length ? (
            volumeMilestones.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => void handleVolumeMilestoneClick(event.id, event.symbol)}
                title={`Copy ${event.symbol}`}
                className={`w-full rounded-md border px-2.5 py-2 text-left text-xs transition focus:outline-none focus:ring-2 ${volumeMilestoneCardClass(event)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-100">{formatPairLabel(event.symbol)}</div>
                  <div className="text-[11px] text-slate-400">
                    {formatClock(event.detectedAt)}
                  </div>
                </div>
                <div className="mt-1 text-slate-300">
                  24h volume {compactUsd(event.quoteVolume24h)}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  <span>
                    {formatPercent(event.change24hPct, 2)} | price {formatPrice(event.lastPrice)}
                  </span>
                  <span className={`text-[10px] ${copiedVolumeEventId === event.id ? "text-slate-300" : volumeMilestoneBadgeClass(event)}`}>
                    {copiedVolumeEventId === event.id
                      ? "copied"
                      : volumeMilestoneBadgeLabel(event)}
                  </span>
                </div>
              </button>
            ))
          ) : (
            <p className="text-xs text-slate-500">
              Waiting for a coin to cross the 24h volume threshold.
            </p>
          )}
        </div>
      ) : null}
    </section>
  ) : null;
  const volumeThresholdMilestonePanel = visibleSections.volumeThresholdMilestones ? (
    <section
      id="volume-threshold-milestones"
      {...dashboardPanelDropProps("volumeThresholdMilestones")}
      className="swipe-page order-[16] rounded-lg border border-sky-300/20 bg-panel p-3 shadow-panel"
    >
      {renderDashboardResizeFrame("volumeThresholdMilestones")}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-100">
            1-100M Volume
          </h2>
          <span className="text-[11px] text-slate-500">
            {volumeThresholdMilestones.length} recent crossings for 1-10M and 20-100M
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("volumeThresholdMilestones")}
          <PanelToggleButton
            collapsed={collapsedSections.volumeThresholdMilestones}
            onClick={() => toggleSection("volumeThresholdMilestones")}
          />
        </div>
      </div>

      {!collapsedSections.volumeThresholdMilestones ? (
        <div className="scrollbar-thin mt-2 max-h-[360px] space-y-1.5 overflow-y-auto">
          {volumeThresholdMilestones.length ? (
            volumeThresholdMilestones.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => void handleVolumeMilestoneClick(event.id, event.symbol)}
                title={`Copy ${event.symbol}`}
                className={`w-full rounded-md border px-2.5 py-2 text-left text-xs transition focus:outline-none focus:ring-2 ${volumeMilestoneCardClass(event)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-100">{formatPairLabel(event.symbol)}</div>
                  <div className="text-[11px] text-slate-400">
                    {formatClock(event.detectedAt)}
                  </div>
                </div>
                <div className="mt-1 text-slate-300">
                  24h volume {compactUsd(event.quoteVolume24h)}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  <span>
                    {formatPercent(event.change24hPct, 2)} | price {formatPrice(event.lastPrice)}
                  </span>
                  <span className={`text-[10px] ${copiedVolumeEventId === event.id ? "text-slate-300" : volumeMilestoneBadgeClass(event)}`}>
                    {copiedVolumeEventId === event.id
                      ? "copied"
                      : volumeMilestoneBadgeLabel(event)}
                  </span>
                </div>
              </button>
            ))
          ) : (
            <p className="text-xs text-slate-500">
              Waiting for a coin to cross one of the 1-100M levels.
            </p>
          )}
        </div>
      ) : null}
    </section>
  ) : null;
  const riskCenterPanel = visibleSections.riskCenter ? (
    <div
      id="risk-center"
      {...dashboardPanelDropProps("riskCenter")}
      className="swipe-page order-[65] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("riskCenter")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Risk Center
          </h2>
          <span className="text-xs text-slate-500">
            {riskFrame?.account.positionCount ?? 0} live Binance positions
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("riskCenter")}
          <div
            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${riskStatusClasses(
              riskFrame?.status
            )}`}
          >
            {riskFrame?.status ?? "waiting"}
          </div>
          <PanelToggleButton
            collapsed={collapsedSections.riskCenter}
            onClick={() => toggleSection("riskCenter")}
          />
        </div>
      </div>

      {!collapsedSections.riskCenter ? (
        <>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <OverviewCard
              title="Risk Score"
              value={
                typeof riskFrame?.riskScore === "number" ? riskFrame.riskScore.toFixed(1) : "--"
              }
              detail={riskFrame?.riskLevel ?? "LOW"}
            />
            <OverviewCard
              title="Gross Exposure"
              value={formatUsdMetric(riskFrame?.summary.grossExposureUsd.value)}
              detail={`${riskFrame?.account.longCount ?? 0} long / ${riskFrame?.account.shortCount ?? 0} short`}
            />
            <OverviewCard
              title="Portfolio VaR 95 / 5m"
              value={formatUsdMetric(riskFrame?.var.var95_5mUsd)}
              detail={`99% ${formatUsdMetric(riskFrame?.var.var99_5mUsd)}`}
            />
            <OverviewCard
              title="Open Risk"
              value={formatUsdMetric(riskFrame?.summary.openRiskUsd.value)}
              detail={`margin usage ${formatMetricPercent(riskFrame?.summary.marginUsagePct.value)}`}
            />
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Position Sizing Calculator
              </div>
              <div
                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${positionSizingLoading ? "border-caution/30 bg-caution/10 text-caution" : "border-white/10 bg-white/5 text-slate-300"}`}
              >
                {positionSizingLoading ? "calculating" : "manual"}
              </div>
            </div>

            <form
              className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                handlePositionSizingCalculate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <label className="space-y-1 text-xs">
                  <span className="text-slate-400">Symbol</span>
                  <input
                    value={positionSizingSymbol}
                    onChange={(event) => setPositionSizingSymbol(event.target.value.toUpperCase())}
                    placeholder="BTCUSDT"
                    className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm uppercase text-slate-100 outline-none transition focus:border-accent/60"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-slate-400">Direction</span>
                  <select
                    value={positionSizingDirection}
                    onChange={(event) =>
                      setPositionSizingDirection(event.target.value as "long" | "short" | "")
                    }
                    className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-accent/60"
                  >
                    <option value="">Select</option>
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-slate-400">Entry Price</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={positionSizingEntryPrice}
                    onChange={(event) => setPositionSizingEntryPrice(event.target.value)}
                    placeholder="65000"
                    className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-accent/60"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-slate-400">Stop Distance %</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={positionSizingStopDistancePct}
                    onChange={(event) => setPositionSizingStopDistancePct(event.target.value)}
                    placeholder="1.2"
                    className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-accent/60"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-slate-400">Custom Equity</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={positionSizingCustomEquity}
                    onChange={(event) => setPositionSizingCustomEquity(event.target.value)}
                    placeholder="optional"
                    className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-accent/60"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-slate-400">Risk / Trade %</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={positionSizingRiskPerTradePct}
                    onChange={(event) => setPositionSizingRiskPerTradePct(event.target.value)}
                    placeholder="optional"
                    className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-accent/60"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={positionSizingLoading}
                className="h-10 self-end rounded-md border border-accent/30 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:border-accent/60 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Calculate
              </button>
            </form>

            {positionSizingError ? (
              <div className="mt-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
                {positionSizingError}
              </div>
            ) : null}

            <div className="mt-3">
              {positionSizingResult ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <SignalReplayMetric label="Verdict / Risk" value={positionSizingResult.riskLevel} />
                    <SignalReplayMetric
                      label="Recommended"
                      value={formatSizingCurrency(positionSizingResult.recommendedNotional)}
                    />
                    <SignalReplayMetric
                      label="Max Notional"
                      value={formatSizingCurrency(positionSizingResult.maxNotional)}
                    />
                    <SignalReplayMetric
                      label="Raw Qty"
                      value={formatSizingQty(positionSizingResult.rawQty)}
                    />
                    <SignalReplayMetric
                      label="Normalized Qty"
                      value={formatSizingQty(positionSizingResult.normalizedQty)}
                    />
                    <SignalReplayMetric
                      label="Suggested Leverage"
                      value={formatSizingLeverage(positionSizingResult.suggestedLeverage)}
                    />
                    <SignalReplayMetric
                      label="Risk / Trade"
                      value={formatReplayNumber(positionSizingResult.riskPerTradePct, "%")}
                    />
                    <SignalReplayMetric
                      label="Stop Distance"
                      value={formatReplayNumber(positionSizingResult.stopDistancePct, "%")}
                    />
                    <SignalReplayMetric
                      label="Liq Buffer"
                      value={formatReplayNumber(positionSizingResult.liquidationBufferPct, "%")}
                    />
                    <SignalReplayMetric
                      label="Step Size"
                      value={formatSizingQty(positionSizingResult.stepSize)}
                    />
                    <SignalReplayMetric
                      label="Min Qty"
                      value={formatSizingQty(positionSizingResult.minQty)}
                    />
                    <SignalReplayMetric
                      label="Min Notional"
                      value={formatSizingCurrency(positionSizingResult.minNotional)}
                    />
                  </div>
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Do Not Trade Check
                    </div>
                    <DoNotTradeCheck result={positionSizingResult.doNotTrade} />
                  </div>
                  <SignalReplayList title="Reasons" items={positionSizingResult.reasons} />
                  <SignalReplayList title="Warnings" items={positionSizingResult.warnings} />
                  <SignalReplayList title="Constraints" items={positionSizingResult.constraints} />
                  <SignalReplayList
                    title="Exchange Filter Warnings"
                    items={positionSizingResult.exchangeFilterWarnings}
                  />
                </>
              ) : (
                <div className="rounded-md border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-500">
                  Enter symbol, direction and stop distance to calculate safe position size.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Portfolio Snapshot
                </div>
                <div className="text-xs text-slate-500">
                  largest {formatUsdMetric(riskFrame?.summary.largestPositionUsd.value)}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Stat
                  label="Net Exposure"
                  value={formatSignedUsdMetric(riskFrame?.summary.netExposureUsd.value)}
                />
                <Stat
                  label="Unrealized PnL"
                  value={formatSignedUsdMetric(riskFrame?.summary.unrealizedPnlUsd.value)}
                />
                <Stat
                  label="Available Balance"
                  value={formatUsdMetric(riskFrame?.summary.availableBalanceUsd.value)}
                />
                <Stat
                  label="Nearest Liq"
                  value={formatMetricPercent(riskFrame?.liquidationDistance.averageNearestDistancePct)}
                />
                <Stat
                  label="Pressure Index"
                  value={formatMetricPercent(riskFrame?.liquidationDistance.averagePressureIndex)}
                />
                <Stat
                  label="Vol Proxy"
                  value={formatMetricPercent(riskFrame?.var.volatilityProxy)}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${riskLevelClasses(
                    riskFrame?.riskLevel
                  )}`}
                >
                  overall {riskFrame?.riskLevel ?? "LOW"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                  {riskFrame?.account.enabled ? "account linked" : "account offline"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                  sync {riskFrame?.account.lastSyncAt ? formatClock(riskFrame.account.lastSyncAt) : "--"}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Active Alerts
                </div>
                <div className="text-xs text-slate-500">
                  {riskAlerts.length} active
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {riskAlerts.length ? (
                  riskAlerts.slice(0, 5).map((alert) => (
                    <div
                      key={alert.id}
                      className={`rounded-md border px-3 py-2 text-xs ${alertSeverityClasses(
                        alert.severity
                      )}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium uppercase tracking-[0.14em]">
                          {alert.code.replace(/_/g, " ")}
                        </div>
                        <div>{alert.symbol ?? "market"}</div>
                      </div>
                      <div className="mt-1 text-slate-200">{alert.message}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No risk warnings right now.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Top Risk Symbols
              </div>
              <div className="text-xs text-slate-500">
                focus + portfolio context
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {topRiskRows.length ? (
                topRiskRows.map((row) => (
                  <div
                    key={row.symbol}
                    className="rounded-lg border border-white/10 bg-white/5 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-slate-100">{formatPairLabel(row.symbol)}</div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${riskLevelClasses(
                          row.riskLevel
                        )}`}
                      >
                        {row.riskLevel}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Stat label="Risk Score" value={row.riskScore.toFixed(1)} />
                      <Stat label="Bias" value={row.bias} />
                      <Stat
                        label="Liq Dist"
                        value={formatMetricPercent(row.risk.liquidationDistance.nearestDistancePct)}
                      />
                      <Stat
                        label="Flow"
                        value={row.risk.flow.flowPressureScore.toFixed(1)}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Waiting for risk-ranked rows from backend.</p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Live Positions
              </div>
              <div className="text-xs text-slate-500">
                sorted by notional exposure
              </div>
            </div>

            {riskPositions.length ? (
              <div className="scrollbar-thin mt-3 max-h-[340px] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-[#0f141b] text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    <tr>
                      <HeaderCell>Symbol</HeaderCell>
                      <HeaderCell>Side</HeaderCell>
                      <HeaderCell>Notional</HeaderCell>
                      <HeaderCell>uPnL</HeaderCell>
                      <HeaderCell>Entry</HeaderCell>
                      <HeaderCell>Mark</HeaderCell>
                      <HeaderCell>Liq Px</HeaderCell>
                      <HeaderCell>Liq Dist</HeaderCell>
                      <HeaderCell>Risk</HeaderCell>
                      <HeaderCell>Flow</HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {riskPositions.map((position) => (
                      <tr
                        key={`${position.symbol}-${position.side}`}
                        className="border-t border-white/5"
                      >
                        <Cell className="font-medium text-slate-100">
                          {formatPairLabel(position.symbol)}
                        </Cell>
                        <Cell
                          className={
                            position.side === "LONG" ? "text-positive" : "text-negative"
                          }
                        >
                          {position.side}
                        </Cell>
                        <Cell>{compactUsd(position.notionalUsd)}</Cell>
                        <Cell
                          className={biasColor(position.unrealizedPnlUsd)}
                        >
                          {formatSignedUsdMetric(position.unrealizedPnlUsd)}
                        </Cell>
                        <Cell>{formatPrice(position.entryPrice)}</Cell>
                        <Cell>{formatPrice(position.markPrice)}</Cell>
                        <Cell>
                          {position.liquidationPrice !== null
                            ? formatPrice(position.liquidationPrice)
                            : "--"}
                        </Cell>
                        <Cell>
                          {(position.distancePct ?? position.distanceToLiquidationPct) !== null
                            ? formatMetricPercent(
                                position.distancePct ?? position.distanceToLiquidationPct
                              )
                            : "--"}
                        </Cell>
                        <Cell className={scoreColor(position.riskScore)}>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${riskLevelClasses(
                              position.riskLevel
                            )}`}
                          >
                            {position.riskLevel}
                          </span>
                          <span className="ml-2">
                            {position.riskScore.toFixed(1)} / {position.portfolioRiskLevel}
                          </span>
                        </Cell>
                        <Cell className={flowBiasClasses(position.risk.flow.directionalBias)}>
                          {position.risk.flow.flowPressureScore.toFixed(1)}
                        </Cell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                {riskFrame?.account.enabled
                  ? "No open Binance positions to aggregate."
                  : "Risk Center activates after Binance account connect."}
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  ) : null;
  const correlationHeatmapPanel = visibleSections.correlationHeatmap ? (
    <div
      id="correlation-heatmap"
      {...dashboardPanelDropProps("correlationHeatmap")}
      className="swipe-page order-[66] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("correlationHeatmap")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Correlation Heatmap
          </h2>
          <span className="text-xs text-slate-500">
            {riskFrame?.correlation.symbols.length ?? 0} tracked symbols
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("correlationHeatmap")}
          <PanelToggleButton
            collapsed={collapsedSections.correlationHeatmap}
            onClick={() => toggleSection("correlationHeatmap")}
          />
        </div>
      </div>

      {!collapsedSections.correlationHeatmap ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <OverviewCard
              title="Max Abs Corr"
              value={riskFrame ? riskFrame.correlation.maxAbsCorrelation.toFixed(2) : "--"}
              detail={`${riskFrame?.correlation.clusters.length ?? 0} clusters`}
            />
            <OverviewCard
              title="Heatmap Size"
              value={`${correlationPreviewSymbols.length}x${correlationPreviewSymbols.length}`}
              detail="first 10 symbols"
            />
            <OverviewCard
              title="Cluster Spike"
              value={
                riskAlerts.some((alert) => alert.code === "correlation_spike") ? "active" : "clear"
              }
              detail="> 0.85 cluster threshold"
            />
          </div>

          {correlationPreviewSymbols.length ? (
            <div className="overflow-auto rounded-lg border border-white/10 bg-black/20 p-3">
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `120px repeat(${correlationPreviewSymbols.length}, minmax(56px, 1fr))`
                }}
              >
                <div />
                {correlationPreviewSymbols.map((symbol) => (
                  <div
                    key={`corr-col-${symbol}`}
                    className="truncate px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400"
                  >
                    {normalizeCoinName(symbol)}
                  </div>
                ))}
                {correlationPreviewSymbols.map((symbol, rowIndex) => (
                  <div key={`corr-row-${symbol}`} className="contents">
                    <div className="truncate px-2 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                      {normalizeCoinName(symbol)}
                    </div>
                    {correlationPreviewMatrix[rowIndex]?.map((value, columnIndex) => (
                      <div
                        key={`corr-cell-${symbol}-${correlationPreviewSymbols[columnIndex]}`}
                        className="rounded-md px-2 py-2 text-center text-xs font-medium"
                        style={correlationCellStyle(value)}
                      >
                        {value.toFixed(2)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Waiting for rolling correlation data.</p>
          )}

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Correlation Clusters
            </div>
            <div className="mt-3 space-y-2">
              {riskFrame?.correlation.clusters.length ? (
                riskFrame.correlation.clusters.slice(0, 5).map((cluster, index) => (
                  <div
                    key={`cluster-${index}`}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-slate-100">
                        {cluster.symbols.slice(0, 5).join(", ")}
                      </div>
                      <div className="text-xs text-slate-400">
                        avg {cluster.averageCorrelation.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No high-correlation clusters detected.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Portfolio Correlation Matrix
              </div>
              <div className="text-xs text-slate-500">
                {portfolioPrimaryAnalytics?.correlation.sampleSize ?? 0} samples
              </div>
            </div>

            {portfolioCorrelationSymbols.length ? (
              <div className="mt-3 overflow-auto">
                <div
                  className="grid gap-1"
                  style={{
                    gridTemplateColumns: `120px repeat(${portfolioCorrelationSymbols.length}, minmax(56px, 1fr))`
                  }}
                >
                  <div />
                  {portfolioCorrelationSymbols.map((symbol) => (
                    <div
                      key={`portfolio-corr-col-${symbol}`}
                      className="truncate px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400"
                    >
                      {normalizeCoinName(symbol)}
                    </div>
                  ))}
                  {portfolioCorrelationSymbols.map((symbol, rowIndex) => (
                    <div key={`portfolio-corr-row-${symbol}`} className="contents">
                      <div className="truncate px-2 py-2 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        {normalizeCoinName(symbol)}
                      </div>
                      {portfolioCorrelationMatrix[rowIndex]?.map((value, columnIndex) => (
                        <div
                          key={`portfolio-corr-cell-${symbol}-${portfolioCorrelationSymbols[columnIndex]}`}
                          className="rounded-md px-2 py-2 text-center text-xs font-medium"
                          style={correlationCellStyle(value)}
                        >
                          {value.toFixed(2)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Waiting for portfolio return history.</p>
            )}

            <div className="mt-4 space-y-2">
              {portfolioCorrelationPairs.length ? (
                portfolioCorrelationPairs.map((pair) => (
                  <div
                    key={`portfolio-pair-${pair.symbolA}-${pair.symbolB}`}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-slate-100">
                        {formatPairLabel(pair.symbolA)} / {formatPairLabel(pair.symbolB)}
                      </div>
                      <div className="text-xs text-slate-400">
                        corr {pair.correlation.toFixed(2)} | intensity {pair.intensity.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No portfolio correlation pairs yet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const varPanel = visibleSections.varPanel ? (
    <div
      id="var-panel"
      {...dashboardPanelDropProps("varPanel")}
      className="swipe-page order-[67] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("varPanel")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">VaR</h2>
          <span className="text-xs text-slate-500">
            method {riskFrame?.var.method ?? "focus_proxy"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("varPanel")}
          <PanelToggleButton
            collapsed={collapsedSections.varPanel}
            onClick={() => toggleSection("varPanel")}
          />
        </div>
      </div>

      {!collapsedSections.varPanel ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewCard
              title="95% / 5m"
              value={formatUsdMetric(riskFrame?.var.var95_5mUsd)}
              detail={`99% ${formatUsdMetric(riskFrame?.var.var99_5mUsd)}`}
            />
            <OverviewCard
              title="95% / 1h"
              value={formatUsdMetric(riskFrame?.var.var95_1hUsd)}
              detail={`99% ${formatUsdMetric(riskFrame?.var.var99_1hUsd)}`}
            />
            <OverviewCard
              title="Volatility Proxy"
              value={formatMetricPercent(riskFrame?.var.volatilityProxy)}
              detail={`${riskFrame?.var.sampleSize ?? 0} samples`}
            />
            <OverviewCard
              title="Breach"
              value={riskFrame?.var.breach ? "BREACH" : "CLEAR"}
              detail="portfolio VaR threshold"
            />
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat
                label="5m confidence"
                value={`${formatUsdMetric(riskFrame?.var.var95_5mUsd)} / ${formatUsdMetric(riskFrame?.var.var99_5mUsd)}`}
              />
              <Stat
                label="1h confidence"
                value={`${formatUsdMetric(riskFrame?.var.var95_1hUsd)} / ${formatUsdMetric(riskFrame?.var.var99_1hUsd)}`}
              />
              <Stat
                label="Volatility proxy"
                value={formatMetricPercent(riskFrame?.var.volatilityProxy)}
              />
              <Stat
                label="Alert state"
                value={riskAlerts.some((alert) => alert.code === "var_breach") ? "active" : "clear"}
              />
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard
                title="Portfolio VaR 95"
                value={formatUsdMetric(portfolioPrimaryAnalytics?.var.var95)}
                detail={`99% ${formatUsdMetric(portfolioPrimaryAnalytics?.var.var99)}`}
              />
              <OverviewCard
                title="Expected Shortfall"
                value={formatUsdMetric(portfolioPrimaryAnalytics?.expectedShortfall.es95)}
                detail={`99% ${formatUsdMetric(portfolioPrimaryAnalytics?.expectedShortfall.es99)}`}
              />
              <OverviewCard
                title="Window"
                value={`${portfolioPrimaryAnalytics?.var.windowDays ?? 30}d`}
                detail={`${portfolioPrimaryAnalytics?.var.sampleSize ?? 0} scenarios`}
              />
              <OverviewCard
                title="Strategy Group"
                value={portfolioStrategyAnalytics ? "unassigned" : "--"}
                detail={portfolioPrimaryAnalytics ? "portfolio primary" : "awaiting account history"}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const fundingBasisPanel = visibleSections.fundingBasis ? (
    <div
      id="funding-basis"
      {...dashboardPanelDropProps("fundingBasis")}
      className="swipe-page order-[68] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("fundingBasis")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Funding
          </h2>
          <span className="text-xs text-slate-500">
            {fundingRows.length} tracked symbols
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("fundingBasis")}
          <PanelToggleButton
            collapsed={collapsedSections.fundingBasis}
            onClick={() => toggleSection("fundingBasis")}
          />
        </div>
      </div>

      {!collapsedSections.fundingBasis ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewCard
              title="Avg Funding"
              value={
                typeof riskFrame?.funding.averageFundingRate === "number"
                  ? formatPercent(riskFrame.funding.averageFundingRate * 100, 3)
                  : "--"
              }
              detail="per funding interval"
            />
            <OverviewCard
              title="Avg Basis"
              value={
                typeof riskFrame?.funding.averageBasisPct === "number"
                  ? formatPercent(riskFrame.funding.averageBasisPct, 2)
                  : "--"
              }
              detail="mark - index"
            />
            <OverviewCard
              title="Pressure"
              value={
                typeof riskFrame?.funding.annualizedPressureScore === "number"
                  ? riskFrame.funding.annualizedPressureScore.toFixed(1)
                  : "--"
              }
              detail="annualized funding pressure"
            />
            <OverviewCard
              title="Extreme Funding"
              value={`${riskFrame?.funding.extremeSymbols.length ?? 0}`}
              detail="threshold crossed"
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Funding Dashboard
              </div>
              <div className="flex flex-wrap gap-2">
                {fundingViewOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFundingViewMode(option.id)}
                    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] transition ${
                      fundingViewMode === option.id
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-white/10 bg-white/5 text-slate-300 hover:border-accent/30 hover:text-accent"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              {activeFundingRows.length ? (
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-slate-400">
                    <tr>
                      <HeaderCell>Symbol</HeaderCell>
                      <HeaderCell>Funding</HeaderCell>
                      <HeaderCell>Annualized</HeaderCell>
                      <HeaderCell>Basis</HeaderCell>
                      <HeaderCell>Premium</HeaderCell>
                      <HeaderCell>Mark</HeaderCell>
                      <HeaderCell>Index</HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {activeFundingRows.map((row) => (
                      <tr key={`funding-${fundingViewMode}-${row.symbol}`} className="border-t border-white/5">
                        <Cell>
                          <span className="font-medium text-slate-100">
                            {formatPairLabel(row.symbol)}
                          </span>
                        </Cell>
                        <Cell className={biasColor(row.fundingRate)}>
                          {formatPercent(row.fundingRate * 100, 3)}
                        </Cell>
                        <Cell className={biasColor(row.annualizedFunding)}>
                          {formatPercent(row.annualizedFunding * 100, 2)}
                        </Cell>
                        <Cell className={biasColor(row.basisPct)}>
                          {formatPercent(row.basisPct, 2)}
                        </Cell>
                        <Cell className={biasColor(row.premiumPct)}>
                          {formatPercent(row.premiumPct, 2)}
                        </Cell>
                        <Cell>{formatPrice(row.markPrice)}</Cell>
                        <Cell>{formatPrice(row.indexPrice)}</Cell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500">Waiting for funding and basis snapshots.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const marketFlowPanel = visibleSections.marketFlow ? (
    <div
      id="market-flow"
      {...dashboardPanelDropProps("marketFlow")}
      className="swipe-page order-[69] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("marketFlow")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Market Flow
          </h2>
          <span className="text-xs text-slate-500">
            OI + CVD + liquidations
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("marketFlow")}
          <PanelToggleButton
            collapsed={collapsedSections.marketFlow}
            onClick={() => toggleSection("marketFlow")}
          />
        </div>
      </div>

      {!collapsedSections.marketFlow ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewCard
              title="Pressure Score"
              value={riskFrame ? riskFrame.flow.aggregatePressureScore.toFixed(1) : "--"}
              detail={`bias ${riskFrame?.flow.directionalBias ?? "NEUTRAL"}`}
            />
            <OverviewCard
              title="OI Delta / 5m"
              value={formatSignedUsdMetric(riskFrame?.flow.totalOpenInterestDelta5mUsd)}
              detail={`1h ${formatSignedUsdMetric(riskFrame?.flow.totalOpenInterestDelta1hUsd)}`}
            />
            <OverviewCard
              title="CVD / 5m"
              value={formatSignedUsdMetric(riskFrame?.flow.totalCvd5mUsd)}
              detail={`1h ${formatSignedUsdMetric(riskFrame?.flow.totalCvd1hUsd)}`}
            />
            <OverviewCard
              title="Liq Net / 5m"
              value={formatSignedUsdMetric(riskFrame?.flow.totalLiquidationNet5mUsd)}
              detail={`1h ${formatSignedUsdMetric(riskFrame?.flow.totalLiquidationNet1hUsd)}`}
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Flow Leaders
              </div>
              <div className={`text-xs ${flowBiasClasses(riskFrame?.flow.directionalBias)}`}>
                {riskFrame?.flow.directionalBias ?? "NEUTRAL"}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {riskFrame?.flow.leaders.length ? (
                riskFrame.flow.leaders.slice(0, 6).map((leader) => (
                  <div
                    key={`flow-${leader.symbol}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="font-medium text-slate-100">{formatPairLabel(leader.symbol)}</div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={flowBiasClasses(leader.directionalBias)}>
                        {leader.directionalBias}
                      </span>
                      <span className="text-slate-300">{leader.flowPressureScore.toFixed(1)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Waiting for market-wide flow leaders.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Market Flow Detail
              </div>
              <div className="text-xs text-slate-500">{marketFlowRows.length} symbols</div>
            </div>
            <div className="mt-3 overflow-x-auto">
              {marketFlowRows.length ? (
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-slate-400">
                    <tr>
                      <HeaderCell>Symbol</HeaderCell>
                      <HeaderCell>Current OI</HeaderCell>
                      <HeaderCell>OI 5m</HeaderCell>
                      <HeaderCell>OI 15m</HeaderCell>
                      <HeaderCell>OI 1h</HeaderCell>
                      <HeaderCell>CVD</HeaderCell>
                      <HeaderCell>Slope</HeaderCell>
                      <HeaderCell>Divergence</HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {marketFlowRows.map((row: MarketFlowState) => (
                      <tr key={`market-flow-${row.symbol}`} className="border-t border-white/5">
                        <Cell>
                          <span className="font-medium text-slate-100">
                            {formatPairLabel(row.symbol)}
                          </span>
                        </Cell>
                        <Cell>{formatMetricNumber(row.openInterest.currentOI, 0)}</Cell>
                        <Cell className={biasColor(row.openInterest.oiChange5m)}>
                          {formatPercent(row.openInterest.oiChange5m, 2)}
                        </Cell>
                        <Cell className={biasColor(row.openInterest.oiChange15m)}>
                          {formatPercent(row.openInterest.oiChange15m, 2)}
                        </Cell>
                        <Cell className={biasColor(row.openInterest.oiChange1h)}>
                          {formatPercent(row.openInterest.oiChange1h, 2)}
                        </Cell>
                        <Cell className={biasColor(row.cvd.value)}>
                          {formatSignedUsdMetric(row.cvd.value)}
                        </Cell>
                        <Cell className={biasColor(row.cvd.slope)}>
                          {formatSignedUsdMetric(row.cvd.slope)}
                        </Cell>
                        <Cell>
                          <span
                            className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${marketFlowDivergenceClasses(
                              row.cvd.divergence
                            )}`}
                          >
                            {row.cvd.divergence}
                          </span>
                        </Cell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500">Waiting for market flow snapshots.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Liquidation Dashboard
              </div>
              <div className="text-xs text-slate-500">
                {topLiquidationStates.length} active symbols
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              {topLiquidationStates.length ? (
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-slate-400">
                    <tr>
                      <HeaderCell>Symbol</HeaderCell>
                      <HeaderCell>Heat</HeaderCell>
                      <HeaderCell>1m</HeaderCell>
                      <HeaderCell>5m</HeaderCell>
                      <HeaderCell>15m</HeaderCell>
                      <HeaderCell>1h</HeaderCell>
                      <HeaderCell>Long Liq</HeaderCell>
                      <HeaderCell>Short Liq</HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {topLiquidationStates.slice(0, 10).map((state) => {
                      const heatEntry = liquidationHeatBySymbol.get(state.symbol);

                      return (
                        <tr key={`liquidation-${state.symbol}`} className="border-t border-white/5">
                          <Cell>
                            <span className="font-medium text-slate-100">
                              {formatPairLabel(state.symbol)}
                            </span>
                          </Cell>
                          <Cell>
                            <span
                              className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${liquidationHeatClasses(
                                heatEntry?.heat
                              )}`}
                            >
                              {heatEntry?.heat ?? "low"}
                            </span>
                          </Cell>
                          <Cell>{compactUsd(state.liquidations1m)}</Cell>
                          <Cell>{compactUsd(state.liquidations5m)}</Cell>
                          <Cell>{compactUsd(state.liquidations15m)}</Cell>
                          <Cell>{compactUsd(state.liquidations1h)}</Cell>
                          <Cell className="text-negative">
                            {formatSignedUsdMetric(state.longLiquidations)}
                          </Cell>
                          <Cell className="text-positive">
                            {formatSignedUsdMetric(state.shortLiquidations)}
                          </Cell>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500">Waiting for liquidation clusters.</p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {liquidationHeatRanking.length ? (
                liquidationHeatRanking.slice(0, 12).map((entry) => (
                  <div
                    key={`liquidation-heat-${entry.symbol}`}
                    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${liquidationHeatClasses(
                      entry.heat
                    )}`}
                  >
                    {formatPairLabel(entry.symbol)} {entry.heat}
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Heat ranking will appear after liquidation flow arrives.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Unified Regime
              </div>
              <div className="text-xs text-slate-500">{regimeRows.length} ranked symbols</div>
            </div>
            <div className="mt-3 space-y-2">
              {regimeRows.length ? (
                regimeRows.slice(0, 8).map((regime: RegimeState) => {
                  const learning = regimeLearningBySymbol.get(regime.symbol);

                  return (
                    <div
                      key={`regime-${regime.symbol}`}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-100">
                          {formatPairLabel(regime.symbol)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${regimeBiasClasses(
                              regime.bias
                            )}`}
                          >
                            {regime.bias}
                          </span>
                          <span className="text-xs text-slate-300">
                            {regime.finalScore.toFixed(2)} / {(learning?.confidence ?? regime.confidence).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        <Stat label="Risk" value={regime.components.riskScore.toFixed(2)} />
                        <Stat label="Funding" value={regime.components.fundingScore.toFixed(2)} />
                        <Stat label="Flow" value={regime.components.flowScore.toFixed(2)} />
                        <Stat
                          label="Liquidations"
                          value={regime.components.liquidationScore.toFixed(2)}
                        />
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        <Stat
                          label="Accuracy"
                          value={learning ? `${learning.accuracy.toFixed(1)}%` : "--"}
                        />
                        <Stat
                          label="Stability"
                          value={learning ? `${learning.stability.toFixed(1)}%` : "--"}
                        />
                        <Stat
                          label="Expectancy"
                          value={learning ? formatPercent(learning.expectancy, 2) : "--"}
                        />
                        <Stat
                          label="Long/Short Hit"
                          value={
                            learning
                              ? `${learning.directionalAccuracy.long.toFixed(0)}% / ${learning.directionalAccuracy.short.toFixed(0)}%`
                              : "--"
                          }
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-500">Waiting for unified regime scoring.</p>
              )}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard
                title="Adaptive Risk"
                value={
                  regimeLearningPayload
                    ? regimeLearningPayload.adaptiveWeights.risk.toFixed(2)
                    : "--"
                }
                detail="backend suggested"
              />
              <OverviewCard
                title="Adaptive Funding"
                value={
                  regimeLearningPayload
                    ? regimeLearningPayload.adaptiveWeights.funding.toFixed(2)
                    : "--"
                }
                detail="backend suggested"
              />
              <OverviewCard
                title="Adaptive Flow"
                value={
                  regimeLearningPayload
                    ? regimeLearningPayload.adaptiveWeights.flow.toFixed(2)
                    : "--"
                }
                detail="backend suggested"
              />
              <OverviewCard
                title="Adaptive Liq"
                value={
                  regimeLearningPayload
                    ? regimeLearningPayload.adaptiveWeights.liquidations.toFixed(2)
                    : "--"
                }
                detail="backend suggested"
              />
            </div>
            <div className="mt-4 rounded-md border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Execution Intelligence
                </div>
                <div className="text-xs text-slate-500">
                  backend priority ranking
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {executionRows.length ? (
                  executionRows.slice(0, 8).map((execution: ExecutionState) => (
                    <div
                      key={`execution-${execution.symbol}`}
                      className="rounded-md border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-100">
                          {formatPairLabel(execution.symbol)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${regimeBiasClasses(
                              execution.bias
                            )}`}
                          >
                            {execution.bias}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${executionTierClasses(
                              execution.tier
                            )}`}
                          >
                            {execution.tier.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
                        <Stat label="Execution" value={execution.executionScore.toFixed(2)} />
                        <Stat label="Priority" value={execution.priorityScore.toFixed(2)} />
                        <Stat
                          label="Size Mult"
                          value={execution.suggestedSizeMultiplier.toFixed(2)}
                        />
                        <Stat
                          label="Weights"
                          value={`${execution.reasoning.regimeWeight.toFixed(2)} / ${execution.reasoning.learningWeight.toFixed(2)} / ${execution.reasoning.expectancyWeight.toFixed(2)}`}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Waiting for execution ranking.</p>
                )}
              </div>
            </div>
            <div className="mt-4 rounded-md border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Signal Conflict
                </div>
                <div className="text-xs text-slate-500">
                  backend consensus overlay
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {conflictRows.length ? (
                  conflictRows.slice(0, 8).map((conflict: ConflictState) => {
                    const agreementEntries = [
                      ["Risk", conflict.signalAgreement.risk],
                      ["Funding", conflict.signalAgreement.funding],
                      ["Flow", conflict.signalAgreement.flow],
                      ["Liq", conflict.signalAgreement.liquidation],
                      ["Regime", conflict.signalAgreement.regime]
                    ] as const;

                    return (
                      <div
                        key={`conflict-${conflict.symbol}`}
                        className="rounded-md border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-slate-100">
                            {formatPairLabel(conflict.symbol)}
                          </div>
                          <div className="text-xs text-slate-300">
                            adjusted {conflict.adjustedConfidence.toFixed(0)}%
                          </div>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-4">
                          <Stat
                            label="Conflict"
                            value={conflict.conflictIndex.toFixed(2)}
                          />
                          <Stat
                            label="Consensus"
                            value={conflict.consensusScore.toFixed(2)}
                          />
                          <Stat
                            label="Alignment"
                            value={conflict.alignmentScore.toFixed(2)}
                          />
                          <Stat
                            label="Adj Conf"
                            value={`${conflict.adjustedConfidence.toFixed(0)}%`}
                          />
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                          {agreementEntries.map(([label, value]) => (
                            <div key={`${conflict.symbol}-${label}`} className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                <span>{label}</span>
                                <span>{value.toFixed(2)}</span>
                              </div>
                              <div className="h-2 rounded-full bg-white/10">
                                <div
                                  className={`h-2 rounded-full ${signalAgreementFillClasses(value)}`}
                                  style={{ width: `${Math.max(Math.abs(value), 0.04) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">Waiting for signal conflict overlay.</p>
                )}
              </div>
            </div>
            <div className="mt-4 rounded-md border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Portfolio Allocation
                </div>
                <div className="text-xs text-slate-500">
                  normalized risk budget
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {allocationRows.length ? (
                  allocationRows.slice(0, 8).map((allocation: AllocationState) => (
                    <div
                      key={`allocation-${allocation.symbol}`}
                      className="rounded-md border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-100">
                          {formatPairLabel(allocation.symbol)}
                        </div>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${allocationTierClasses(
                            allocation.tier
                          )}`}
                        >
                          Tier {allocation.tier}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
                        <Stat label="Alloc Score" value={allocation.allocationScore.toFixed(3)} />
                        <Stat
                          label="Weight"
                          value={`${(allocation.weight * 100).toFixed(1)}%`}
                        />
                        <Stat
                          label="Suggested Size"
                          value={`${(allocation.suggestedSize * 100).toFixed(1)}%`}
                        />
                        <Stat
                          label="Drivers"
                          value={`${allocation.reasoning.execution.toFixed(2)} / ${allocation.reasoning.confidence.toFixed(2)} / ${allocation.reasoning.expectancy.toFixed(2)} / ${allocation.reasoning.consensus.toFixed(2)}`}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Waiting for allocation ranking.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const signalIntelligencePanel = visibleSections.signalIntelligence ? (
    <div
      id="signal-intelligence"
      {...dashboardPanelDropProps("signalIntelligence")}
      className="swipe-page order-[70] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("signalIntelligence")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Signal Intelligence
          </h2>
          <span className="text-xs text-slate-500">
            system coherence + readability
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("signalIntelligence")}
          <PanelToggleButton
            collapsed={collapsedSections.signalIntelligence}
            onClick={() => toggleSection("signalIntelligence")}
          />
        </div>
      </div>

      {!collapsedSections.signalIntelligence ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="Lead SHS"
              value={signalIntelligenceRows[0] ? signalIntelligenceRows[0].shs.toFixed(1) : "--"}
              detail={signalIntelligenceRows[0]?.marketState ?? "waiting"}
            />
            <OverviewCard
              title="Lead SSI"
              value={signalIntelligenceRows[0] ? signalIntelligenceRows[0].ssi.toFixed(2) : "--"}
              detail="signal stability"
            />
            <OverviewCard
              title="Lead MRS"
              value={signalIntelligenceRows[0] ? signalIntelligenceRows[0].mrs.toFixed(2) : "--"}
              detail="market readability"
            />
            <OverviewCard
              title="Lead SDP"
              value={signalIntelligenceRows[0] ? signalIntelligenceRows[0].sdp.toFixed(2) : "--"}
              detail="decay pressure"
            />
            <OverviewCard
              title="Adj Confidence"
              value={
                signalIntelligenceRows[0]
                  ? `${signalIntelligenceRows[0].adjustedSystemConfidence.toFixed(0)}%`
                  : "--"
              }
              detail="system-adjusted"
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Cross-Domain Intelligence
              </div>
              <div className="text-xs text-slate-500">
                {signalIntelligenceRows.length} ranked symbols
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {signalIntelligenceRows.length ? (
                signalIntelligenceRows.slice(0, 8).map((item: SignalIntelligenceState) => (
                  <div
                    key={`signal-intelligence-${item.symbol}`}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-slate-100">
                        {formatPairLabel(item.symbol)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${marketStateClasses(
                            item.marketState
                          )}`}
                        >
                          {item.marketState.replace("_", " ")}
                        </span>
                        <span className="text-xs text-slate-300">
                          {item.adjustedSystemConfidence.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <Stat label="SSI" value={item.ssi.toFixed(2)} />
                      <Stat label="MRS" value={item.mrs.toFixed(2)} />
                      <Stat label="SDP" value={item.sdp.toFixed(2)} />
                      <Stat label="SHS" value={item.shs.toFixed(1)} />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Waiting for signal intelligence snapshot.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const metaRegimeGovernorPanel = visibleSections.metaRegimeGovernor ? (
    <div
      id="meta-regime-governor"
      {...dashboardPanelDropProps("metaRegimeGovernor")}
      className="swipe-page order-[70] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("metaRegimeGovernor")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Meta Regime Governor
          </h2>
          <span className="text-xs text-slate-500">
            system-wide trust + permission overlay
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("metaRegimeGovernor")}
          <PanelToggleButton
            collapsed={collapsedSections.metaRegimeGovernor}
            onClick={() => toggleSection("metaRegimeGovernor")}
          />
        </div>
      </div>

      {!collapsedSections.metaRegimeGovernor ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="STS"
              value={metaRegimeGovernor ? metaRegimeGovernor.sts.toFixed(1) : "--"}
              detail={
                metaRegimeGovernor
                  ? `overlay x${metaRegimeGovernor.overlayMultiplier.toFixed(2)}`
                  : "waiting"
              }
            />
            <OverviewCard
              title="Trade Permission"
              value={metaRegimeGovernor?.tradePermission ?? "--"}
              detail="system-wide gate"
            />
            <OverviewCard
              title="Market Mode"
              value={metaRegimeGovernor?.marketMode ?? "--"}
              detail="operational regime"
            />
            <OverviewCard
              title="Override Mode"
              value={metaRegimeGovernor?.overrideMode ?? "--"}
              detail={
                metaRegimeGovernor
                  ? metaRegimeGovernor.diagnostics.effectiveRegimeBias
                  : "waiting"
              }
            />
            <OverviewCard
              title="System Dampener"
              value={metaRegimeGovernor ? metaRegimeGovernor.systemDampener.toFixed(2) : "--"}
              detail="backend overlay amount"
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Governor State
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em]">
                  <span
                    className={`rounded-full border px-2 py-1 ${tradePermissionClasses(
                      metaRegimeGovernor?.tradePermission
                    )}`}
                  >
                    {metaRegimeGovernor?.tradePermission ?? "WAITING"}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-1 ${marketModeClasses(
                      metaRegimeGovernor?.marketMode
                    )}`}
                  >
                    {metaRegimeGovernor?.marketMode ?? "WAITING"}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-1 ${overrideModeClasses(
                      metaRegimeGovernor?.overrideMode
                    )}`}
                  >
                    {metaRegimeGovernor?.overrideMode ?? "WAITING"}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <Stat
                  label="Lead Bias"
                  value={metaRegimeGovernor?.diagnostics.leadRegimeBias ?? "--"}
                />
                <Stat
                  label="Effective Bias"
                  value={metaRegimeGovernor?.diagnostics.effectiveRegimeBias ?? "--"}
                />
                <Stat
                  label="Execution Mult"
                  value={metaRegimeGovernor ? metaRegimeGovernor.overlayMultiplier.toFixed(2) : "--"}
                />
                <Stat
                  label="Signal SHS"
                  value={
                    metaRegimeGovernor
                      ? metaRegimeGovernor.diagnostics.signalHealthScore.toFixed(1)
                      : "--"
                  }
                />
                <Stat
                  label="Conflict"
                  value={
                    metaRegimeGovernor
                      ? metaRegimeGovernor.diagnostics.conflictIndex.toFixed(2)
                      : "--"
                  }
                />
                <Stat
                  label="Liq Stress"
                  value={
                    metaRegimeGovernor
                      ? metaRegimeGovernor.diagnostics.liquidationStress.toFixed(1)
                      : "--"
                  }
                />
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Dampened Overlay Preview
                </div>
                <div className="text-xs text-slate-500">
                  execution + allocation
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {metaRegimeGovernor ? (
                  metaRegimeGovernor.overlays.execution.slice(0, 4).map((item) => {
                    const allocationOverlay =
                      metaRegimeGovernor.overlays.allocation.find(
                        (overlay) => overlay.symbol === item.symbol
                      ) ?? null;

                    return (
                      <div
                        key={`meta-governor-overlay-${item.symbol}`}
                        className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-slate-100">
                            {formatPairLabel(item.symbol)}
                          </div>
                          <span className="text-xs text-slate-300">
                            {item.tier.replace("_", " ")}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <Stat
                            label="Exec"
                            value={`${item.executionScore.toFixed(2)} -> ${item.dampenedExecutionScore.toFixed(2)}`}
                          />
                          <Stat
                            label="Size Mult"
                            value={`${item.suggestedSizeMultiplier.toFixed(2)} -> ${item.dampenedSuggestedSizeMultiplier.toFixed(2)}`}
                          />
                          <Stat
                            label="Weight"
                            value={
                              allocationOverlay
                                ? `${(allocationOverlay.weight * 100).toFixed(1)}% -> ${(allocationOverlay.dampenedWeight * 100).toFixed(1)}%`
                                : "--"
                            }
                          />
                          <Stat
                            label="Alloc Size"
                            value={
                              allocationOverlay
                                ? `${(allocationOverlay.suggestedSize * 100).toFixed(1)}% -> ${(allocationOverlay.dampenedSuggestedSize * 100).toFixed(1)}%`
                                : "--"
                            }
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">
                    Waiting for meta regime governor snapshot.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const positionRiskOrchestratorPanel = visibleSections.positionRiskOrchestrator ? (
    <div
      id="position-risk-orchestrator"
      {...dashboardPanelDropProps("positionRiskOrchestrator")}
      className="swipe-page order-[71] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("positionRiskOrchestrator")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Position Risk Orchestrator
          </h2>
          <span className="text-xs text-slate-500">
            backend position capacity + account gates
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("positionRiskOrchestrator")}
          <PanelToggleButton
            collapsed={collapsedSections.positionRiskOrchestrator}
            onClick={() => toggleSection("positionRiskOrchestrator")}
          />
        </div>
      </div>

      {!collapsedSections.positionRiskOrchestrator ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="Account Risk Load"
              value={
                positionRiskOrchestrator
                  ? `${positionRiskOrchestrator.accountRiskLoad.toFixed(1)}%`
                  : "—"
              }
              detail="backend account load"
            />
            <OverviewCard
              title="Risk Budget Left"
              value={
                positionRiskOrchestrator
                  ? `${positionRiskOrchestrator.riskBudgetLeft.toFixed(1)}%`
                  : "—"
              }
              detail="remaining capacity"
            />
            <OverviewCard
              title="Kill Switch State"
              value={positionRiskOrchestrator?.killSwitchState ?? "—"}
              detail="global position gate"
            />
            <OverviewCard
              title="Safe To Add Position"
              value={
                positionRiskOrchestrator
                  ? positionRiskOrchestrator.safeToAddPosition
                    ? "YES"
                    : "NO"
                  : "—"
              }
              detail="backend decision"
            />
            <div className="min-w-0 rounded-lg border border-caution/25 bg-caution/10 p-3 shadow-panel">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-caution">
                Advisory Signal
              </div>
              <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-300">
                Not Order Authorization
              </div>
            </div>
            <OverviewCard
              title="Global Risk Multiplier"
              value={
                positionRiskOrchestrator
                  ? positionRiskOrchestrator.globalRiskMultiplier.toFixed(2)
                  : "—"
              }
              detail="size overlay"
            />
          </div>

          <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]">
            <span
              className={`rounded-full border px-2.5 py-1 ${positionRiskKillSwitchClasses(
                positionRiskOrchestrator?.killSwitchState
              )}`}
            >
              {positionRiskOrchestrator?.killSwitchState ?? "WAITING"}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 ${positionRiskSafeClasses(
                positionRiskOrchestrator?.safeToAddPosition
              )}`}
            >
              safe to add {positionRiskOrchestrator?.safeToAddPosition === true ? "YES" : positionRiskOrchestrator?.safeToAddPosition === false ? "NO" : "—"}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 ${positionRiskStressClasses(
                positionRiskOrchestrator?.marginStress.stressLevel
              )}`}
            >
              margin {positionRiskOrchestrator?.marginStress.stressLevel ?? "—"}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 ${positionRiskStressClasses(
                positionRiskOrchestrator?.liquidationStress.stressLevel
              )}`}
            >
              liquidation {positionRiskOrchestrator?.liquidationStress.stressLevel ?? "—"}
            </span>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Margin Stress
                </div>
                <div
                  className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${positionRiskStressClasses(
                    positionRiskOrchestrator?.marginStress.stressLevel
                  )}`}
                >
                  {positionRiskOrchestrator?.marginStress.stressLevel ?? "—"}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Stat
                  label="Margin Usage"
                  value={formatPositionRiskPercent(
                    positionRiskOrchestrator?.marginStress.marginUsagePct
                  )}
                />
                <Stat
                  label="Maintenance Ratio"
                  value={
                    positionRiskOrchestrator
                      ? positionRiskOrchestrator.marginStress.maintenanceMarginRatio.toFixed(2)
                      : "—"
                  }
                />
                <Stat
                  label="Available Balance"
                  value={formatPositionRiskPercent(
                    positionRiskOrchestrator?.marginStress.availableBalancePct
                  )}
                />
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Liquidation Stress
                </div>
                <div
                  className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${positionRiskStressClasses(
                    positionRiskOrchestrator?.liquidationStress.stressLevel
                  )}`}
                >
                  {positionRiskOrchestrator?.liquidationStress.stressLevel ?? "—"}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <Stat
                  label="Min Distance"
                  value={formatPositionRiskPercent(
                    positionRiskOrchestrator?.liquidationStress.minDistancePct
                  )}
                />
                <Stat
                  label="Avg Distance"
                  value={formatPositionRiskPercent(
                    positionRiskOrchestrator?.liquidationStress.avgDistancePct
                  )}
                />
                <Stat
                  label="Critical"
                  value={
                    positionRiskOrchestrator
                      ? String(positionRiskOrchestrator.liquidationStress.criticalPositions)
                      : "—"
                  }
                />
                <Stat
                  label="Warning"
                  value={
                    positionRiskOrchestrator
                      ? String(positionRiskOrchestrator.liquidationStress.warningPositions)
                      : "—"
                  }
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Position Capacity
              </div>
              <div className="text-xs text-slate-500">
                {positionRiskOrchestrator?.positionCapacity.length ?? 0} backend rows
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              {positionRiskOrchestrator?.positionCapacity.length ? (
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-slate-400">
                    <tr>
                      <HeaderCell>Symbol</HeaderCell>
                      <HeaderCell>Bias</HeaderCell>
                      <HeaderCell>Capacity Score</HeaderCell>
                      <HeaderCell>Size Multiplier</HeaderCell>
                      <HeaderCell>Safe To Add</HeaderCell>
                      <HeaderCell>Reason</HeaderCell>
                      <HeaderCell>Constraints</HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {positionRiskOrchestrator.positionCapacity.map((item) => (
                      <tr key={`position-risk-capacity-${item.symbol}`} className="border-t border-white/5">
                        <Cell>
                          <span className="font-medium text-slate-100">
                            {formatPairLabel(item.symbol)}
                          </span>
                        </Cell>
                        <Cell>
                          <span
                            className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${regimeBiasClasses(
                              item.bias
                            )}`}
                          >
                            {item.bias}
                          </span>
                        </Cell>
                        <Cell>{item.capacityScore.toFixed(2)}</Cell>
                        <Cell>{item.recommendedSizeMultiplier.toFixed(2)}</Cell>
                        <Cell>
                          <span
                            className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${positionRiskSafeClasses(
                              item.safeToAdd
                            )}`}
                          >
                            {item.safeToAdd ? "YES" : "NO"}
                          </span>
                        </Cell>
                        <Cell>{item.reason || "—"}</Cell>
                        <Cell>
                          <div className="flex flex-wrap gap-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                            <span>acct {item.constraints.accountRisk.toFixed(1)}</span>
                            <span>margin {item.constraints.marginStress.toFixed(1)}</span>
                            <span>liq {item.constraints.liquidationStress.toFixed(1)}</span>
                            <span>conflict {item.constraints.conflictPenalty.toFixed(1)}</span>
                            <span>governor {item.constraints.governorPenalty.toFixed(1)}</span>
                          </div>
                        </Cell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500">
                  Waiting for position risk orchestrator snapshot.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const regimeMemoryPanel = visibleSections.regimeMemory ? (
    <div
      id="regime-memory"
      {...dashboardPanelDropProps("regimeMemory")}
      className="swipe-page order-[71] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("regimeMemory")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Regime Memory
          </h2>
          <span className="text-xs text-slate-500">
            temporal continuity + repeated structure detection
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("regimeMemory")}
          <PanelToggleButton
            collapsed={collapsedSections.regimeMemory}
            onClick={() => toggleSection("regimeMemory")}
          />
        </div>
      </div>

      {!collapsedSections.regimeMemory ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="Continuity"
              value={regimeMemory?.continuityState ?? "--"}
              detail={regimeMemory?.symbol ?? "waiting"}
            />
            <OverviewCard
              title="RRS"
              value={regimeMemory ? regimeMemory.rrs.toFixed(2) : "--"}
              detail="repetition score"
            />
            <OverviewCard
              title="RDI"
              value={regimeMemory ? regimeMemory.rdi.toFixed(2) : "--"}
              detail="drift index"
            />
            <OverviewCard
              title="Memory Confidence"
              value={regimeMemory ? `${(regimeMemory.memoryConfidence * 100).toFixed(0)}%` : "--"}
              detail={regimeMemory?.marketState ?? "waiting"}
            />
            <OverviewCard
              title="System Context"
              value={regimeMemory?.marketMode ?? "--"}
              detail={regimeMemory?.tradePermission ?? "waiting"}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Top Regime Echoes
                </div>
                <div
                  className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${continuityStateClasses(
                    regimeMemory?.continuityState
                  )}`}
                >
                  {regimeMemory?.continuityState ?? "WAITING"}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {regimeMemory?.topRegimeEchoes.length ? (
                  regimeMemory.topRegimeEchoes.map((echo, index) => (
                    <div
                      key={`regime-echo-${echo.timestamp}-${index}`}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-slate-100">
                          {formatClock(echo.timestamp)}
                        </div>
                        <div className="text-xs text-slate-300">
                          {(echo.similarity * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${marketStateClasses(
                            echo.marketState
                          )}`}
                        >
                          {echo.marketState.replace("_", " ")}
                        </span>
                        <span className="text-xs text-slate-500">echo #{index + 1}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Waiting for enough history to detect echoes.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Symbol Continuity
                </div>
                <div className="text-xs text-slate-500">
                  {regimeMemory?.symbols.length ?? 0} ranked symbols
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {regimeMemory?.symbols.length ? (
                  regimeMemory.symbols.slice(0, 6).map((item) => (
                    <div
                      key={`regime-memory-${item.symbol}`}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-100">
                          {formatPairLabel(item.symbol)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${continuityStateClasses(
                              item.continuityState
                            )}`}
                          >
                            {item.continuityState.replace("_", " ")}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${marketStateClasses(
                              item.marketState
                            )}`}
                          >
                            {item.marketState.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        <Stat label="RRS" value={item.rrs.toFixed(2)} />
                        <Stat label="RDI" value={item.rdi.toFixed(2)} />
                        <Stat
                          label="Mem Conf"
                          value={`${(item.memoryConfidence * 100).toFixed(0)}%`}
                        />
                        <Stat
                          label="Learning"
                          value={`${(item.learningConfidence * 100).toFixed(0)}%`}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Waiting for regime memory ranking.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const regimePredictionPanel = visibleSections.regimePrediction ? (
    <div
      id="regime-prediction"
      {...dashboardPanelDropProps("regimePrediction")}
      className="swipe-page order-[72] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("regimePrediction")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Regime Prediction
          </h2>
          <span className="text-xs text-slate-500">
            next-state projection + transition probability map
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("regimePrediction")}
          <PanelToggleButton
            collapsed={collapsedSections.regimePrediction}
            onClick={() => toggleSection("regimePrediction")}
          />
        </div>
      </div>

      {!collapsedSections.regimePrediction ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="Predicted Regime"
              value={regimePrediction?.predictedRegime ?? "--"}
              detail={regimePrediction?.symbol ?? "waiting"}
            />
            <OverviewCard
              title="RTR"
              value={regimePrediction ? regimePrediction.rtr.toFixed(2) : "--"}
              detail="transition risk"
            />
            <OverviewCard
              title="Stability Horizon"
              value={
                regimePrediction
                  ? `${regimePrediction.stabilityHorizon.candles} candles`
                  : "--"
              }
              detail={regimePrediction?.stabilityHorizon.bucket ?? "waiting"}
            />
            <OverviewCard
              title="Forecast Bias"
              value={regimePrediction?.forecastBias ?? "--"}
              detail={regimePrediction?.currentRegime ?? "waiting"}
            />
            <OverviewCard
              title="Confidence"
              value={
                regimePrediction
                  ? `${(regimePrediction.predictionConfidence * 100).toFixed(0)}%`
                  : "--"
              }
              detail="projection confidence"
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Transition Probabilities
                </div>
                <div
                  className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${marketStateClasses(
                    regimePrediction?.predictedRegime
                  )}`}
                >
                  {regimePrediction?.predictedRegime ?? "WAITING"}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(
                  [
                    "STABLE_TREND",
                    "TRANSITIONAL",
                    "CHOP",
                    "DISORDER"
                  ] as const
                ).map((mode) => {
                  const probability = regimePrediction?.transitionProbabilities[mode] ?? null;

                  return (
                    <div
                      key={`regime-probability-${mode}`}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${marketStateClasses(
                            mode
                          )}`}
                        >
                          {mode.replaceAll("_", " ")}
                        </span>
                        <span className="text-sm font-medium text-slate-100">
                          {probability === null ? "--" : `${(probability * 100).toFixed(0)}%`}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.max((probability ?? 0) * 100, 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Projection Readout
                </div>
                <div className="text-xs text-slate-500">
                  deterministic snapshot inference
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    Current Regime
                  </div>
                  <div className="mt-2">
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${marketStateClasses(
                        regimePrediction?.currentRegime
                      )}`}
                    >
                      {regimePrediction?.currentRegime ?? "WAITING"}
                    </span>
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    Forecast Bias
                  </div>
                  <div className="mt-2">
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${forecastBiasClasses(
                        regimePrediction?.forecastBias
                      )}`}
                    >
                      {regimePrediction?.forecastBias ?? "WAITING"}
                    </span>
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    Stability Bucket
                  </div>
                  <div className="mt-2">
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${stabilityHorizonClasses(
                        regimePrediction?.stabilityHorizon.bucket
                      )}`}
                    >
                      {regimePrediction?.stabilityHorizon.bucket ?? "WAITING"}
                    </span>
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    Prediction Confidence
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-100">
                    {regimePrediction
                      ? `${(regimePrediction.predictionConfidence * 100).toFixed(0)}%`
                      : "--"}
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">RTR</div>
                  <div className="mt-2 text-sm font-medium text-slate-100">
                    {regimePrediction ? regimePrediction.rtr.toFixed(2) : "--"}
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    Projected Horizon
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-100">
                    {regimePrediction
                      ? `${regimePrediction.stabilityHorizon.candles} candles`
                      : "--"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const regimeFeedbackCalibrationPanel = visibleSections.regimeFeedbackCalibration ? (
    <div
      id="regime-feedback-calibration"
      {...dashboardPanelDropProps("regimeFeedbackCalibration")}
      className="swipe-page order-[73] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("regimeFeedbackCalibration")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Regime Feedback Calibration
          </h2>
          <span className="text-xs text-slate-500">
            post-hoc ground truth validation for prediction quality
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("regimeFeedbackCalibration")}
          <PanelToggleButton
            collapsed={collapsedSections.regimeFeedbackCalibration}
            onClick={() => toggleSection("regimeFeedbackCalibration")}
          />
        </div>
      </div>

      {!collapsedSections.regimeFeedbackCalibration ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="Calibration Symbol"
              value={regimeFeedbackCalibration?.symbol ?? "--"}
              detail="validation target"
            />
            <OverviewCard
              title="PHR 15m"
              value={
                regimeFeedbackCalibration
                  ? `${(regimeFeedbackCalibration.phr["15m"] * 100).toFixed(0)}%`
                  : "--"
              }
              detail="prediction hit rate"
            />
            <OverviewCard
              title="DA 15m"
              value={
                regimeFeedbackCalibration
                  ? `${(regimeFeedbackCalibration.directionalAccuracy["15m"] * 100).toFixed(0)}%`
                  : "--"
              }
              detail="directional accuracy"
            />
            <OverviewCard
              title="Stability Score"
              value={
                regimeFeedbackCalibration
                  ? `${(regimeFeedbackCalibration.stabilityScore * 100).toFixed(0)}%`
                  : "--"
              }
              detail="prediction flip resistance"
            />
            <OverviewCard
              title="Calibration Error"
              value={
                regimeFeedbackCalibration
                  ? regimeFeedbackCalibration.calibrationError.toFixed(2)
                  : "--"
              }
              detail="confidence mismatch"
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Window Metrics
                </div>
                <div className="text-xs text-slate-500">5m / 15m / 1h outcome validation</div>
              </div>
              <div className="mt-3 space-y-2">
                {(
                  [
                    { key: "5m", label: "5m" },
                    { key: "15m", label: "15m" },
                    { key: "1h", label: "1h" }
                  ] as const
                ).map((window) => (
                  <div
                    key={`feedback-window-${window.key}`}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-100">{window.label}</div>
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                        realized window
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div
                        className={`rounded-md border px-3 py-2 ${calibrationRateClasses(
                          regimeFeedbackCalibration?.phr[window.key]
                        )}`}
                      >
                        <div className="text-[11px] uppercase tracking-[0.16em]">PHR</div>
                        <div className="mt-2 text-sm font-medium">
                          {regimeFeedbackCalibration
                            ? `${(regimeFeedbackCalibration.phr[window.key] * 100).toFixed(0)}%`
                            : "--"}
                        </div>
                      </div>
                      <div
                        className={`rounded-md border px-3 py-2 ${calibrationRateClasses(
                          regimeFeedbackCalibration?.directionalAccuracy[window.key]
                        )}`}
                      >
                        <div className="text-[11px] uppercase tracking-[0.16em]">Directional Accuracy</div>
                        <div className="mt-2 text-sm font-medium">
                          {regimeFeedbackCalibration
                            ? `${(regimeFeedbackCalibration.directionalAccuracy[window.key] * 100).toFixed(0)}%`
                            : "--"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Realized Bias Distribution
                  </div>
                  <div
                    className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${calibrationErrorClasses(
                      regimeFeedbackCalibration?.calibrationError
                    )}`}
                  >
                    CE {regimeFeedbackCalibration?.calibrationError.toFixed(2) ?? "--"}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(["LONG", "SHORT", "NEUTRAL"] as const).map((bias) => (
                    <div
                      key={`realized-bias-${bias}`}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${regimeBiasClasses(
                            bias
                          )}`}
                        >
                          {bias}
                        </span>
                        <span className="text-sm font-medium text-slate-100">
                          {regimeFeedbackCalibration
                            ? `${(regimeFeedbackCalibration.realizedBiasDistribution[bias] * 100).toFixed(0)}%`
                            : "--"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div
                    className={`rounded-md border px-3 py-2 ${calibrationRateClasses(
                      regimeFeedbackCalibration?.stabilityScore
                    )}`}
                  >
                    <div className="text-[11px] uppercase tracking-[0.16em]">Stability Score</div>
                    <div className="mt-2 text-sm font-medium">
                      {regimeFeedbackCalibration
                        ? `${(regimeFeedbackCalibration.stabilityScore * 100).toFixed(0)}%`
                        : "--"}
                    </div>
                  </div>
                  <div
                    className={`rounded-md border px-3 py-2 ${calibrationErrorClasses(
                      regimeFeedbackCalibration?.calibrationError
                    )}`}
                  >
                    <div className="text-[11px] uppercase tracking-[0.16em]">Calibration Error</div>
                    <div className="mt-2 text-sm font-medium">
                      {regimeFeedbackCalibration
                        ? regimeFeedbackCalibration.calibrationError.toFixed(2)
                        : "--"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Suggested Adjustments
                  </div>
                  <div className="text-xs text-slate-500">read-only overlay</div>
                </div>
                <div className="mt-3 space-y-2">
                  {(
                    [
                      ["Regime Weight", regimeFeedbackCalibration?.calibrationAdjustment.regimeWeightAdjustment],
                      ["Confidence", regimeFeedbackCalibration?.calibrationAdjustment.confidenceAdjustment],
                      ["Flow Weight Bias", regimeFeedbackCalibration?.calibrationAdjustment.flowWeightBias],
                      [
                        "Risk Penalty",
                        regimeFeedbackCalibration?.calibrationAdjustment.riskPenaltyAdjustment
                      ]
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={`calibration-adjustment-${label}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="text-sm text-slate-300">{label}</div>
                      <div className={`text-sm font-medium ${adjustmentValueClasses(value)}`}>
                        {typeof value === "number"
                          ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
                          : "--"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const pnlAttributionPanel = visibleSections.pnlAttribution ? (
    <div
      id="pnl-attribution"
      {...dashboardPanelDropProps("pnlAttribution")}
      className="swipe-page order-[71] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("pnlAttribution")}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            PnL Attribution
          </h2>
          <span className="text-xs text-slate-500">
            momentum + flow + funding + residual
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("pnlAttribution")}
          <PanelToggleButton
            collapsed={collapsedSections.pnlAttribution}
            onClick={() => toggleSection("pnlAttribution")}
          />
        </div>
      </div>

      {!collapsedSections.pnlAttribution ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="Realized"
              value={formatSignedUsdMetric(portfolioPrimaryAnalytics?.pnl.realized)}
              detail="closed positions"
            />
            <OverviewCard
              title="Unrealized"
              value={formatSignedUsdMetric(portfolioPrimaryAnalytics?.pnl.unrealized)}
              detail="mark-to-market"
            />
            <OverviewCard
              title="Funding"
              value={formatSignedUsdMetric(portfolioPrimaryAnalytics?.pnl.funding)}
              detail="accumulated payments"
            />
            <OverviewCard
              title="Fees"
              value={formatSignedUsdMetric(portfolioPrimaryAnalytics?.pnl.fees)}
              detail="trading costs"
            />
            <OverviewCard
              title="Net PnL"
              value={formatSignedUsdMetric(portfolioPrimaryAnalytics?.pnl.net)}
              detail="portfolio primary"
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Portfolio PnL By Symbol
            </div>
            <div className="mt-3 space-y-2">
              {portfolioSymbolAnalytics.length ? (
                portfolioSymbolAnalytics.map(([symbol, analytics]) => (
                  <div
                    key={`portfolio-pnl-${symbol}`}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-slate-100">{formatPairLabel(symbol)}</div>
                      <div className="text-xs text-slate-400">
                        net {formatSignedUsdMetric(analytics.pnl.net)}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      <Stat
                        label="VaR 95"
                        value={formatUsdMetric(analytics.var.var95)}
                      />
                      <Stat
                        label="ES 95"
                        value={formatUsdMetric(analytics.expectedShortfall.es95)}
                      />
                      <Stat
                        label="uPnL"
                        value={formatSignedUsdMetric(analytics.pnl.unrealized)}
                      />
                      <Stat
                        label="Net"
                        value={formatSignedUsdMetric(analytics.pnl.net)}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Waiting for portfolio analytics from backend.</p>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OverviewCard
              title="Momentum"
              value={riskFrame ? riskFrame.pnlAttribution.momentumContribution.toFixed(1) : "--"}
              detail="aggregate contribution"
            />
            <OverviewCard
              title="Flow"
              value={riskFrame ? riskFrame.pnlAttribution.flowContribution.toFixed(1) : "--"}
              detail="volume + liquidation"
            />
            <OverviewCard
              title="Funding"
              value={riskFrame ? riskFrame.pnlAttribution.fundingCarry.toFixed(1) : "--"}
              detail="carry impact"
            />
            <OverviewCard
              title="Residual"
              value={riskFrame ? riskFrame.pnlAttribution.residual.toFixed(1) : "--"}
              detail="unexplained remainder"
            />
            <OverviewCard
              title="Total"
              value={riskFrame ? riskFrame.pnlAttribution.total.toFixed(1) : "--"}
              detail="combined attribution"
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Symbol Attribution
            </div>
            <div className="mt-3 space-y-2">
              {pnlLeaders.length ? (
                pnlLeaders.map((row) => (
                  <div
                    key={`pnl-${row.symbol}`}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-slate-100">{formatPairLabel(row.symbol)}</div>
                      <div className="text-xs text-slate-400">
                        total {row.risk.pnlAttribution.total.toFixed(1)}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      <Stat
                        label="Momentum"
                        value={row.risk.pnlAttribution.momentumContribution.toFixed(1)}
                      />
                      <Stat
                        label="Flow"
                        value={row.risk.pnlAttribution.flowContribution.toFixed(1)}
                      />
                      <Stat
                        label="Funding"
                        value={row.risk.pnlAttribution.fundingCarry.toFixed(1)}
                      />
                      <Stat
                        label="Residual"
                        value={row.risk.pnlAttribution.residual.toFixed(1)}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Waiting for attribution rows from backend.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  const signalTapePanel = visibleSections.alerts ? (
    <div
      id="alerts"
      {...dashboardPanelDropProps("alerts")}
      className="swipe-page order-[10] rounded-lg border border-white/10 bg-panel p-3 shadow-panel"
    >
      {renderDashboardResizeFrame("alerts")}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
            Signal Tape
          </h2>
          <span className="text-[11px] text-slate-500">
            {frame?.alerts?.length ?? 0} recent alerts
          </span>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("alerts")}
          <PanelToggleButton
            collapsed={collapsedSections.alerts}
            onClick={() => toggleSection("alerts")}
          />
        </div>
      </div>

      {!collapsedSections.alerts ? (
        <div className="scrollbar-thin mt-2 max-h-[360px] space-y-1.5 overflow-y-auto">
          {frame?.alerts?.length ? (
            frame.alerts.map((alert) => (
              <button
                key={alert.id}
                type="button"
                onClick={() => void handleAlertClick(alert)}
                title={`Copy ${alert.symbol}`}
                className={`rounded-md border px-2.5 py-2 text-xs ${
                  alert.severity === "critical"
                    ? "border-negative/35 bg-negative/10"
                    : alert.severity === "high"
                      ? "border-caution/35 bg-caution/10"
                      : "border-white/10 bg-white/5"
                } w-full text-left transition hover:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/40`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-100">{alert.symbol}</div>
                  <div className="flex items-center gap-2">
                    {alert.alertPriority ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${alertPriorityClasses(
                          alert.alertPriority
                        )}`}
                      >
                        {alert.alertPriority}
                      </span>
                    ) : null}
                    <div className="text-[11px] text-slate-400">
                      {formatClock(alert.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-slate-300">{alert.reason}</div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  <span>
                    {alert.bias} | {compactUsd(alert.notionalUsd)}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {copiedAlertId === alert.id ? "copied" : "click to copy"}
                  </span>
                </div>
              </button>
            ))
          ) : (
            <p className="text-xs text-slate-500">No alerts yet.</p>
          )}
        </div>
      ) : null}
    </div>
  ) : null;

  const signalStatisticsPanel = visibleSections.signalStatistics ? (
    <div
      id="signal-statistics"
      {...dashboardPanelDropProps("signalStatistics")}
      className="swipe-page order-[72] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("signalStatistics")}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Signal Statistics
          </h2>
          <p className="text-xs text-slate-500">
            setup outcomes, opportunity verdicts and realized follow-through
          </p>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("signalStatistics")}
          <button
            type="button"
            onClick={() => requestSignalStatistics(signalStatisticsFilters, true)}
            className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-accent transition hover:border-accent/60 hover:text-white"
          >
            Refresh
          </button>
          <PanelToggleButton
            collapsed={collapsedSections.signalStatistics}
            onClick={() => toggleSection("signalStatistics")}
          />
        </div>
      </div>

      {!collapsedSections.signalStatistics ? (
        <SignalStatisticsPanel
          statistics={signalStatistics}
          updatedAt={signalStatisticsUpdatedAt}
          horizonSec={signalStatisticsHorizonSec}
          sinceMs={signalStatisticsSinceMs}
          limit={signalStatisticsLimit}
          onHorizonChange={setSignalStatisticsHorizonSec}
          onSinceChange={setSignalStatisticsSinceMs}
          onLimitChange={setSignalStatisticsLimit}
          onReplay={requestSignalReplay}
        />
      ) : null}
    </div>
  ) : null;

  const learningCenterPanel = visibleSections.learningCenter ? (
    <div
      id="learning-center"
      {...dashboardPanelDropProps("learningCenter")}
      className="swipe-page order-[73] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("learningCenter")}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Learning Center
          </h2>
          <p className="text-xs text-slate-500">
            backend self-check for setups, verdicts, priorities and journal PnL
          </p>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("learningCenter")}
          <button
            type="button"
            onClick={() => requestLearningData()}
            className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-accent transition hover:border-accent/60 hover:text-white"
          >
            Refresh
          </button>
          <PanelToggleButton
            collapsed={collapsedSections.learningCenter}
            onClick={() => toggleSection("learningCenter")}
          />
        </div>
      </div>

      {!collapsedSections.learningCenter ? (
        <LearningCenterPanel
          report={learningReport}
          loading={learningReportLoading}
          updatedAt={learningReportUpdatedAt}
        />
      ) : null}
    </div>
  ) : null;

  const tradeJournalPanel = visibleSections.tradeJournal ? (
    <div
      id="trade-journal"
      {...dashboardPanelDropProps("tradeJournal")}
      className="swipe-page order-[74] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
    >
      {renderDashboardResizeFrame("tradeJournal")}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Trade Journal
          </h2>
          <p className="text-xs text-slate-500">
            manual trades linked to stored signals
          </p>
        </div>
        <div className="flex items-center gap-2">
          {renderDashboardPanelHandles("tradeJournal")}
          <button
            type="button"
            onClick={() => openJournalCreateForm()}
            className="rounded-md border border-positive/30 bg-positive/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-positive transition hover:border-positive/60 hover:text-white"
          >
            New
          </button>
          <button
            type="button"
            onClick={() => requestJournalData(journalFilters)}
            className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-accent transition hover:border-accent/60 hover:text-white"
          >
            Refresh
          </button>
          <PanelToggleButton
            collapsed={collapsedSections.tradeJournal}
            onClick={() => toggleSection("tradeJournal")}
          />
        </div>
      </div>

      {!collapsedSections.tradeJournal ? (
        <TradeJournalPanel
          entries={journalEntries}
          analytics={journalAnalytics}
          analyticsLoading={journalAnalyticsLoading}
          analyticsUpdatedAt={journalAnalyticsUpdatedAt}
          loading={journalLoading}
          error={journalError}
          sinceMs={journalSinceMs}
          symbol={journalSymbolFilter}
          side={journalSideFilter}
          limit={journalLimit}
          onSinceChange={setJournalSinceMs}
          onSymbolChange={setJournalSymbolFilter}
          onSideChange={setJournalSideFilter}
          onLimitChange={setJournalLimit}
          notice={journalAutoNotice}
          onEdit={openJournalEditForm}
          onDelete={removeJournalEntry}
        />
      ) : null}
    </div>
  ) : null;

  const signalReplayModal =
    signalReplay || signalReplayLoading || signalReplayError ? (
      <SignalReplayModal
        replay={signalReplay}
        loading={signalReplayLoading}
        error={signalReplayError}
        onCreateJournalEntry={openJournalCreateForm}
        onClose={clearSignalReplay}
      />
    ) : null;

  const journalEntryModal =
    journalFormSeed || selectedJournalEntry ? (
      <JournalEntryModal
        seed={journalFormSeed}
        entry={selectedJournalEntry}
        error={journalError}
        onSubmit={submitJournalEntry}
        onClose={closeJournalForm}
      />
    ) : null;

  const signalBillboardLayer =
    !desktopSection && signalBillboard !== null && !getDesktopBridge() ? (
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[90] overflow-hidden"
        style={{
          height: `${computeSignalBillboardFrameHeightPx(signalBillboardPreferences, {
            referenceHeight: typeof window !== "undefined" ? Math.min(window.innerHeight, 1080) : 1080,
            minPx: 56,
            maxPx: 108
          })}px`
        }}
      >
        <SignalBillboardOverlay
          key={signalBillboard.id}
          symbol={signalBillboard.symbol}
          bias={signalBillboard.bias}
          severity={signalBillboard.severity}
          preferences={signalBillboardPreferences}
          className="absolute inset-0"
        />
      </div>
    ) : null;
  const criticalAlertLayer = activeCriticalAlert ? (
    <CriticalAlertOverlay
      alert={activeCriticalAlert}
      queuedCount={criticalAlertQueue.length}
      onClose={closeCriticalAlert}
      onOpenChart={openCriticalAlertChart}
    />
  ) : null;

  return (
    <main
      id="top"
      className={`h-screen overflow-hidden text-slate-100 ${
        desktopSection ? (moduleViewReady ? "bg-transparent" : "bg-transparent opacity-0") : "bg-shell"
      }`}
    >
      {signalBillboardLayer}
      {criticalAlertLayer}
      {signalReplayModal}
      {journalEntryModal}
      <div
        ref={dashboardWorkspaceRef}
        data-dashboard-layout-mode={isFreeDashboardLayout ? "free" : "grid"}
        style={dashboardSurfaceStyle}
        className="dashboard-swiper mx-auto flex h-screen w-full max-w-[1800px] snap-x snap-mandatory overflow-x-auto overflow-y-hidden bg-shell"
      >
        <SocialAuthPanel
          dragHandle={renderDashboardPanelHandles("socialAuth")}
          resizeFrame={renderDashboardResizeFrame("socialAuth")}
          panelProps={dashboardPanelDropProps("socialAuth")}
        />

        {visibleSections.overview ? (
          <section
            id="overview"
            {...dashboardPanelDropProps("overview")}
            className="swipe-page order-[30] rounded-lg border border-white/10 bg-panel p-3 shadow-panel"
          >
            {renderDashboardResizeFrame("overview")}
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                  Overview
                </h2>
                <p className="text-[11px] text-slate-500">market breadth snapshot</p>
              </div>
              <div className="flex items-center gap-2">
                {renderDashboardPanelHandles("overview")}
                <PanelToggleButton
                  collapsed={collapsedSections.overview}
                  onClick={() => toggleSection("overview")}
                />
              </div>
            </div>

            {!collapsedSections.overview ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
                <OverviewCard
                  title="Breadth"
                  value={
                    frame
                      ? `${frame.overview.advancingCount} / ${frame.overview.decliningCount}`
                      : "--"
                  }
                  detail="advancers / decliners"
                />
                <OverviewCard
                  title="Pulse"
                  value={frame ? frame.overview.marketPulse.toFixed(1) : "--"}
                  detail={frame?.overview.dominantRegime ?? "waiting"}
                />
                <OverviewCard
                  title="Top Long"
                  value={frame?.overview.topLongSymbol ?? "--"}
                  detail="highest long bias"
                />
                <OverviewCard
                  title="Top Short"
                  value={frame?.overview.topShortSymbol ?? "--"}
                  detail="highest short bias"
                />
                <OverviewCard
                  title="Hot Liquidations"
                  value={frame ? compactUsd(frame.overview.hotLiquidationsUsd) : "--"}
                  detail="recent 5m across leaders"
                />
                <OverviewCard
                  title="Unified Regime"
                  value={leadRegime?.bias ?? "--"}
                  detail={
                    leadRegime
                      ? `score ${leadRegime.finalScore.toFixed(2)} | conf ${(leadRegimeLearning?.confidence ?? leadRegime.confidence).toFixed(0)}%`
                      : "waiting"
                  }
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="contents">
          <div className="swipe-page order-[20] space-y-4">
            {visibleSections.filters ? (
              <div
                id="filters"
                {...dashboardPanelDropProps("filters")}
                className="rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
              >
                {renderDashboardResizeFrame("filters")}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                      Filters
                    </h2>
                    <p className="text-xs text-slate-500">
                      search, sort, universe and view options
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {renderDashboardPanelHandles("filters")}
                    <PanelToggleButton
                      collapsed={collapsedSections.filters}
                      onClick={() => toggleSection("filters")}
                    />
                  </div>
                </div>

                {!collapsedSections.filters ? (
                  <>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <label className="space-y-1 text-sm">
                        <span className="text-slate-400">Search</span>
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="BTC, ETH, SOL"
                          className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
                        />
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="text-slate-400">Min 24h Quote Volume</span>
                        <input
                          type="number"
                          value={settings.minimumQuoteVolume}
                          onChange={(event) =>
                            setSettings({
                              minimumQuoteVolume: Math.max(Number(event.target.value) || 0, 0)
                            })
                          }
                          className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
                        />
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="text-slate-400">Sort By</span>
                        <select
                          value={settings.sortBy}
                          onChange={(event) =>
                            setSettings({
                              sortBy: event.target.value as typeof settings.sortBy
                            })
                          }
                          className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
                        >
                          <option value="score">Score</option>
                          <option value="momentum30sPct">30s Momentum</option>
                          <option value="momentum2mPct">2m Momentum</option>
                          <option value="volumeImpulse">Volume Impulse</option>
                          <option value="liquidation5m">Liquidations 5m</option>
                          <option value="quoteVolume24h">24h Quote Volume</option>
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="text-slate-400">Bias Filter</span>
                        <select
                          value={settings.biasFilter}
                          onChange={(event) =>
                            setSettings({
                              biasFilter: event.target.value as typeof settings.biasFilter
                            })
                          }
                          className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
                        >
                          <option value="ALL">All</option>
                          <option value="LONG">Long</option>
                          <option value="SHORT">Short</option>
                          <option value="NEUTRAL">Neutral</option>
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="text-slate-400">Focus Basket Size</span>
                        <input
                          type="number"
                          min={12}
                          max={90}
                          value={settings.focusUniverseSize}
                          onChange={(event) =>
                            setSettings({
                              focusUniverseSize: Math.min(
                                Math.max(Number(event.target.value) || 12, 12),
                                90
                              )
                            })
                          }
                          className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={settings.showOnlyWatchlist}
                          onChange={(event) =>
                            setSettings({
                              showOnlyWatchlist: event.target.checked
                            })
                          }
                          className="h-4 w-4 rounded border-white/20 bg-black/20"
                        />
                        Watchlist only
                      </label>
                      {frame ? (
                        <p className="text-xs text-slate-500">
                          frame {formatClock(frame.generatedAt)} | focus{" "}
                          {frame.status.focusSymbols.join(", ")}
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-100">
                            100M Volume Window
                          </h3>
                          <p className="mt-1 text-xs text-emerald-100/60">
                            Shows a separate window when any coin crosses the configured 24h
                            volume threshold above or below. These events do not go into Signal
                            Tape.
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-emerald-100">
                          <input
                            type="checkbox"
                            checked={settings.volumeMilestones.enabled}
                            onChange={(event) =>
                              setVolumeMilestoneSetting("enabled", event.target.checked)
                            }
                            className="h-4 w-4 rounded border-white/20 bg-black/20"
                          />
                          Enabled
                        </label>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">Min 24h Volume USDT</span>
                          <input
                            type="number"
                            value={settings.volumeMilestones.minQuoteVolume24h}
                            onChange={(event) =>
                              setVolumeMilestoneSetting(
                                "minQuoteVolume24h",
                                Math.max(Number(event.target.value) || 0, 0)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-emerald-300/60"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-red-300/20 bg-red-500/10 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-red-100">
                            Reviving Coin Critical Alert
                          </h3>
                          <p className="mt-1 text-xs text-red-100/60">
                            Detects coins that were quiet by liquidity or signal history and now
                            cross a high 24h volume threshold.
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-red-100">
                          <input
                            type="checkbox"
                            checked={settings.revivingCoins.enabled}
                            onChange={(event) =>
                              setRevivingCoinSetting("enabled", event.target.checked)
                            }
                            className="h-4 w-4 rounded border-white/20 bg-black/20"
                          />
                          Enabled
                        </label>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">Min 24h Volume USDT</span>
                          <input
                            type="number"
                            value={settings.revivingCoins.minCurrentQuoteVolume24h}
                            onChange={(event) =>
                              setRevivingCoinSetting(
                                "minCurrentQuoteVolume24h",
                                Math.max(Number(event.target.value) || 0, 0)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-red-300/60"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">Liquidity Lookback Days</span>
                          <input
                            type="number"
                            min={3}
                            max={120}
                            value={settings.revivingCoins.liquidityLookbackDays}
                            onChange={(event) =>
                              setRevivingCoinSetting(
                                "liquidityLookbackDays",
                                Math.max(Number(event.target.value) || 30, 3)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-red-300/60"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">Dead Avg Max USDT</span>
                          <input
                            type="number"
                            value={settings.revivingCoins.maxAverageDailyQuoteVolume}
                            onChange={(event) =>
                              setRevivingCoinSetting(
                                "maxAverageDailyQuoteVolume",
                                Math.max(Number(event.target.value) || 0, 0)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-red-300/60"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">No Signal Days</span>
                          <input
                            type="number"
                            min={1}
                            max={180}
                            value={settings.revivingCoins.noSignalLookbackDays}
                            onChange={(event) =>
                              setRevivingCoinSetting(
                                "noSignalLookbackDays",
                                Math.max(Number(event.target.value) || 30, 1)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-red-300/60"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">Scan Every Minutes</span>
                          <input
                            type="number"
                            min={1}
                            max={240}
                            value={settings.revivingCoins.scanIntervalMinutes}
                            onChange={(event) =>
                              setRevivingCoinSetting(
                                "scanIntervalMinutes",
                                Math.max(Number(event.target.value) || 5, 1)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-red-300/60"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">Alert Cooldown Hours</span>
                          <input
                            type="number"
                            min={1}
                            max={720}
                            value={settings.revivingCoins.alertCooldownHours}
                            onChange={(event) =>
                              setRevivingCoinSetting(
                                "alertCooldownHours",
                                Math.max(Number(event.target.value) || 24, 1)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-red-300/60"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-slate-400">Sound Repeat Seconds</span>
                          <input
                            type="number"
                            min={2}
                            max={120}
                            value={settings.revivingCoins.soundRepeatSeconds}
                            onChange={(event) =>
                              setRevivingCoinSetting(
                                "soundRepeatSeconds",
                                Math.max(Number(event.target.value) || 10, 2)
                              )
                            }
                            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-red-300/60"
                          />
                        </label>
                      </div>

                      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <ToggleRow
                          label="Use avg-volume criterion"
                          detail="Dead if average daily liquidity is below the configured limit"
                          checked={settings.revivingCoins.useAverageVolumeCriterion}
                          onChange={(checked) =>
                            setRevivingCoinSetting("useAverageVolumeCriterion", checked)
                          }
                        />
                        <ToggleRow
                          label="Use no-signal criterion"
                          detail="Dead if the symbol had no recent screener signals"
                          checked={settings.revivingCoins.useNoSignalCriterion}
                          onChange={(checked) =>
                            setRevivingCoinSetting("useNoSignalCriterion", checked)
                          }
                        />
                        <ToggleRow
                          label="Require all criteria"
                          detail="Off means either criterion is enough to mark the coin dead"
                          checked={settings.revivingCoins.requireAllDeadCriteria}
                          onChange={(checked) =>
                            setRevivingCoinSetting("requireAllDeadCriteria", checked)
                          }
                        />
                        <ToggleRow
                          label="Critical sound"
                          detail="Repeat the loud sound until this critical alert is closed"
                          checked={settings.revivingCoins.soundEnabled}
                          onChange={(checked) =>
                            setRevivingCoinSetting("soundEnabled", checked)
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {visibleSections.screener ? (
              <div
                id="screener"
                {...dashboardPanelDropProps("screener")}
                className="overflow-hidden rounded-lg border border-white/10 bg-panel shadow-panel"
              >
                {renderDashboardResizeFrame("screener")}
                <div
                  className={`flex items-center justify-between px-4 py-3 ${
                    collapsedSections.screener ? "" : "border-b border-white/10"
                  }`}
                >
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                      Darra Terminal
                    </h2>
                    <p className="text-xs text-slate-500">
                      {filteredRows.length} visible rows
                      {activeRowsCount ? ` | ${activeRowsCount} trade rows on top` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {renderDashboardPanelHandles("screener")}
                    <PanelToggleButton
                      collapsed={collapsedSections.screener}
                      onClick={() => toggleSection("screener")}
                    />
                  </div>
                </div>

                {!collapsedSections.screener ? (
                  <>
                  <div className="scrollbar-thin hidden overflow-x-auto overflow-y-auto lg:block">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-[#0f141b] text-xs uppercase tracking-[0.14em] text-slate-400">
                        <tr>
                          <HeaderCell>Symbol</HeaderCell>
                          <HeaderCell>Score</HeaderCell>
                          <HeaderCell>Bias</HeaderCell>
                          <HeaderCell>Price</HeaderCell>
                          <HeaderCell>30s</HeaderCell>
                          <HeaderCell>2m</HeaderCell>
                          <HeaderCell>24h</HeaderCell>
                          <HeaderCell>Impulse</HeaderCell>
                          <HeaderCell>Buy Ratio</HeaderCell>
                          <HeaderCell>Spread</HeaderCell>
                          <HeaderCell>Liq 5m</HeaderCell>
                          <HeaderCell>Funding</HeaderCell>
                          <HeaderCell>24h Quote Vol</HeaderCell>
                          <HeaderCell>Tags</HeaderCell>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((row) => (
                          <tr
                            key={row.symbol}
                            className={`border-t border-white/5 ${
                              row.isActiveTrade
                                ? "bg-caution/10"
                                : row.isWatchlist
                                  ? "bg-accent/5"
                                  : "bg-transparent"
                            }`}
                          >
                            <Cell>
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-slate-100">
                                  <span className="font-semibold">{row.symbol}</span>
                                  {row.isFocus ? (
                                    <span className="rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-positive">
                                      focus
                                    </span>
                                  ) : null}
                                  {row.isActiveTrade ? (
                                    <span className="rounded-full border border-caution/40 bg-caution/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-caution">
                                      active trade
                                    </span>
                                  ) : null}
                                  {accountPositionSet.has(row.symbol) ? (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                                      account
                                    </span>
                                  ) : null}
                                  {activeTradeSet.has(row.symbol) ? (
                                    <span className="rounded-full border border-caution/20 bg-caution/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-caution">
                                      manual
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]">
                                  <button
                                    type="button"
                                    onClick={() => toggleActiveTrade(row.symbol)}
                                    className={`rounded-full border px-2 py-1 transition ${
                                      activeTradeSet.has(row.symbol)
                                        ? "border-caution/40 bg-caution/10 text-caution"
                                        : "border-white/10 bg-white/5 text-slate-300 hover:border-caution/40 hover:text-caution"
                                    }`}
                                  >
                                    {activeTradeSet.has(row.symbol)
                                      ? "remove manual"
                                      : "pin manual"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleWatchlist(row.symbol)}
                                    className={`rounded-full border px-2 py-1 transition ${
                                      watchlistSet.has(row.symbol)
                                        ? "border-accent/40 bg-accent/10 text-accent"
                                        : "border-white/10 bg-white/5 text-slate-300 hover:border-accent/40 hover:text-accent"
                                    }`}
                                  >
                                    {watchlistSet.has(row.symbol) ? "unwatch" : "watch"}
                                  </button>
                                </div>
                              </div>
                            </Cell>
                            <Cell>
                              <span className={`font-semibold ${scoreColor(row.score)}`}>
                                {row.score.toFixed(1)}
                              </span>
                            </Cell>
                            <Cell>
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-medium ${
                                  row.bias === "LONG"
                                    ? "bg-positive/10 text-positive"
                                    : row.bias === "SHORT"
                                      ? "bg-negative/10 text-negative"
                                      : "bg-white/5 text-slate-300"
                                }`}
                              >
                                {row.bias}
                              </span>
                            </Cell>
                            <Cell>{formatPrice(row.lastPrice)}</Cell>
                            <Cell>
                              <span className={biasColor(row.momentum30sPct)}>
                                {formatPercent(row.momentum30sPct, 2)}
                              </span>
                            </Cell>
                            <Cell>
                              <span className={biasColor(row.momentum2mPct)}>
                                {formatPercent(row.momentum2mPct, 2)}
                              </span>
                            </Cell>
                            <Cell>
                              <span className={biasColor(row.change24hPct)}>
                                {formatPercent(row.change24hPct, 2)}
                              </span>
                            </Cell>
                            <Cell>{row.volumeImpulse.toFixed(2)}x</Cell>
                            <Cell>{(row.buyRatio60s * 100).toFixed(1)}%</Cell>
                            <Cell>
                              {row.spreadBps !== null ? `${row.spreadBps.toFixed(2)} bps` : "--"}
                            </Cell>
                            <Cell>{compactUsd(row.liquidation5m)}</Cell>
                            <Cell className={biasColor(row.fundingRate)}>
                              {formatPercent(row.fundingRate * 100, 3)}
                            </Cell>
                            <Cell>{compactUsd(row.quoteVolume24h)}</Cell>
                            <Cell>
                              <div className="flex flex-wrap gap-1">
                                {row.tags.slice(0, 4).map((tag) => (
                                  <span
                                    key={`${row.symbol}-${tag}`}
                                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${tagClass(
                                      tag
                                    )}`}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </Cell>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid gap-3 p-3 lg:hidden">
                    {filteredRows.length === 0 ? (
                      <p className="rounded-md border border-white/10 bg-black/20 px-3 py-4 text-sm text-slate-500">
                        No symbols match the current filters.
                      </p>
                    ) : (
                      filteredRows.map((row) => (
                        <MobileScreenerCard
                          key={row.symbol}
                          row={row}
                          activeTradeSet={activeTradeSet}
                          accountPositionSet={accountPositionSet}
                          watchlistSet={watchlistSet}
                          onToggleActiveTrade={toggleActiveTrade}
                          onToggleWatchlist={toggleWatchlist}
                        />
                      ))
                    )}
                  </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside className="contents">
            {volumeThresholdMilestonePanel}
            {volumeMilestonePanel}
            {signalTapePanel}
            {signalStatisticsPanel}
            {learningCenterPanel}
            {tradeJournalPanel}

            <div
              id="personal-cabinet"
              {...dashboardPanelDropProps("cabinet")}
              className="swipe-page order-[40] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
            >
              {renderDashboardResizeFrame("cabinet")}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Personal Cabinet
                  </h2>
                  <p className="text-xs text-slate-500">
                    watchlist, sound, alerts, hidden blocks and notes follow this profile
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {renderDashboardPanelHandles("cabinet")}
                  <button
                    type="button"
                    onClick={() => setCabinetOpen(true)}
                    className="rounded-md border border-[#f0b90b]/30 bg-[#f0b90b]/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-[#f0b90b]"
                  >
                    {cabinetSession.mode === "authenticated" ? "Manage" : "LOGIN"}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Profile
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-100">
                      {cabinetProfileLabel}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Handle
                    </div>
                    <div className="mt-1 text-sm text-slate-200">{cabinetHandleLabel}</div>
                  </div>
                </div>

                {cabinetMessage ? (
                  <div className="mt-3 text-xs text-slate-400">{cabinetMessage}</div>
                ) : null}
              </div>

              <div className="mt-4 space-y-2">
                <ToggleRow
                  label="Sound"
                  detail="Master switch for voice, chime and phone notifications"
                  checked={uiPreferences.soundEnabled}
                  onChange={(checked) => setSoundEnabled(checked)}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleRow
                    label="Signal animation"
                    detail="Animated flyover banner for fresh trade signals"
                    checked={uiPreferences.signalAnimationEnabled}
                    onChange={(checked) => setSignalAnimationEnabled(checked)}
                  />
                  <button
                    type="button"
                    onClick={() => previewSignalAnimation()}
                    disabled={!uiPreferences.signalAnimationEnabled}
                    className={`rounded-md border px-3 py-3 text-left transition ${
                      uiPreferences.signalAnimationEnabled
                        ? "border-caution/30 bg-caution/10 text-caution hover:border-caution/60"
                        : "border-white/10 bg-white/5 text-slate-500"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">Animation preview</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                          uiPreferences.signalAnimationEnabled
                            ? "animate-pulse bg-caution/20 text-caution"
                            : "bg-white/10 text-slate-500"
                        }`}
                      >
                        demo
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Launch a sample BTC signal flyover and verify the motion.
                    </div>
                  </button>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">
                        Signal overlay layout
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        AIMP-style top and bottom bands with separate size and transparency.
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                      height {signalBillboardPreferences.frameHeightPercent}% | top{" "}
                      {signalBillboardPreferences.topBandSize}% | bottom{" "}
                      {signalBillboardPreferences.bottomBandSize}%
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm text-slate-300 sm:col-span-2">
                      <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <span>Overlay height</span>
                        <span>{signalBillboardPreferences.frameHeightPercent}%</span>
                      </span>
                      <input
                        type="range"
                        min={signalBillboardFrameHeightRange.min}
                        max={signalBillboardFrameHeightRange.max}
                        step="1"
                        value={signalBillboardPreferences.frameHeightPercent}
                        onChange={(event) =>
                          setSignalBillboardPreference(
                            "frameHeightPercent",
                            Number(event.target.value)
                          )
                        }
                        className="mt-3 w-full accent-caution"
                      />
                    </label>

                    <label className="block text-sm text-slate-300">
                      <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <span>Top band size</span>
                        <span>{signalBillboardPreferences.topBandSize}%</span>
                      </span>
                      <input
                        type="range"
                        min={signalBillboardTopSizeRange.min}
                        max={signalBillboardTopSizeRange.max}
                        step="1"
                        value={signalBillboardPreferences.topBandSize}
                        onChange={(event) =>
                          setSignalBillboardPreference("topBandSize", Number(event.target.value))
                        }
                        className="mt-3 w-full accent-caution"
                      />
                    </label>

                    <label className="block text-sm text-slate-300">
                      <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <span>Bottom band size</span>
                        <span>{signalBillboardPreferences.bottomBandSize}%</span>
                      </span>
                      <input
                        type="range"
                        min={signalBillboardBottomSizeRange.min}
                        max={signalBillboardBottomSizeRange.max}
                        step="1"
                        value={signalBillboardPreferences.bottomBandSize}
                        onChange={(event) =>
                          setSignalBillboardPreference("bottomBandSize", Number(event.target.value))
                        }
                        className="mt-3 w-full accent-caution"
                      />
                    </label>

                    <label className="block text-sm text-slate-300">
                      <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <span>Top opacity</span>
                        <span>{signalBillboardPreferences.topBandOpacity}%</span>
                      </span>
                      <input
                        type="range"
                        min={signalBillboardOpacityRange.min}
                        max={signalBillboardOpacityRange.max}
                        step="1"
                        value={signalBillboardPreferences.topBandOpacity}
                        onChange={(event) =>
                          setSignalBillboardPreference("topBandOpacity", Number(event.target.value))
                        }
                        className="mt-3 w-full accent-caution"
                      />
                    </label>

                    <label className="block text-sm text-slate-300">
                      <span className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        <span>Bottom opacity</span>
                        <span>{signalBillboardPreferences.bottomBandOpacity}%</span>
                      </span>
                      <input
                        type="range"
                        min={signalBillboardOpacityRange.min}
                        max={signalBillboardOpacityRange.max}
                        step="1"
                        value={signalBillboardPreferences.bottomBandOpacity}
                        onChange={(event) =>
                          setSignalBillboardPreference(
                            "bottomBandOpacity",
                            Number(event.target.value)
                          )
                        }
                        className="mt-3 w-full accent-caution"
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">Голос</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Текущий профиль: {selectedVoiceProfile.label}. Провайдер:{" "}
                        {currentSpeechProviderId === "edge" ? "Edge Neural" : "System"}.
                        {currentSpeechProviderId === "edge"
                          ? selectedTtsModel
                            ? ` Модель: ${selectedTtsModel.label} (${selectedTtsModel.locale}).`
                            : suggestedTtsModel
                              ? ` Авто-модель: ${suggestedTtsModel.label}.`
                              : " Нейросетевая модель ещё загружается."
                          : currentVoiceProfileId === russianVoiceProfileId
                            ? selectedRussianSpeechVoice
                              ? ` Системный русский голос: ${selectedRussianSpeechVoice.name}.`
                              : " Русский голос сейчас в режиме авто-выбора."
                            : selectedSpeechVoice
                              ? ` Сохранённый системный голос: ${selectedSpeechVoice.name}.`
                              : " Тембр зависит от установленных системных голосов на устройстве."}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSpeechProviderSelect("edge")}
                        disabled={!uiPreferences.soundEnabled}
                        className={`rounded-md border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition ${
                          uiPreferences.soundEnabled
                            ? currentSpeechProviderId === "edge"
                              ? "border-positive/40 bg-positive/10 text-positive"
                              : "border-white/10 bg-white/5 text-slate-200 hover:border-positive/40 hover:text-white"
                            : "border-white/10 bg-white/5 text-slate-500"
                        }`}
                      >
                        Edge Neural
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSpeechProviderSelect("system")}
                        disabled={!uiPreferences.soundEnabled}
                        className={`rounded-md border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition ${
                          uiPreferences.soundEnabled
                            ? currentSpeechProviderId === "system"
                              ? "border-positive/40 bg-positive/10 text-positive"
                              : "border-white/10 bg-white/5 text-slate-200 hover:border-positive/40 hover:text-white"
                            : "border-white/10 bg-white/5 text-slate-500"
                        }`}
                      >
                        System
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          previewVoiceProfile(
                            currentVoiceProfileId,
                            selectedSpeechVoiceUriRef.current,
                            selectedTtsModelIdRef.current
                          )
                        }
                        disabled={!uiPreferences.soundEnabled}
                        className={`rounded-md border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition ${
                          uiPreferences.soundEnabled
                            ? "border-accent/40 bg-accent/10 text-accent hover:border-accent/60 hover:text-white"
                            : "border-white/10 bg-white/5 text-slate-500"
                        }`}
                      >
                        проверка
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {voiceProfilePresets.map((profile) => (
                      <VoiceProfileCard
                        key={profile.id}
                        profile={profile}
                        active={profile.id === currentVoiceProfileId}
                        onClick={() => handleVoiceProfileSelect(profile.id)}
                      />
                    ))}
                  </div>
                  {currentSpeechProviderId === "edge" ? (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-300">
                            Edge neural models
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Дополнительные облачные neural-голоса через backend. Для русского
                            профиля показываются только multilingual-модели.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleTtsModelSelect(null)}
                          disabled={!uiPreferences.soundEnabled || ttsModelsLoading}
                          className={`rounded-md border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition ${
                            uiPreferences.soundEnabled && !ttsModelsLoading
                              ? selectedTtsModelId === null ||
                                (suggestedTtsModel !== null &&
                                  selectedTtsModelId === suggestedTtsModel.id)
                                ? "border-positive/40 bg-positive/10 text-positive"
                                : "border-white/10 bg-white/5 text-slate-200 hover:border-positive/40 hover:text-white"
                              : "border-white/10 bg-white/5 text-slate-500"
                          }`}
                        >
                          auto best
                        </button>
                      </div>
                      {ttsModelsError ? (
                        <div className="mt-3 text-xs text-negative">{ttsModelsError}</div>
                      ) : ttsModelsLoading ? (
                        <div className="mt-3 text-xs text-slate-500">
                          Loading neural voice models...
                        </div>
                      ) : visibleTtsModels.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {visibleTtsModels.map((model) => {
                            const isActive = selectedTtsModelId === model.id;

                            return (
                              <button
                                key={model.id}
                                type="button"
                                onClick={() => handleTtsModelSelect(model.id)}
                                disabled={!uiPreferences.soundEnabled}
                                className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                                  uiPreferences.soundEnabled
                                    ? isActive
                                      ? "border-accent/50 bg-accent/10 text-white"
                                      : "border-white/10 bg-white/5 text-slate-200 hover:border-accent/35 hover:text-white"
                                    : "border-white/10 bg-white/5 text-slate-500"
                                }`}
                              >
                                <div className="font-medium">
                                  {model.label}
                                  {model.multilingual ? " · multilingual" : ""}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">
                                  {model.locale} · {model.gender}
                                </div>
                                <div className="mt-1 max-w-56 text-[11px] text-slate-500">
                                  {model.detail}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-3 text-xs text-slate-500">
                          Backend пока не вернул доступные neural-модели.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-300">
                            Русские системные голоса
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Выберите точный русский голос, установленный на этом устройстве. Так
                            синтез звучит заметно живее и менее роботизированно.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRussianVoiceSelect(null)}
                          disabled={!uiPreferences.soundEnabled}
                          className={`rounded-md border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition ${
                            uiPreferences.soundEnabled
                              ? currentVoiceProfileId === russianVoiceProfileId &&
                                selectedRussianSpeechVoice === null
                                ? "border-positive/40 bg-positive/10 text-positive"
                                : "border-white/10 bg-white/5 text-slate-200 hover:border-positive/40 hover:text-white"
                              : "border-white/10 bg-white/5 text-slate-500"
                          }`}
                        >
                          авто лучший
                        </button>
                      </div>
                      {availableRussianVoices.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {availableRussianVoices.map((voice) => {
                            const voiceId = getSpeechVoiceId(voice);
                            const isActive =
                              currentVoiceProfileId === russianVoiceProfileId &&
                              selectedRussianSpeechVoice !== null &&
                              getSpeechVoiceId(selectedRussianSpeechVoice) === voiceId;

                            return (
                              <button
                                key={voiceId}
                                type="button"
                                onClick={() => handleRussianVoiceSelect(voiceId)}
                                disabled={!uiPreferences.soundEnabled}
                                className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                                  uiPreferences.soundEnabled
                                    ? isActive
                                      ? "border-accent/50 bg-accent/10 text-white"
                                      : "border-white/10 bg-white/5 text-slate-200 hover:border-accent/35 hover:text-white"
                                    : "border-white/10 bg-white/5 text-slate-500"
                                }`}
                              >
                                <div className="font-medium">{voice.name}</div>
                                <div className="mt-1 text-[11px] text-slate-500">
                                  {voice.lang}
                                  {voice.localService ? " локальный" : " сетевой"}
                                  {voice.default ? " по умолчанию" : ""}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-3 text-xs text-slate-500">
                          На устройстве пока не найден ru-RU голос. Установите русский системный
                          голос и откройте приложение заново, чтобы получить более живую озвучку.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3">
                  <div className="text-sm font-medium text-slate-100">Android notifications</div>
                  <div className="mt-1 text-xs text-slate-500">{nativeNotificationStatus}</div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">Signal sound</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Current preset: {currentSignalSoundPreset.label}. Keep voice on, but swap
                        the chime style for incoming alerts.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => playSelectedSignalSound(currentSignalSoundId)}
                      disabled={!uiPreferences.soundEnabled || !uiPreferences.signalSoundEnabled}
                      className={`rounded-md border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] transition ${
                        uiPreferences.soundEnabled && uiPreferences.signalSoundEnabled
                          ? "border-accent/40 bg-accent/10 text-accent hover:border-accent/60 hover:text-white"
                          : "border-white/10 bg-white/5 text-slate-500"
                      }`}
                    >
                      preview
                    </button>
                  </div>
                  <div className="mt-3">
                    <ToggleRow
                      label="Signal chime"
                      detail="Dedicated alert sound before the spoken callout"
                      checked={uiPreferences.signalSoundEnabled}
                      onChange={(checked) => setSignalSoundEnabled(checked)}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {signalSoundPresets.map((preset) => {
                      const isActive = currentSignalSoundId === preset.id;

                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setSelectedSignalSoundId(preset.id);
                            playSelectedSignalSound(preset.id);
                          }}
                          disabled={!uiPreferences.soundEnabled}
                          className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                            uiPreferences.soundEnabled
                              ? isActive
                                ? "border-positive/40 bg-positive/10 text-white"
                                : "border-white/10 bg-white/5 text-slate-200 hover:border-positive/35 hover:text-white"
                              : "border-white/10 bg-white/5 text-slate-500"
                          }`}
                        >
                          <div className="font-medium">{preset.label}</div>
                          <div className="mt-1 text-[11px] text-slate-500">{preset.detail}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <ToggleRow
                  label="Trade alerts"
                  detail="Voice and phone notification for regular screener signals"
                  checked={notificationPreferences.tradeSignals}
                  onChange={(checked) => setNotificationPreference("tradeSignals", checked)}
                />
                <ToggleRow
                  label="Liquidations"
                  detail="Separate voice and phone notification control for liquidation alerts"
                  checked={notificationPreferences.liquidationSignals}
                  onChange={(checked) =>
                    setNotificationPreference("liquidationSignals", checked)
                  }
                />
                <ToggleRow
                  label="Feed recovery"
                  detail="Voice only when feeds recover. Disconnect speech is disabled."
                  checked={notificationPreferences.systemStatus}
                  onChange={(checked) => setNotificationPreference("systemStatus", checked)}
                />
                <ToggleRow
                  label="Pulse changes"
                  detail="Voice when regime shifts between risk-on and risk-off"
                  checked={notificationPreferences.pulseChanges}
                  onChange={(checked) => setNotificationPreference("pulseChanges", checked)}
                />
              </div>

              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Notes
                </div>
                <textarea
                  value={profileNotes}
                  onChange={(event) => setProfileNotes(event.target.value)}
                  placeholder="Important levels, plan, reminders, links"
                  className="mt-2 min-h-24 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-accent/60"
                />
              </div>

              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Visible Blocks
                </div>
                <div className="mt-2 space-y-2">
                  {sectionLabels.map((section) => (
                    <ToggleRow
                      key={section.id}
                      label={section.label}
                      detail="Show or hide this block on the dashboard"
                      checked={visibleSections[section.id]}
                      onChange={(checked) => setSectionVisibility(section.id, checked)}
                    />
                  ))}
                </div>
              </div>
              </div>

            {visibleSections.account ? (
              <div
                id="account"
                {...dashboardPanelDropProps("account")}
                className="swipe-page order-[50] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
              >
              {renderDashboardResizeFrame("account")}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Binance Account
                  </h2>
                  <span className="text-xs text-slate-500">
                    connect runtime account sync without touching local storage
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {renderDashboardPanelHandles("account")}
                  <PanelToggleButton
                    collapsed={collapsedSections.account}
                    onClick={() => toggleSection("account")}
                  />
                </div>
              </div>

              {!collapsedSections.account ? (
                <>
                  <p className="mt-3 text-xs text-slate-500">
                    Keys stay only in the local backend process for this run. They are not written
                    to IndexedDB or browser local storage.
                  </p>

                  <div
                    className={`mt-3 rounded-md border px-3 py-3 text-sm ${
                      accountStatusError
                        ? "border-negative/35 bg-negative/10"
                        : accountStream?.connected
                          ? "border-positive/30 bg-positive/10"
                          : accountStream?.enabled
                            ? "border-caution/30 bg-caution/10"
                            : "border-white/10 bg-white/5"
                    }`}
                  >
                    <div className="text-slate-300">
                      {accountStatusError ?? accountStatusMessage}
                    </div>

                    {accountKeyLabel ? (
                      <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                        key {accountKeyLabel}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3">
                    <label className="space-y-1 text-sm">
                      <span className="text-slate-400">Binance API Key</span>
                      <input
                        value={binanceApiKeyDraft}
                        onChange={(event) => setBinanceApiKeyDraft(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Paste read-only futures key"
                        className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
                      />
                    </label>

                    <label className="space-y-1 text-sm">
                      <span className="text-slate-400">Binance API Secret</span>
                      <input
                        type="password"
                        value={binanceApiSecretDraft}
                        onChange={(event) => setBinanceApiSecretDraft(event.target.value)}
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder="Paste matching secret"
                        className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
                      />
                    </label>
                  </div>

                  {accountFormError ? (
                    <p className="mt-3 text-sm text-negative">{accountFormError}</p>
                  ) : null}

                  {accountCredentialSource === "env" ? (
                    <p className="mt-3 text-xs text-slate-500">
                      `.env` credentials are active right now. Entering keys here will override them
                      for the current app session.
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleBinanceConnect}
                      disabled={accountActionPending !== null || connectionState !== "open"}
                      className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {accountActionPending === "connect"
                        ? "Connecting..."
                        : accountCredentialSource === "session"
                          ? "Update Session Keys"
                          : "Connect Binance"}
                    </button>

                    {accountCredentialSource === "session" ? (
                      <button
                        type="button"
                        onClick={handleBinanceDisconnect}
                        disabled={accountActionPending !== null || connectionState !== "open"}
                        className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {accountActionPending === "disconnect"
                          ? "Disconnecting..."
                          : "Disconnect Session"}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
              </div>
            ) : null}

            {visibleSections.activeTrades ? (
              <div
                id="active-trades"
                {...dashboardPanelDropProps("activeTrades")}
                className="swipe-page order-[60] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
              >
              {renderDashboardResizeFrame("activeTrades")}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Active Trades
                  </h2>
                  <span className="text-xs text-slate-500">{activeTradeSummary}</span>
                </div>
                <div className="flex items-center gap-2">
                  {renderDashboardPanelHandles("activeTrades")}
                  <PanelToggleButton
                    collapsed={collapsedSections.activeTrades}
                    onClick={() => toggleSection("activeTrades")}
                  />
                </div>
              </div>

              {!collapsedSections.activeTrades ? (
                <>
                  <p className="mt-3 text-xs text-slate-500">
                    Real Binance positions are added automatically. Manual pins are optional and stay
                    until you remove them.
                  </p>

                  <div className="mt-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Account Positions
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!frame?.status.accountStream.enabled ? (
                        <p className="text-sm text-slate-500">
                          Connect Binance in the card above or configure keys in `.env`.
                        </p>
                      ) : accountStatusError ? (
                        <p className="text-sm text-negative">{accountStatusError}</p>
                      ) : accountPositionSymbols.length === 0 ? (
                        <p className="text-sm text-slate-500">No open Binance positions.</p>
                      ) : (
                        accountPositionSymbols.map((symbol) => (
                          <span
                            key={symbol}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-200"
                          >
                            {symbol}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Manual Pins
                  </div>

                  <div className="mt-2 flex gap-2">
                    <input
                      value={activeTradeDraft}
                      onChange={(event) => setActiveTradeDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          addActiveTradeDraft();
                        }
                      }}
                      placeholder="BTCUSDT SOLUSDT"
                      className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none transition focus:border-caution/60"
                    />
                    <button
                      onClick={addActiveTradeDraft}
                      className="rounded-md border border-caution/30 bg-caution/10 px-3 py-2 text-sm font-medium text-caution"
                    >
                      Add
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeTrades.length === 0 ? (
                      <p className="text-sm text-slate-500">No manual pins yet.</p>
                    ) : (
                      activeTrades.map((symbol) => (
                        <button
                          key={symbol}
                          onClick={() => removeActiveTrade(symbol)}
                          className="rounded-full border border-caution/30 bg-caution/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-caution"
                        >
                          {symbol}
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : null}
              </div>
            ) : null}

            {riskCenterPanel}
            {correlationHeatmapPanel}
            {varPanel}
            {fundingBasisPanel}
            {marketFlowPanel}
            {signalIntelligencePanel}
            {metaRegimeGovernorPanel}
            {positionRiskOrchestratorPanel}
            {regimeMemoryPanel}
            {regimePredictionPanel}
            {regimeFeedbackCalibrationPanel}
            {pnlAttributionPanel}

            {visibleSections.watchlist ? (
              <div
                id="watchlist"
                {...dashboardPanelDropProps("watchlist")}
                className="swipe-page order-[70] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
              >
              {renderDashboardResizeFrame("watchlist")}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Watchlist
                  </h2>
                  <span className="text-xs text-slate-500">{watchlist.length} watch symbols</span>
                </div>
                <div className="flex items-center gap-2">
                  {renderDashboardPanelHandles("watchlist")}
                  <PanelToggleButton
                    collapsed={collapsedSections.watchlist}
                    onClick={() => toggleSection("watchlist")}
                  />
                </div>
              </div>

              {!collapsedSections.watchlist ? (
                <>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={watchlistDraft}
                      onChange={(event) => setWatchlistDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          addWatchlistDraft();
                        }
                      }}
                      placeholder="BTCUSDT SOLUSDT"
                      className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none transition focus:border-accent/60"
                    />
                    <button
                      onClick={addWatchlistDraft}
                      className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent"
                    >
                      Add
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {watchlist.length === 0 ? (
                      <p className="text-sm text-slate-500">No watched symbols yet.</p>
                    ) : (
                      watchlist.map((symbol) => (
                        <button
                          key={symbol}
                          onClick={() => removeWatchlist(symbol)}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-200"
                        >
                          {symbol}
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : null}
              </div>
            ) : null}

            {visibleSections.frameTelemetry ? (
              <div
                id="frame-telemetry"
                {...dashboardPanelDropProps("frameTelemetry")}
                className="swipe-page order-[79] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
              >
                {renderDashboardResizeFrame("frameTelemetry")}
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Frame Telemetry
                  </h2>
                  <div className="flex items-center gap-2">
                    {renderDashboardPanelHandles("frameTelemetry")}
                    <PanelToggleButton
                      collapsed={collapsedSections.frameTelemetry}
                      onClick={() => toggleSection("frameTelemetry")}
                    />
                  </div>
                </div>
                {!collapsedSections.frameTelemetry ? (
                  <div className="mt-3 space-y-3 text-sm text-slate-300">
                    <div className="grid gap-2">
                      <HealthRow
                        label="Frame Size"
                        value={formatTelemetryKb(frame?.frameTelemetry?.frameSizeKb)}
                      />
                      <HealthRow
                        label="Suppressed Frame"
                        value={formatTelemetryKb(frame?.frameTelemetry?.suppressedFrameSizeKb)}
                      />
                      <HealthRow
                        label="Saved Payload"
                        value={formatTelemetryKb(frame?.frameTelemetry?.savedKb)}
                      />
                      <HealthRow
                        label="Suppression Ratio"
                        value={
                          typeof frame?.frameTelemetry?.suppressionRatio === "number"
                            ? frame.frameTelemetry.suppressionRatio.toFixed(4)
                            : "--"
                        }
                      />
                      <HealthRow
                        label="Delta Enabled"
                        value={frame?.frameTelemetry?.deltaEnabled ? "yes" : "no"}
                      />
                      <HealthRow
                        label="Snapshots Sent"
                        value={String(frame?.frameTelemetry?.snapshotFramesSent ?? 0)}
                      />
                      <HealthRow
                        label="Patches Sent"
                        value={String(frame?.frameTelemetry?.patchFramesSent ?? 0)}
                      />
                      <HealthRow
                        label="Average Patch"
                        value={formatTelemetryKb(frame?.frameTelemetry?.averagePatchSizeKb)}
                      />
                      <HealthRow
                        label="Saved By Delta"
                        value={formatTelemetryKb(frame?.frameTelemetry?.savedByDeltaKb)}
                      />
                      <HealthRow
                        label="Delta Ratio"
                        value={
                          typeof frame?.frameTelemetry?.deltaRatio === "number"
                            ? frame.frameTelemetry.deltaRatio.toFixed(4)
                            : "--"
                        }
                      />
                      <HealthRow
                        label="Payload Budget State"
                        value={frame?.frameTelemetry?.payloadBudgetState ?? "--"}
                      />
                      <HealthRow
                        label="Performance State"
                        value={frame?.frameTelemetry?.performanceState ?? "--"}
                      />
                      <HealthRow
                        label="Connected Clients"
                        value={String(frame?.frameTelemetry?.clientsConnected ?? 0)}
                      />
                      <HealthRow
                        label="Average Frame Size"
                        value={formatTelemetryKb(frame?.frameTelemetry?.averageFrameSizeKb)}
                      />
                      <HealthRow
                        label="Largest Frame"
                        value={formatTelemetryKb(frame?.frameTelemetry?.largestFrameObservedKb)}
                      />
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/20 p-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Top Largest Sections
                      </div>
                      <div className="mt-2 grid gap-1.5">
                        {(frame?.frameTelemetry?.largestSections ?? []).length === 0 ? (
                          <div className="text-xs text-slate-500">No telemetry yet.</div>
                        ) : (
                          (frame?.frameTelemetry?.largestSections ?? []).map((section) => (
                            <HealthRow
                              key={section.section}
                              label={section.section}
                              value={formatTelemetryKb(section.kb)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {visibleSections.renderTelemetry ? (
              <div
                id="render-telemetry"
                {...dashboardPanelDropProps("renderTelemetry")}
                className="swipe-page order-[79] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
              >
                {renderDashboardResizeFrame("renderTelemetry")}
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Render Telemetry
                  </h2>
                  <div className="flex items-center gap-2">
                    {renderDashboardPanelHandles("renderTelemetry")}
                    <PanelToggleButton
                      collapsed={collapsedSections.renderTelemetry}
                      onClick={() => toggleSection("renderTelemetry")}
                    />
                  </div>
                </div>
                {!collapsedSections.renderTelemetry ? (
                  <div className="mt-3 grid gap-2 text-sm text-slate-300">
                    <HealthRow label="FPS" value={renderTelemetryState.fps.toFixed(1)} />
                    <HealthRow
                      label="Average Render"
                      value={`${renderTelemetryState.averageRenderMs.toFixed(2)} ms`}
                    />
                    <HealthRow
                      label="Max Render"
                      value={`${renderTelemetryState.maxRenderMs.toFixed(2)} ms`}
                    />
                    <HealthRow
                      label="Patch Merge"
                      value={`${renderTelemetryState.averagePatchMergeMs.toFixed(2)} ms avg / ${renderTelemetryState.maxPatchMergeMs.toFixed(2)} ms max`}
                    />
                    <HealthRow
                      label="Dropped Frames"
                      value={String(renderTelemetryState.droppedFrames)}
                    />
                    <HealthRow
                      label="Frame Age"
                      value={`${Math.round(renderTelemetryState.lastFrameAgeMs)} ms`}
                    />
                    <HealthRow label="UI Health" value={renderTelemetryState.uiHealth} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {visibleSections.health ? (
              <div
                id="health"
                {...dashboardPanelDropProps("health")}
                className="swipe-page order-[80] rounded-lg border border-white/10 bg-panel p-4 shadow-panel"
              >
                {renderDashboardResizeFrame("health")}
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Feed Health
                  </h2>
                  <div className="flex items-center gap-2">
                    {renderDashboardPanelHandles("health")}
                    <PanelToggleButton
                      collapsed={collapsedSections.health}
                      onClick={() => toggleSection("health")}
                    />
                  </div>
                </div>
                {!collapsedSections.health ? (
                  <div className="mt-3 grid gap-2 text-sm text-slate-300">
                    <HealthRow
                      label="Tracked coins"
                      value={String(frame?.status.universeSize ?? 0)}
                    />
                    <HealthRow
                      label="Focus coins"
                      value={String(frame?.status.focusSymbols.length ?? 0)}
                    />
                    <HealthRow label="Market pulse" value={frame ? frame.overview.marketPulse.toFixed(1) : "--"} />
                    <HealthRow label="Hot liquidations" value={frame ? compactUsd(frame.overview.hotLiquidationsUsd) : "--"} />
                    <HealthRow label="Open positions" value={String(frame?.status.accountStream.activePositions.length ?? 0)} />
                    <HealthRow label="Last update" value={frame ? formatClock(frame.generatedAt) : "--"} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>
        </section>

        <header className="swipe-page order-[35] rounded-lg border border-white/10 bg-panel px-3 py-3 shadow-panel">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-1">
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                  Binance Futures USDT-M
                </p>
                <h1 className="text-xl font-semibold text-white">t.me/troesh</h1>
              </div>
              <div
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${
                  connectionState === "open"
                    ? "border-positive/40 bg-positive/10 text-positive"
                    : connectionState === "connecting"
                      ? "border-caution/40 bg-caution/10 text-caution"
                      : "border-negative/40 bg-negative/10 text-negative"
                }`}
              >
                {connectionState}
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                {latencyMs !== null ? `${latencyMs} ms RTT` : "latency pending"}
              </div>
              <button
                onClick={() => setSoundEnabled(!uiPreferences.soundEnabled)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${
                  uiPreferences.soundEnabled
                    ? "border-positive/40 bg-positive/10 text-positive"
                    : "border-white/10 bg-white/5 text-slate-300"
                }`}
              >
                sound {uiPreferences.soundEnabled ? "on" : "off"}
              </button>
              <button
                type="button"
                onClick={toggleDashboardLayoutMode}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${
                  isFreeDashboardLayout
                    ? "border-caution/40 bg-caution/10 text-caution"
                    : "border-accent/40 bg-accent/10 text-accent"
                }`}
              >
                grid {isFreeDashboardLayout ? "off" : "on"}
              </button>
              <button
                type="button"
                onClick={arrangeDashboardPanelsFree}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-300 transition hover:border-caution/40 hover:text-caution"
              >
                arrange
              </button>
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
                  voice
                </div>
                {voiceProfilePresets.map((profile) => (
                  <VoiceProfileChip
                    key={profile.id}
                    label={profile.badgeLabel}
                    active={profile.id === currentVoiceProfileId}
                    onClick={() => handleVoiceProfileSelect(profile.id)}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCabinetOpen(true)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${
                  cabinetSession.mode === "authenticated"
                    ? "border-[#f0b90b]/50 bg-[#f0b90b]/10 text-[#f0b90b]"
                    : "border-white/10 bg-white/5 text-slate-300"
                }`}
              >
                {cabinetSession.mode === "authenticated" ? `cabinet ${cabinetHandleLabel}` : "LOGIN"}
              </button>
              {frame ? (
                <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                  {frame.status.universeSize} tracked / {frame.status.focusSymbols.length} focus
                </div>
              ) : null}
            </div>
            <p className="max-w-3xl text-xs text-slate-500">
              Full-universe breadth with a focused low-lag tape, spread and liquidation basket.
            </p>
          </div>
        </header>

        {cabinetOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
            <button
              type="button"
              aria-label="Close cabinet"
              onClick={() => setCabinetOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />
            <div className="relative z-10 max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[#f0b90b]/20 bg-[#0b1017] p-5 shadow-2xl shadow-black/40">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-[#f0b90b]">
                    Binance QR Cabinet
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    LOGIN to personal cabinet
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400">
                    This cabinet keeps watchlist, sound, separate alert toggles, hidden blocks and
                    notes under one saved profile. The QR is local to this app build and is not an
                    official Binance partner authorization flow.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCabinetOpen(false)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300"
                >
                  Close
                </button>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Cabinet profile
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="space-y-1 text-sm">
                        <span className="text-slate-400">Profile name</span>
                        <input
                          value={profileNameDraft}
                          onChange={(event) => setProfileNameDraft(event.target.value)}
                          placeholder="Scalp Desk"
                          className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-slate-100 outline-none transition focus:border-[#f0b90b]/60"
                        />
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="text-slate-400">Binance handle or UID</span>
                        <input
                          value={binanceHandleDraft}
                          onChange={(event) => setBinanceHandleDraft(event.target.value)}
                          placeholder="@yourbinanceuid"
                          className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-slate-100 outline-none transition focus:border-[#f0b90b]/60"
                        />
                      </label>
                    </div>

                    <div className="mt-4 rounded-md border border-[#f0b90b]/20 bg-[#f0b90b]/10 px-3 py-3 text-sm text-[#f7d774]">
                      Use the same Binance handle/UID next time to reopen the saved cabinet
                      instantly on this device.
                    </div>

                    {cabinetError ? (
                      <p className="mt-4 text-sm text-negative">{cabinetError}</p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCabinetLogin()}
                        disabled={cabinetBusy}
                        className="rounded-md border border-[#f0b90b]/30 bg-[#f0b90b]/10 px-4 py-2 text-sm font-medium text-[#f0b90b] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {cabinetBusy ? "Opening..." : "LOGIN"}
                      </button>

                      {cabinetSession.mode === "authenticated" ? (
                        <button
                          type="button"
                          onClick={() => void handleCabinetLogout()}
                          disabled={cabinetBusy}
                          className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Logout to guest
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Saved cabinets
                    </div>
                    <div className="mt-3 space-y-2">
                      {cabinetProfiles.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          No saved cabinet profiles yet. Log in once to create the first one.
                        </p>
                      ) : (
                        cabinetProfiles.map((profile) => (
                          <button
                            key={profile.id}
                            type="button"
                            onClick={() => void handleCabinetLogin(profile.id)}
                            className={`flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition ${
                              activeProfile?.id === profile.id
                                ? "border-[#f0b90b]/40 bg-[#f0b90b]/10"
                                : "border-white/10 bg-black/20 hover:border-[#f0b90b]/30"
                            }`}
                          >
                            <div>
                              <div className="text-sm font-medium text-slate-100">
                                {profile.profileName}
                              </div>
                              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                                {profile.binanceHandle}
                              </div>
                            </div>
                            <div className="text-xs text-slate-400">
                              {formatClock(profile.lastLoginAt)}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-[#f0b90b]/20 bg-[#f0b90b]/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#f7d774]">
                      QR preview
                    </div>
                    <div className="mt-4 flex justify-center">
                      <div className="rounded-2xl bg-[#f0b90b] p-4">
                        {cabinetQrDataUrl ? (
                          <img
                            src={cabinetQrDataUrl}
                            alt="Cabinet QR code"
                            className="h-52 w-52 rounded-lg"
                          />
                        ) : (
                          <div className="flex h-52 w-52 items-center justify-center rounded-lg bg-[#f0b90b]/40 text-sm text-[#0b1017]">
                            Enter handle to render QR
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="mt-4 text-sm text-[#f9e4a4]">
                      Binance-style QR bind for this localhost cabinet profile. It is intended for
                      profile recovery and switching inside Darra Terminal.
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      What is stored
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-300">
                      <p>Watchlist and manual active trade pins</p>
                      <p>Sound master switch and separate alert categories</p>
                      <p>Block visibility and collapse state</p>
                      <p>Personal notes and quick desk context</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

const formatStatsPercent = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "--";

const formatStatsMove = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const normalizeJournalTags = (tags: string[]): string[] =>
  Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter((tag) => tag.length > 0 && tag !== "unknown")
    )
  ).slice(0, 24);

const formatNullableJournalNumber = (value: number | null): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toString() : "";

const parseJournalNumber = (value: string): number | null => {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const journalPnlClasses = (value: number | null): string => {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "text-slate-300";
  }

  return value > 0 ? "text-positive" : "text-negative";
};

const formatJournalMetric = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "--";

const formatJournalPnlMetric = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${formatJournalMetric(value)}`;
};

const hasJournalAnalytics = (analytics: JournalAnalyticsPayload | null): boolean =>
  (analytics?.summary.total_trades ?? 0) > 0;

const hasLearningReport = (report: LearningReportPayload | null): boolean =>
  (report?.setupPerformance.some((row) => row.total_outcomes > 0 || row.total_signals > 0) ??
    false) ||
  (report?.symbolPerformance.some((row) => row.total_outcomes > 0 || row.total_signals > 0) ??
    false);

function LearningCenterPanel({
  report,
  loading,
  updatedAt
}: {
  report: LearningReportPayload | null;
  loading: boolean;
  updatedAt: number | null;
}) {
  const topSetups = (report?.setupPerformance ?? [])
    .filter((row) => row.key !== "UNKNOWN")
    .slice(0, 8);
  const worstSetups = [...(report?.setupPerformance ?? [])]
    .filter((row) => row.key !== "UNKNOWN" && (row.total_outcomes > 0 || row.total_signals > 0))
    .sort(
      (left, right) =>
        left.confidence_score - right.confidence_score ||
        left.avg_move - right.avg_move ||
        left.avg_pnl - right.avg_pnl
    )
    .slice(0, 8);
  const topSymbols = (report?.symbolPerformance ?? []).slice(0, 10);
  const worstSymbols = [...(report?.symbolPerformance ?? [])]
    .filter((row) => row.total_outcomes > 0 || row.total_signals > 0)
    .sort(
      (left, right) =>
        left.confidence_score - right.confidence_score ||
        left.avg_move - right.avg_move ||
        left.avg_pnl - right.avg_pnl
    )
    .slice(0, 10);
  const hasData = hasLearningReport(report);

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <SignalStatisticsMetric
          label="Best setup"
          value={report?.insights.bestSetup ?? "--"}
          className="text-positive"
        />
        <SignalStatisticsMetric
          label="Best verdict"
          value={report?.insights.bestOpportunityVerdict ?? "--"}
          className="text-accent"
        />
        <SignalStatisticsMetric
          label="Best priority"
          value={report?.insights.bestAlertPriority ?? "--"}
          className="text-caution"
        />
        <SignalStatisticsMetric
          label="Preferred"
          value={String(report?.recommendations.preferredSetups.length ?? 0)}
          className="text-positive"
        />
        <SignalStatisticsMetric
          label="Avoid setups"
          value={String(report?.recommendations.setupsToAvoid.length ?? 0)}
          className="text-negative"
        />
        <SignalStatisticsMetric
          label="Updated"
          value={loading ? "loading" : updatedAt ? formatClock(updatedAt) : "--"}
        />
      </div>

      {!hasData ? (
        <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-slate-400">
          {loading
            ? "Loading learning report..."
            : "No learning data yet. Outcomes and journal PnL will fill this center automatically."}
        </div>
      ) : (
        <>
          <section className="grid gap-3 xl:grid-cols-2">
            <LearningRecommendationList
              title="Recommended"
              items={report?.recommendations.preferredSetups ?? []}
              empty="No preferred setups yet."
              kind="setup"
            />
            <LearningRecommendationList
              title="Needs attention"
              items={[
                ...(report?.insights.overestimatedVerdicts ?? []).map(
                  (item) => `verdict ${item}`
                ),
                ...(report?.insights.uselessAlertPriorities ?? []).map(
                  (item) => `priority ${item}`
                )
              ]}
              empty="No weak verdicts or priorities detected."
              kind="plain"
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <LearningPerformanceTable
              title="Top Setups"
              keyLabel="setupType"
              rows={topSetups}
              kind="setup"
            />
            <LearningPerformanceTable
              title="Worst Setups"
              keyLabel="setupType"
              rows={worstSetups}
              kind="setup"
            />
            <LearningPerformanceTable
              title="Top Symbols"
              keyLabel="symbol"
              rows={topSymbols}
              kind="symbol"
            />
            <LearningPerformanceTable
              title="Worst Symbols"
              keyLabel="symbol"
              rows={worstSymbols}
              kind="symbol"
            />
            <LearningPerformanceTable
              title="Opportunity Performance"
              keyLabel="verdict"
              rows={report?.opportunityPerformance ?? []}
              kind="verdict"
            />
            <LearningPerformanceTable
              title="Alert Priority Performance"
              keyLabel="priority"
              rows={report?.alertPriorityPerformance ?? []}
              kind="alert"
            />
          </div>

          <LearningPerformanceTable
            title="Direction Performance"
            keyLabel="direction"
            rows={report?.directionPerformance ?? []}
            kind="direction"
            compact
          />
        </>
      )}
    </div>
  );
}

function LearningRecommendationList({
  title,
  items,
  empty,
  kind
}: {
  title: string;
  items: string[];
  empty: string;
  kind: "setup" | "plain";
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={`${title}-${item}`}
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                kind === "setup"
                  ? setupTypeClasses(item)
                  : "border-white/10 bg-white/5 text-slate-200"
              }`}
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function LearningPerformanceTable({
  title,
  keyLabel,
  rows,
  kind,
  compact = false
}: {
  title: string;
  keyLabel: string;
  rows: LearningPerformanceBucket[];
  kind: "setup" | "verdict" | "alert" | "symbol" | "direction";
  compact?: boolean;
}) {
  const visibleRows = compact ? rows.slice(0, 4) : rows.slice(0, 10);

  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      {visibleRows.length === 0 ? (
        <p className="text-xs text-slate-500">No learning rows in this slice.</p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <HeaderCell>{keyLabel}</HeaderCell>
                <HeaderCell>Signals</HeaderCell>
                <HeaderCell>Outcomes</HeaderCell>
                <HeaderCell>Win</HeaderCell>
                <HeaderCell>Move</HeaderCell>
                <HeaderCell>Fav/Adv</HeaderCell>
                <HeaderCell>Avg PnL</HeaderCell>
                <HeaderCell>Conf</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleRows.map((row) => (
                <tr key={`${title}-${row.key}`}>
                  <Cell>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${learningKeyClasses(
                        row.key,
                        kind
                      )}`}
                    >
                      {row.key}
                    </span>
                  </Cell>
                  <Cell>{row.total_signals}</Cell>
                  <Cell>{row.total_outcomes}</Cell>
                  <Cell className={winRateClasses(row.win_rate)}>
                    {formatStatsPercent(row.win_rate)}
                  </Cell>
                  <Cell className={biasColor(row.avg_move)}>
                    {formatStatsMove(row.avg_move)}
                  </Cell>
                  <Cell>
                    <span className="text-positive">{formatStatsMove(row.avg_favorable)}</span>
                    <span className="text-slate-600"> / </span>
                    <span className="text-negative">{formatStatsMove(-row.avg_adverse)}</span>
                  </Cell>
                  <Cell className={journalPnlClasses(row.avg_pnl)}>
                    {formatJournalPnlMetric(row.avg_pnl)}
                  </Cell>
                  <Cell>{row.confidence_score.toFixed(2)}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const learningKeyClasses = (
  key: string,
  kind: "setup" | "verdict" | "alert" | "symbol" | "direction"
): string => {
  if (kind === "setup") {
    return setupTypeClasses(key);
  }

  if (kind === "verdict") {
    return opportunityVerdictClasses(key);
  }

  if (kind === "alert") {
    return alertPriorityClasses(key);
  }

  if (kind === "direction") {
    return key === "LONG"
      ? "border-positive/30 bg-positive/10 text-positive"
      : key === "SHORT"
        ? "border-negative/30 bg-negative/10 text-negative"
        : "border-white/10 bg-white/5 text-slate-200";
  }

  return "border-white/10 bg-white/5 text-slate-200";
};

function TradeJournalPanel({
  entries,
  analytics,
  analyticsLoading,
  analyticsUpdatedAt,
  loading,
  error,
  sinceMs,
  symbol,
  side,
  limit,
  onSinceChange,
  onSymbolChange,
  onSideChange,
  onLimitChange,
  notice,
  onEdit,
  onDelete
}: {
  entries: JournalEntryRecord[];
  analytics: JournalAnalyticsPayload | null;
  analyticsLoading: boolean;
  analyticsUpdatedAt: number | null;
  loading: boolean;
  error: string | null;
  sinceMs: number;
  symbol: string;
  side: JournalEntrySide | "all";
  limit: number;
  onSinceChange: (value: number) => void;
  onSymbolChange: (value: string) => void;
  onSideChange: (value: JournalEntrySide | "all") => void;
  onLimitChange: (value: number) => void;
  notice: string | null;
  onEdit: (entry: JournalEntryRecord) => void;
  onDelete: (id: string) => boolean;
}) {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Period</span>
          <select
            value={sinceMs}
            onChange={(event) => onSinceChange(Number(event.target.value))}
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
          >
            {journalPeriodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Symbol</span>
          <input
            value={symbol}
            onChange={(event) => onSymbolChange(event.target.value)}
            placeholder="BTCUSDT"
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Side</span>
          <select
            value={side}
            onChange={(event) => onSideChange(event.target.value as JournalEntrySide | "all")}
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
          >
            <option value="all">all</option>
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Limit</span>
          <select
            value={limit}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
          >
            {journalLimitOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">
          {notice}
        </div>
      ) : null}

      <section className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Journal Analytics
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {analyticsLoading
                ? "loading analytics..."
                : analyticsUpdatedAt
                  ? `updated ${formatClock(analyticsUpdatedAt)}`
                  : "waiting for backend response"}
            </div>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <SignalStatisticsMetric
            label="Trades"
            value={String(analytics?.summary.total_trades ?? 0)}
          />
          <SignalStatisticsMetric
            label="Win rate"
            value={formatStatsPercent(analytics?.summary.win_rate_pct)}
            className={winRateClasses(analytics?.summary.win_rate_pct)}
          />
          <SignalStatisticsMetric
            label="Total PnL"
            value={formatJournalPnlMetric(analytics?.summary.total_pnl)}
            className={journalPnlClasses(analytics?.summary.total_pnl ?? null)}
          />
          <SignalStatisticsMetric
            label="Avg PnL"
            value={formatJournalPnlMetric(analytics?.summary.avg_pnl)}
            className={journalPnlClasses(analytics?.summary.avg_pnl ?? null)}
          />
          <SignalStatisticsMetric
            label="Best PnL"
            value={formatJournalPnlMetric(analytics?.summary.best_trade_pnl)}
            className="text-positive"
          />
          <SignalStatisticsMetric
            label="Worst PnL"
            value={formatJournalPnlMetric(analytics?.summary.worst_trade_pnl)}
            className="text-negative"
          />
        </div>

        {!hasJournalAnalytics(analytics) ? (
          <div className="rounded-md border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-400">
            No journal analytics yet. Create journal entries to see trading performance.
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            <JournalAnalyticsBucketTable
              title="By setup type"
              keyLabel="setupType"
              rows={analytics?.bySetupType ?? []}
              kind="setup"
            />
            <JournalAnalyticsBucketTable
              title="By opportunity verdict"
              keyLabel="verdict"
              rows={analytics?.byOpportunityVerdict ?? []}
              kind="verdict"
            />
            <JournalAnalyticsBucketTable
              title="By symbol"
              keyLabel="symbol"
              rows={analytics?.bySymbol ?? []}
              kind="symbol"
            />
            <JournalAnalyticsBucketTable
              title="By side"
              keyLabel="side"
              rows={analytics?.bySide ?? []}
              kind="side"
            />
          </div>
        )}
      </section>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="min-w-[920px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <HeaderCell>Time</HeaderCell>
              <HeaderCell>Symbol</HeaderCell>
              <HeaderCell>Side</HeaderCell>
              <HeaderCell>Entry</HeaderCell>
              <HeaderCell>Exit</HeaderCell>
              <HeaderCell>Size</HeaderCell>
              <HeaderCell>PnL</HeaderCell>
              <HeaderCell>Linked Signal</HeaderCell>
              <HeaderCell>Notes</HeaderCell>
              <HeaderCell>Tags</HeaderCell>
              <HeaderCell>Actions</HeaderCell>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {entries.length === 0 ? (
              <tr>
                <Cell colSpan={11}>
                  <span className="text-slate-500">
                    {loading ? "Loading journal entries..." : "No journal entries match filters."}
                  </span>
                </Cell>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <Cell>{formatClock(entry.createdAt)}</Cell>
                  <Cell className="font-medium text-slate-100">{entry.symbol}</Cell>
                  <Cell>{entry.side ?? "--"}</Cell>
                  <Cell>{entry.entryPrice ?? "--"}</Cell>
                  <Cell>{entry.exitPrice ?? "--"}</Cell>
                  <Cell>{entry.size ?? "--"}</Cell>
                  <Cell className={journalPnlClasses(entry.pnl)}>{entry.pnl ?? "--"}</Cell>
                  <Cell>
                    {entry.signalId ? (
                      <span className="font-mono text-[11px] text-accent">
                        {entry.signalId.slice(0, 8)}
                      </span>
                    ) : (
                      "--"
                    )}
                  </Cell>
                  <Cell className="max-w-[220px] truncate text-slate-300">
                    {entry.notes ?? "--"}
                  </Cell>
                  <Cell>
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {entry.tags.length ? (
                        entry.tags.map((tag) => (
                          <span
                            key={`${entry.id}-${tag}`}
                            className={
                              tag === "auto"
                                ? "rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent"
                                : "rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300"
                            }
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500">--</span>
                      )}
                    </div>
                  </Cell>
                  <Cell>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(entry)}
                        className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300 transition hover:border-accent/40 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(entry.id)}
                        className="rounded-md border border-negative/25 bg-negative/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-negative transition hover:border-negative/50 hover:text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </Cell>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JournalAnalyticsBucketTable({
  title,
  keyLabel,
  rows,
  kind
}: {
  title: string;
  keyLabel: string;
  rows: JournalAnalyticsBucket[];
  kind: "setup" | "verdict" | "symbol" | "side";
}) {
  const visibleRows = rows.slice(0, 8);

  return (
    <section className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      {visibleRows.length === 0 ? (
        <p className="text-xs text-slate-500">No journal trades in this slice.</p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <HeaderCell>{keyLabel}</HeaderCell>
                <HeaderCell>Trades</HeaderCell>
                <HeaderCell>Win</HeaderCell>
                <HeaderCell>Total</HeaderCell>
                <HeaderCell>Avg</HeaderCell>
                <HeaderCell>Long/Short</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleRows.map((row) => (
                <tr key={`${title}-${row.key}`}>
                  <Cell>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                        kind === "verdict"
                          ? opportunityVerdictClasses(row.key)
                          : kind === "setup"
                            ? setupTypeClasses(row.key)
                            : kind === "side"
                              ? row.key === "long"
                                ? "border-positive/30 bg-positive/10 text-positive"
                                : row.key === "short"
                                  ? "border-negative/30 bg-negative/10 text-negative"
                                  : "border-white/10 bg-white/5 text-slate-200"
                              : "border-white/10 bg-white/5 text-slate-200"
                      }`}
                    >
                      {row.key}
                    </span>
                  </Cell>
                  <Cell>{row.total_trades}</Cell>
                  <Cell className={winRateClasses(row.win_rate_pct)}>
                    {formatStatsPercent(row.win_rate_pct)}
                  </Cell>
                  <Cell className={journalPnlClasses(row.total_pnl)}>
                    {formatJournalPnlMetric(row.total_pnl)}
                  </Cell>
                  <Cell className={journalPnlClasses(row.avg_pnl)}>
                    {formatJournalPnlMetric(row.avg_pnl)}
                  </Cell>
                  <Cell>
                    {row.long_trades}/{row.short_trades}
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function JournalEntryModal({
  seed,
  entry,
  error,
  onSubmit,
  onClose
}: {
  seed: CreateJournalEntryInput | null;
  entry: JournalEntryRecord | null;
  error: string | null;
  onSubmit: (input: CreateJournalEntryInput, entryId?: string | null) => boolean;
  onClose: () => void;
}) {
  const [signalId, setSignalId] = useState(entry?.signalId ?? seed?.signalId ?? "");
  const [symbol, setSymbol] = useState(entry?.symbol ?? seed?.symbol ?? "");
  const [side, setSide] = useState<JournalEntrySide>(entry?.side ?? seed?.side ?? "long");
  const [entryPrice, setEntryPrice] = useState(
    formatNullableJournalNumber(entry?.entryPrice ?? seed?.entryPrice ?? null)
  );
  const [exitPrice, setExitPrice] = useState(
    formatNullableJournalNumber(entry?.exitPrice ?? seed?.exitPrice ?? null)
  );
  const [size, setSize] = useState(formatNullableJournalNumber(entry?.size ?? seed?.size ?? null));
  const [pnl, setPnl] = useState(formatNullableJournalNumber(entry?.pnl ?? seed?.pnl ?? null));
  const [notes, setNotes] = useState(entry?.notes ?? seed?.notes ?? "");
  const [tagsText, setTagsText] = useState((entry?.tags ?? seed?.tags ?? []).join(", "));
  const [localError, setLocalError] = useState<string | null>(null);
  const title = entry ? "Edit Journal Entry" : "Create Journal Entry";

  const submit = () => {
    const normalizedSymbol = symbol.trim().toUpperCase();

    if (!normalizedSymbol) {
      setLocalError("Symbol is required.");
      return;
    }

    const payload: CreateJournalEntryInput = {
      signalId: signalId.trim() || null,
      symbol: normalizedSymbol,
      side,
      entryPrice: parseJournalNumber(entryPrice),
      exitPrice: parseJournalNumber(exitPrice),
      size: parseJournalNumber(size),
      pnl: parseJournalNumber(pnl),
      notes: notes.trim() || null,
      tags: normalizeJournalTags(tagsText.split(","))
    };

    setLocalError(null);
    onSubmit(payload, entry?.id ?? null);
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/70 px-3 py-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-lg border border-white/10 bg-panel p-4 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-accent">Trade Journal</div>
            <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-slate-300 transition hover:border-accent/40 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-slate-400">Symbol</span>
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-400">Side</span>
            <select
              value={side}
              onChange={(event) => setSide(event.target.value as JournalEntrySide)}
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            >
              <option value="long">long</option>
              <option value="short">short</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-400">Entry Price</span>
            <input
              inputMode="decimal"
              value={entryPrice}
              onChange={(event) => setEntryPrice(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-400">Exit Price</span>
            <input
              inputMode="decimal"
              value={exitPrice}
              onChange={(event) => setExitPrice(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-400">Size</span>
            <input
              inputMode="decimal"
              value={size}
              onChange={(event) => setSize(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-400">PnL</span>
            <input
              inputMode="decimal"
              value={pnl}
              onChange={(event) => setPnl(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-slate-400">Linked Signal</span>
            <input
              value={signalId ?? ""}
              onChange={(event) => setSignalId(event.target.value)}
              placeholder="optional signal id"
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-slate-400">Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="w-full resize-y rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-slate-400">Tags</span>
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="squeeze, good-entry"
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
            />
          </label>
        </div>

        {localError || error ? (
          <div className="mt-4 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
            {localError ?? error}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-300 transition hover:border-accent/40 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md border border-positive/30 bg-positive/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-positive transition hover:border-positive/60 hover:text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const hasSignalStatistics = (statistics: SignalStatisticsPayload | null): boolean =>
  (statistics?.summary.total_outcomes ?? 0) > 0 ||
  (statistics?.summary.total_signals ?? 0) > 0 ||
  (statistics?.recentOutcomes.length ?? 0) > 0;

function SignalStatisticsPanel({
  statistics,
  updatedAt,
  horizonSec,
  sinceMs,
  limit,
  onHorizonChange,
  onSinceChange,
  onLimitChange,
  onReplay
}: {
  statistics: SignalStatisticsPayload | null;
  updatedAt: number | null;
  horizonSec: number;
  sinceMs: number;
  limit: number;
  onHorizonChange: (value: number) => void;
  onSinceChange: (value: number) => void;
  onLimitChange: (value: number) => void;
  onReplay: (signalId: string) => boolean;
}) {
  const summary = statistics?.summary;
  const hasData = hasSignalStatistics(statistics);

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Horizon</span>
          <select
            value={horizonSec}
            onChange={(event) => onHorizonChange(Number(event.target.value))}
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
          >
            {signalStatisticsHorizonOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Period</span>
          <select
            value={sinceMs}
            onChange={(event) => onSinceChange(Number(event.target.value))}
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
          >
            {signalStatisticsPeriodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Limit</span>
          <select
            value={limit}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none transition focus:border-accent/60"
          >
            {signalStatisticsLimitOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-2 md:col-span-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Last statistics update
          </div>
          <div className="mt-1 text-sm text-slate-200">
            {updatedAt ? formatClock(updatedAt) : "waiting for backend response"}
          </div>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
        <SignalStatisticsMetric label="Signals" value={String(summary?.total_signals ?? 0)} />
        <SignalStatisticsMetric label="Outcomes" value={String(summary?.total_outcomes ?? 0)} />
        <SignalStatisticsMetric
          label="Win rate"
          value={formatStatsPercent(summary?.win_rate_pct)}
          className={winRateClasses(summary?.win_rate_pct)}
        />
        <SignalStatisticsMetric
          label="Avg favorable"
          value={formatStatsMove(summary?.avg_favorable_pct)}
          className="text-positive"
        />
        <SignalStatisticsMetric
          label="Avg adverse"
          value={formatStatsMove(-(summary?.avg_adverse_pct ?? 0))}
          className="text-negative"
        />
        <SignalStatisticsMetric
          label="Avg end move"
          value={formatStatsMove(summary?.avg_end_move_pct)}
          className={biasColor(summary?.avg_end_move_pct ?? 0)}
        />
        <SignalStatisticsMetric
          label="Best move"
          value={formatStatsMove(summary?.best_move_pct)}
          className="text-positive"
        />
        <SignalStatisticsMetric
          label="Worst move"
          value={formatStatsMove(summary?.worst_move_pct)}
          className="text-negative"
        />
      </div>

      {!hasData ? (
        <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-slate-400">
          No signal statistics yet. Keep backend running until outcomes are collected.
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <SignalStatisticsBucketTable
              title="By setup type"
              keyLabel="setupType"
              rows={statistics?.bySetupType ?? []}
              kind="setup"
            />
            <SignalStatisticsBucketTable
              title="By opportunity verdict"
              keyLabel="verdict"
              rows={statistics?.byOpportunityVerdict ?? []}
              kind="verdict"
            />
            <SignalStatisticsBucketTable
              title="By DNT action"
              keyLabel="action"
              rows={statistics?.byDoNotTradeAction ?? []}
              kind="dnt"
            />
            <SignalStatisticsBucketTable
              title="By DNT severity"
              keyLabel="severity"
              rows={statistics?.byDoNotTradeSeverity ?? []}
              kind="dnt"
            />
            <SignalStatisticsBucketTable
              title="By alert priority"
              keyLabel="priority"
              rows={statistics?.byAlertPriority ?? []}
              kind="alert"
            />
          </div>

          <SignalStatisticsBucketTable
            title="By symbol"
            keyLabel="symbol"
            rows={statistics?.bySymbol ?? []}
            kind="symbol"
            compact
          />

          <SignalStatisticsRecentTable rows={statistics?.recentOutcomes ?? []} onReplay={onReplay} />
        </>
      )}
    </div>
  );
}

function SignalStatisticsMetric({
  label,
  value,
  className
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-3">
      <div className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className={`mt-1 truncate text-lg font-semibold text-slate-100 ${className ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function SignalStatisticsBucketTable({
  title,
  keyLabel,
  rows,
  kind,
  compact = false
}: {
  title: string;
  keyLabel: string;
  rows: SignalStatisticsBucket[];
  kind: "setup" | "verdict" | "dnt" | "alert" | "symbol";
  compact?: boolean;
}) {
  const visibleRows = compact ? rows.slice(0, 12) : rows.slice(0, 8);

  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      {visibleRows.length === 0 ? (
        <p className="text-xs text-slate-500">No completed outcomes in this slice.</p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <HeaderCell>{keyLabel}</HeaderCell>
                <HeaderCell>Outcomes</HeaderCell>
                <HeaderCell>Win</HeaderCell>
                <HeaderCell>Fav</HeaderCell>
                <HeaderCell>Adv</HeaderCell>
                <HeaderCell>End</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleRows.map((row) => (
                <tr key={`${title}-${row.key}`}>
                  <Cell>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                        kind === "verdict"
                          ? opportunityVerdictClasses(row.key)
                          : kind === "setup"
                            ? setupTypeClasses(row.key)
                            : kind === "dnt"
                              ? doNotTradeClasses(row.key)
                              : kind === "alert"
                                ? alertPriorityClasses(row.key)
                                : "border-white/10 bg-white/5 text-slate-200"
                      }`}
                    >
                      {row.key}
                    </span>
                  </Cell>
                  <Cell>{row.total_outcomes}</Cell>
                  <Cell className={winRateClasses(row.win_rate_pct)}>
                    {formatStatsPercent(row.win_rate_pct)}
                  </Cell>
                  <Cell className="text-positive">{formatStatsMove(row.avg_favorable_pct)}</Cell>
                  <Cell className="text-negative">{formatStatsMove(-row.avg_adverse_pct)}</Cell>
                  <Cell className={biasColor(row.avg_end_move_pct)}>
                    {formatStatsMove(row.avg_end_move_pct)}
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SignalStatisticsRecentTable({
  rows,
  onReplay
}: {
  rows: SignalStatisticsRecentOutcome[];
  onReplay: (signalId: string) => boolean;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
        Recent outcomes
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No recent completed outcomes for these filters.</p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <HeaderCell>Time</HeaderCell>
                <HeaderCell>Symbol</HeaderCell>
                <HeaderCell>Type</HeaderCell>
                <HeaderCell>Setup</HeaderCell>
                <HeaderCell>Verdict</HeaderCell>
                <HeaderCell>Priority</HeaderCell>
                <HeaderCell>DNT</HeaderCell>
                <HeaderCell>Horizon</HeaderCell>
                <HeaderCell>End</HeaderCell>
                <HeaderCell>Fav</HeaderCell>
                <HeaderCell>Adv</HeaderCell>
                <HeaderCell>Sizing</HeaderCell>
                <HeaderCell>Replay</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.slice(0, 18).map((row) => (
                <tr key={`${row.signalId}-${row.horizonSec}-${row.outcomeCreatedAt}`}>
                  <Cell>{formatClock(row.outcomeCreatedAt)}</Cell>
                  <Cell className="font-medium text-slate-100">{row.symbol}</Cell>
                  <Cell>{row.type}</Cell>
                  <Cell>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${setupTypeClasses(
                        row.setupType
                      )}`}
                    >
                      {row.setupType ?? "UNKNOWN"}
                    </span>
                  </Cell>
                  <Cell>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${opportunityVerdictClasses(
                        row.opportunityVerdict
                      )}`}
                    >
                      {row.opportunityVerdict ?? "UNKNOWN"}
                    </span>
                  </Cell>
                  <Cell>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${alertPriorityClasses(
                        row.alertPriority
                      )}`}
                    >
                      {row.alertPriority ?? "UNKNOWN"}
                    </span>
                  </Cell>
                  <Cell>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${doNotTradeClasses(
                        row.doNotTradeAction
                      )}`}
                    >
                      {row.doNotTradeAction ?? "UNKNOWN"}
                    </span>
                  </Cell>
                  <Cell>{row.horizonSec}s</Cell>
                  <Cell className={biasColor(row.endMovePct)}>{formatStatsMove(row.endMovePct)}</Cell>
                  <Cell className="text-positive">{formatStatsMove(row.maxFavorablePct)}</Cell>
                  <Cell className="text-negative">{formatStatsMove(-row.maxAdversePct)}</Cell>
                  <Cell>
                    {row.recommendedNotional !== null ? (
                      <div className="space-y-0.5">
                        <div className="font-medium text-slate-100">
                          {formatSizingCurrency(row.recommendedNotional)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {formatSizingQty(row.normalizedQty ?? row.recommendedQty)} @ {formatSizingLeverage(row.suggestedLeverage)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-500">Not enough data</span>
                    )}
                  </Cell>
                  <Cell>
                    <button
                      type="button"
                      onClick={() => onReplay(row.signalId)}
                      className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-accent transition hover:border-accent/60 hover:text-white"
                    >
                      Replay
                    </button>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const isReplayRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const replayString = (value: unknown, key: string): string | null => {
  if (!isReplayRecord(value)) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
};

const replayNumber = (value: unknown, key: string): number | null => {
  if (!isReplayRecord(value)) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
};

const replayBoolean = (value: unknown, key: string): boolean | null => {
  if (!isReplayRecord(value)) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === "boolean" ? candidate : null;
};

const replayStringList = (value: unknown, key: string): string[] => {
  if (!isReplayRecord(value) || !Array.isArray(value[key])) {
    return [];
  }

  return value[key].filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
};

const replayDoNotTrade = (value: unknown): DoNotTradeResult | null => {
  if (!isReplayRecord(value)) {
    return null;
  }

  const severity = replayString(value, "severity");
  const action = replayString(value, "action");
  const allowed = value.allowed;

  if (typeof allowed !== "boolean" || !severity || !action) {
    return null;
  }

  return {
    allowed,
    severity:
      severity === "OK" || severity === "CAUTION" || severity === "BLOCKED" || severity === "EMERGENCY"
        ? severity
        : "BLOCKED",
    action:
      action === "ALLOW" || action === "REDUCE_SIZE" || action === "WAIT" || action === "BLOCK"
        ? action
        : "BLOCK",
    reasons: replayStringList(value, "reasons"),
    blockers: replayStringList(value, "blockers"),
    warnings: replayStringList(value, "warnings"),
    cooldownSec: replayNumber(value, "cooldownSec") ?? 0,
    tags: replayStringList(value, "tags")
  };
};

const replayPositionSizing = (value: unknown): PositionSizingResult | null => {
  if (!isReplayRecord(value)) {
    return null;
  }

  const symbol = replayString(value, "symbol");
  const recommendedNotional = replayNumber(value, "recommendedNotional");

  if (!symbol || recommendedNotional === null) {
    return null;
  }

  return {
    symbol,
    direction:
      replayString(value, "direction") === "long" || replayString(value, "direction") === "short"
        ? (replayString(value, "direction") as "long" | "short")
        : "unknown",
    recommendedNotional,
    maxNotional: replayNumber(value, "maxNotional") ?? 0,
    recommendedQty: replayNumber(value, "recommendedQty") ?? 0,
    rawQty: replayNumber(value, "rawQty") ?? 0,
    normalizedQty: replayNumber(value, "normalizedQty") ?? replayNumber(value, "recommendedQty") ?? 0,
    minQty: replayNumber(value, "minQty"),
    stepSize: replayNumber(value, "stepSize"),
    minNotional: replayNumber(value, "minNotional"),
    suggestedLeverage: replayNumber(value, "suggestedLeverage") ?? 0,
    riskPerTradePct: replayNumber(value, "riskPerTradePct") ?? 0,
    stopDistancePct: replayNumber(value, "stopDistancePct") ?? 0,
    liquidationBufferPct: replayNumber(value, "liquidationBufferPct"),
    confidence: replayNumber(value, "confidence") ?? 0,
    riskLevel:
      replayString(value, "riskLevel") === "LOW" ||
      replayString(value, "riskLevel") === "MEDIUM" ||
      replayString(value, "riskLevel") === "HIGH" ||
      replayString(value, "riskLevel") === "EXTREME"
        ? (replayString(value, "riskLevel") as PositionSizingResult["riskLevel"])
        : "EXTREME",
    reasons: replayStringList(value, "reasons"),
    warnings: replayStringList(value, "warnings"),
    exchangeFilterWarnings: replayStringList(value, "exchangeFilterWarnings"),
    constraints: replayStringList(value, "constraints"),
    doNotTrade: replayDoNotTrade(value.doNotTrade)
  };
};

const formatReplayNumber = (value: number | null | undefined, suffix = ""): string =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : "--";

const formatSizingCurrency = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} USDT` : "--";

const formatSizingQty = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : "--";

const formatSizingLeverage = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}x` : "--";

const formatReplayPercent = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${(value <= 1 ? value * 100 : value).toFixed(2)}%`;
};

const getReplayOutcomeEndMovePct = (outcome: SignalOutcomeRecord): number | null => {
  const storedMove = replayNumber(outcome.outcome, "endMovePct");

  if (storedMove !== null) {
    return storedMove;
  }

  if (
    typeof outcome.startPrice === "number" &&
    Number.isFinite(outcome.startPrice) &&
    outcome.startPrice > 0 &&
    typeof outcome.endPrice === "number" &&
    Number.isFinite(outcome.endPrice)
  ) {
    return ((outcome.endPrice - outcome.startPrice) / outcome.startPrice) * 100;
  }

  return null;
};

function SignalReplayModal({
  replay,
  loading,
  error,
  onCreateJournalEntry,
  onClose
}: {
  replay: SignalReplayPayload | null;
  loading: boolean;
  error: string | null;
  onCreateJournalEntry: (input: CreateJournalEntryInput) => void;
  onClose: () => void;
}) {
  const signal = replay?.signal ?? null;
  const setup = replay?.setupClassification ?? null;
  const opportunity = replay?.opportunityScore ?? null;
  const alertRanking = replay?.alertRanking ?? null;
  const positionSizing = replayPositionSizing(replay?.positionSizing ?? null);
  const doNotTrade = replayDoNotTrade(replay?.doNotTrade ?? null);
  const setupType = replayString(setup, "setupType") ?? signal?.setupType ?? "UNKNOWN";
  const setupConfidence = replayNumber(setup, "confidence") ?? signal?.setupConfidence ?? null;
  const setupDirection = replayString(setup, "direction") ?? signal?.setupDirection ?? "unknown";
  const opportunityVerdict =
    replayString(opportunity, "verdict") ?? signal?.opportunityVerdict ?? "UNKNOWN";
  const alertPriority = replayString(alertRanking, "priority") ?? signal?.alertPriority ?? "UNKNOWN";
  const inferredSide: JournalEntrySide | null =
    setupDirection.toLowerCase().includes("short") || signal?.type.toLowerCase().includes("short")
      ? "short"
      : setupDirection.toLowerCase().includes("long") || signal?.type.toLowerCase().includes("long")
        ? "long"
        : null;
  const createJournalFromReplay = () => {
    if (!signal) {
      return;
    }

    onCreateJournalEntry({
      signalId: signal.id,
      symbol: signal.symbol,
      side: inferredSide,
      entryPrice: signal.price,
      notes: `Signal replay: setup ${setupType}; opportunity ${opportunityVerdict}`,
      tags: normalizeJournalTags([setupType, opportunityVerdict, signal.type])
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 px-3 py-6 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-lg border border-white/10 bg-panel p-4 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-accent">Signal Replay</div>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {signal ? `${signal.symbol} ${signal.type}` : "Replay details"}
            </h2>
            <p className="text-xs text-slate-500">
              {signal ? `${signal.source ?? "unknown source"} / ${formatClock(signal.createdAt)}` : "Waiting for replay data"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {signal ? (
              <button
                type="button"
                onClick={createJournalFromReplay}
                className="rounded-md border border-positive/30 bg-positive/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-positive transition hover:border-positive/60 hover:text-white"
              >
                Create Journal Entry
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-slate-300 transition hover:border-accent/40 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-slate-400">
            Loading replay context...
          </div>
        ) : error ? (
          <div className="mt-4 rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
            {error}
          </div>
        ) : replay && signal ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <SignalReplaySection title="Signal header">
              <div className="grid gap-2 sm:grid-cols-3">
                <SignalReplayMetric label="Symbol" value={signal.symbol} />
                <SignalReplayMetric label="Type" value={signal.type} />
                <SignalReplayMetric label="Source" value={signal.source ?? "--"} />
                <SignalReplayMetric label="Severity" value={signal.severity ?? "--"} />
                <SignalReplayMetric label="Price" value={formatReplayNumber(signal.price)} />
                <SignalReplayMetric label="Time" value={formatClock(signal.createdAt)} />
              </div>
            </SignalReplaySection>

            <SignalReplaySection title="Setup">
              <div className="grid gap-2 sm:grid-cols-3">
                <SignalReplayMetric label="Setup type" value={setupType} />
                <SignalReplayMetric label="Confidence" value={formatReplayPercent(setupConfidence)} />
                <SignalReplayMetric label="Direction" value={setupDirection} />
              </div>
              <SignalReplayList title="Reasons" items={replayStringList(setup, "reasons")} />
            </SignalReplaySection>

            <SignalReplaySection title="Opportunity">
              <div className="grid gap-2 sm:grid-cols-4">
                <SignalReplayMetric label="Verdict" value={opportunityVerdict} />
                <SignalReplayMetric label="Score" value={formatReplayNumber(replayNumber(opportunity, "score"))} />
                <SignalReplayMetric label="Confidence" value={formatReplayPercent(replayNumber(opportunity, "confidence"))} />
                <SignalReplayMetric label="Risk" value={replayString(opportunity, "riskLevel") ?? signal.opportunityRiskLevel ?? "--"} />
                <SignalReplayMetric label="TTL" value={`${replayNumber(opportunity, "ttlSec") ?? "--"}s`} />
                <SignalReplayMetric label="Expected move" value={formatReplayNumber(replayNumber(opportunity, "expectedMovePct"), "%")} />
              </div>
              <SignalReplayList title="Reasons" items={replayStringList(opportunity, "reasons")} />
              <SignalReplayList title="Warnings" items={replayStringList(opportunity, "warnings")} />
              <SignalReplayList title="Invalidation" items={replayStringList(opportunity, "invalidationHints")} />
            </SignalReplaySection>

            <SignalReplaySection title="Do Not Trade Check">
              <DoNotTradeCheck result={doNotTrade} />
            </SignalReplaySection>

            <SignalReplaySection title="Alert Ranking">
              <div className="grid gap-2 sm:grid-cols-4">
                <SignalReplayMetric label="Priority" value={alertPriority} />
                <SignalReplayMetric
                  label="Rank score"
                  value={formatReplayNumber(replayNumber(alertRanking, "rankScore") ?? signal.alertRankScore)}
                />
                <SignalReplayMetric
                  label="Suppress"
                  value={
                    (replayBoolean(alertRanking, "suppress") ?? signal.alertSuppress) === true
                      ? "YES"
                      : "NO"
                  }
                />
                <SignalReplayMetric label="TTL" value={`${replayNumber(alertRanking, "ttlSec") ?? "--"}s`} />
              </div>
              <SignalReplayList title="Reasons" items={replayStringList(alertRanking, "reasons")} />
              <SignalReplayList
                title="Suppress reason"
                items={
                  replayString(alertRanking, "suppressReason")
                    ? [replayString(alertRanking, "suppressReason") as string]
                    : []
                }
              />
              <SignalReplayList title="Tags" items={replayStringList(alertRanking, "tags")} />
            </SignalReplaySection>

            <SignalReplaySection title="Position sizing">
              {positionSizing ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <SignalReplayMetric
                      label="Recommended"
                      value={formatSizingCurrency(positionSizing.recommendedNotional)}
                    />
                    <SignalReplayMetric
                      label="Max notional"
                      value={formatSizingCurrency(positionSizing.maxNotional)}
                    />
                    <SignalReplayMetric
                      label="Qty"
                      value={formatSizingQty(positionSizing.recommendedQty)}
                    />
                    <SignalReplayMetric
                      label="Raw qty"
                      value={formatSizingQty(positionSizing.rawQty)}
                    />
                    <SignalReplayMetric
                      label="Normalized qty"
                      value={formatSizingQty(positionSizing.normalizedQty)}
                    />
                    <SignalReplayMetric
                      label="Step size"
                      value={formatSizingQty(positionSizing.stepSize)}
                    />
                    <SignalReplayMetric
                      label="Min qty"
                      value={formatSizingQty(positionSizing.minQty)}
                    />
                    <SignalReplayMetric
                      label="Min notional"
                      value={formatSizingCurrency(positionSizing.minNotional)}
                    />
                    <SignalReplayMetric
                      label="Leverage"
                      value={formatSizingLeverage(positionSizing.suggestedLeverage)}
                    />
                    <SignalReplayMetric
                      label="Risk / trade"
                      value={formatReplayNumber(positionSizing.riskPerTradePct, "%")}
                    />
                    <SignalReplayMetric
                      label="Stop distance"
                      value={formatReplayNumber(positionSizing.stopDistancePct, "%")}
                    />
                    <SignalReplayMetric
                      label="Liq buffer"
                      value={formatReplayNumber(positionSizing.liquidationBufferPct, "%")}
                    />
                    <SignalReplayMetric label="Risk level" value={positionSizing.riskLevel} />
                    <SignalReplayMetric
                      label="Confidence"
                      value={formatReplayNumber(positionSizing.confidence, "%")}
                    />
                  </div>
                  <SignalReplayList title="Reasons" items={positionSizing.reasons} />
                  <SignalReplayList title="Warnings" items={positionSizing.warnings} />
                  <SignalReplayList title="Filter warnings" items={positionSizing.exchangeFilterWarnings} />
                  <SignalReplayList title="Constraints" items={positionSizing.constraints} />
                </>
              ) : (
                <p className="text-xs text-slate-500">Not enough data.</p>
              )}
            </SignalReplaySection>

            <SignalReplaySection title="Timeline">
              <div className="space-y-2">
                {replay.timeline.map((entry) => (
                  <div key={`${entry.label}-${entry.horizonSec ?? "signal"}`} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs">
                    <div>
                      <div className="font-medium text-slate-100">{entry.label} {entry.type === "signal" ? "Signal" : "outcome"}</div>
                      <div className="text-slate-500">{entry.timestamp ? formatClock(entry.timestamp) : "pending"}</div>
                    </div>
                    {entry.outcome ? (
                      <div className={biasColor(getReplayOutcomeEndMovePct(entry.outcome) ?? 0)}>
                        {formatStatsMove(getReplayOutcomeEndMovePct(entry.outcome))}
                      </div>
                    ) : (
                      <div className="text-slate-500">--</div>
                    )}
                  </div>
                ))}
              </div>
            </SignalReplaySection>

            <SignalReplaySection title="Outcomes" wide>
              {replay.outcomes.length === 0 ? (
                <p className="text-xs text-slate-500">No completed outcomes yet.</p>
              ) : (
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <HeaderCell>Horizon</HeaderCell>
                        <HeaderCell>End</HeaderCell>
                        <HeaderCell>Fav</HeaderCell>
                        <HeaderCell>Adv</HeaderCell>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {replay.outcomes.map((outcome) => (
                        <tr key={`${outcome.id}-${outcome.horizonSec}`}>
                          <Cell>{outcome.horizonSec}s</Cell>
                          <Cell className={biasColor(getReplayOutcomeEndMovePct(outcome) ?? 0)}>
                            {formatStatsMove(getReplayOutcomeEndMovePct(outcome))}
                          </Cell>
                          <Cell className="text-positive">{formatStatsMove(outcome.maxFavorablePct)}</Cell>
                          <Cell className="text-negative">{formatStatsMove(-(outcome.maxAdversePct ?? 0))}</Cell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SignalReplaySection>

            <SignalReplaySection title="Features" wide>
              {replay.features ? (
                <pre className="max-h-80 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-slate-300 scrollbar-thin">
                  {JSON.stringify(replay.features, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-slate-500">No feature snapshot stored for this signal.</p>
              )}
            </SignalReplaySection>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-slate-400">
            Select Replay from Recent outcomes to inspect a signal.
          </div>
        )}
      </div>
    </div>
  );
}

function SignalReplaySection({
  title,
  wide = false,
  children
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-white/10 bg-black/20 p-3 ${wide ? "xl:col-span-2" : ""}`}>
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      {children}
    </section>
  );
}

function SignalReplayMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-white/5 px-3 py-2">
      <div className="truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-xs font-medium text-slate-100">{value}</div>
    </div>
  );
}

function DoNotTradeCheck({ result }: { result: DoNotTradeResult | null | undefined }) {
  if (!result) {
    return <p className="text-xs text-slate-500">Not enough data.</p>;
  }

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-4">
        <SignalReplayMetric label="Allowed" value={result.allowed ? "YES" : "NO"} />
        <SignalReplayMetric label="Severity" value={result.severity} />
        <SignalReplayMetric label="Action" value={result.action} />
        <SignalReplayMetric label="Cooldown" value={`${result.cooldownSec}s`} />
      </div>
      <SignalReplayList title="Reasons" items={result.reasons} />
      <SignalReplayList title="Blockers" items={result.blockers} />
      <SignalReplayList title="Warnings" items={result.warnings} />
      <SignalReplayList title="Tags" items={result.tags} />
    </>
  );
}

function SignalReplayList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{title}</div>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-slate-300">
          {items.map((item) => (
            <li key={item} className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No data.</p>
      )}
    </div>
  );
}

function MobileScreenerCard({
  row,
  activeTradeSet,
  accountPositionSet,
  watchlistSet,
  onToggleActiveTrade,
  onToggleWatchlist
}: {
  row: ScreenerRow;
  activeTradeSet: Set<string>;
  accountPositionSet: Set<string>;
  watchlistSet: Set<string>;
  onToggleActiveTrade: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
}) {
  const isManualActive = activeTradeSet.has(row.symbol);
  const isWatched = watchlistSet.has(row.symbol);

  return (
    <article
      className={`rounded-lg border p-3 ${
        row.isActiveTrade
          ? "border-caution/30 bg-caution/10"
          : row.isWatchlist
            ? "border-accent/20 bg-accent/5"
            : "border-white/10 bg-black/20"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-lg font-semibold text-white">{row.symbol}</h3>
            {row.isFocus ? (
              <span className="rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-positive">
                focus
              </span>
            ) : null}
            {accountPositionSet.has(row.symbol) ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-200">
                account
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {formatPrice(row.lastPrice)} | {compactUsd(row.quoteVolume24h)} 24h
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
            row.bias === "LONG"
              ? "bg-positive/10 text-positive"
              : row.bias === "SHORT"
                ? "bg-negative/10 text-negative"
                : "bg-white/5 text-slate-300"
          }`}
        >
          {row.bias}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MobileMetric label="Score" value={row.score.toFixed(1)} className={scoreColor(row.score)} />
        <MobileMetric
          label="30s"
          value={formatPercent(row.momentum30sPct, 2)}
          className={biasColor(row.momentum30sPct)}
        />
        <MobileMetric
          label="2m"
          value={formatPercent(row.momentum2mPct, 2)}
          className={biasColor(row.momentum2mPct)}
        />
        <MobileMetric label="Impulse" value={`${row.volumeImpulse.toFixed(2)}x`} />
        <MobileMetric label="Buy" value={`${(row.buyRatio60s * 100).toFixed(1)}%`} />
        <MobileMetric label="Liq 5m" value={compactUsd(row.liquidation5m)} />
      </div>

      {row.tags.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {row.tags.slice(0, 5).map((tag) => (
            <span
              key={`${row.symbol}-${tag}`}
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${tagClass(
                tag
              )}`}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onToggleActiveTrade(row.symbol)}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            isManualActive
              ? "border-caution/40 bg-caution/10 text-caution"
              : "border-white/10 bg-white/5 text-slate-300"
          }`}
        >
          {isManualActive ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          onClick={() => onToggleWatchlist(row.symbol)}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            isWatched
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-white/10 bg-white/5 text-slate-300"
          }`}
        >
          {isWatched ? "Unwatch" : "Watch"}
        </button>
      </div>
    </article>
  );
}

function MobileMetric({
  label,
  value,
  className
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-2 py-2">
      <div className="truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-semibold text-slate-100 ${className ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function OverviewCard({
  title,
  value,
  detail
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-panel p-3 shadow-panel">
      <div className="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {title}
      </div>
      <div className="mt-1 truncate text-xl font-semibold text-white">{value}</div>
      <div className="mt-0.5 truncate text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs text-slate-200">{value}</div>
    </div>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-3">
      <div>
        <div className="text-sm font-medium text-slate-100">{label}</div>
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-black/20"
      />
    </label>
  );
}

function VoiceProfileChip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] transition ${
        active
          ? "border-accent/50 bg-accent/15 text-white"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-accent/40 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function VoiceProfileCard({
  profile,
  active,
  onClick
}: {
  profile: VoiceProfilePreset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-3 text-left transition ${
        active
          ? "border-accent/50 bg-accent/10 text-white"
          : "border-white/10 bg-white/5 text-slate-200 hover:border-accent/35 hover:bg-accent/5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{profile.label}</div>
        <div
          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
            active ? "bg-white/10 text-white" : "bg-black/20 text-slate-400"
          }`}
        >
          {active ? "active" : profile.badgeLabel}
        </div>
      </div>
      <div className="mt-1 text-xs text-slate-500">{profile.detail}</div>
    </button>
  );
}

function PanelToggleButton({
  collapsed,
  onClick
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={!collapsed}
      className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300 transition hover:border-accent/40 hover:text-white"
    >
      {collapsed ? "Show" : "Hide"}
    </button>
  );
}

function HeaderCell({ children }: { children: ReactNode }) {
  return <th className="px-3 py-3 text-left font-medium">{children}</th>;
}

function Cell({
  children,
  className,
  colSpan
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-3 text-slate-200 ${className ?? ""}`}>
      {children}
    </td>
  );
}
