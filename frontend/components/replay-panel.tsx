"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DecisionReplayEvent,
  DecisionReplayPayload,
  SignalReplayPayload
} from "@/lib/types";
import { ReplayTimelineChart } from "./replay-timeline-chart";
import { LearningModeHelp } from "./learning-mode-help";
import { EmptyState } from "./ui/empty-state";
import { PanelHeader } from "./ui/panel-header";

type ReplayStatus = "idle" | "loading" | "error" | "loaded";
type DecisionReplayLookupMode = "reviewId" | "positionLifecycleId";

interface ReplayPanelProps {
  signalId: string | null;
  replayData: SignalReplayPayload | null;
  status: ReplayStatus;
  error: string | null;
  onRequestReplay: (signalId: string) => void;
  decisionReplayData?: DecisionReplayPayload | null;
  decisionReplayStatus?: ReplayStatus;
  decisionReplayError?: string | null;
  decisionReplaySeed?: {
    mode: DecisionReplayLookupMode;
    value: string;
  } | null;
  onRequestDecisionReplay?: (payload: {
    reviewId?: string | null;
    positionLifecycleId?: string | null;
  }) => boolean;
  onCopyText?: (text: string) => Promise<boolean>;
  learningMode: boolean;
}

const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatReplayTimestamp = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "No timestamp";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid timestamp";
  }

  return date.toLocaleString();
};

const decisionReplayTypeLabels: Record<DecisionReplayEvent["type"], string> = {
  SIGNAL: "Signal",
  DECISION: "Decision",
  ORDER: "Order",
  POSITION_EVENT: "Position Event",
  REVIEW: "Review",
  MISSING_LINK: "Missing Link"
};

const lookupModeLabels: Record<DecisionReplayLookupMode, string> = {
  reviewId: "reviewId",
  positionLifecycleId: "positionLifecycleId"
};

type ReplaySummaryTone = "positive" | "caution" | "neutral";

const formatSignedReplayPercent = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const replaySummaryToneClasses = (tone: ReplaySummaryTone): string => {
  if (tone === "positive") {
    return "border-positive/30 bg-positive/10 text-positive";
  }

  if (tone === "caution") {
    return "border-caution/30 bg-caution/10 text-caution";
  }

  return "border-white/10 bg-black/20 text-slate-300";
};

function ReplayMeaningSummary({
  title,
  subtitle,
  badge,
  badgeClass,
  items
}: {
  title: string;
  subtitle: string;
  badge?: string | null;
  badgeClass?: string;
  items: Array<{ tone: ReplaySummaryTone; text: string }>;
}) {
  return (
    <div className="rounded-lg border border-accent/25 bg-accent/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-accent">What Happened?</div>
          <div className="mt-1 text-sm font-medium text-slate-100">{title}</div>
          <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
        </div>
        {badge ? (
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${
              badgeClass ?? "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={`${title}:${item.text}`}
            className={`rounded-md border px-3 py-2 text-sm ${replaySummaryToneClasses(item.tone)}`}
          >
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}

const buildSignalReplaySummary = (replayData: SignalReplayPayload) => {
  const { signal, outcomes } = replayData;
  const bestFavorable = outcomes.reduce<number | null>(
    (currentBest, outcome) =>
      typeof outcome.maxFavorablePct === "number" &&
      Number.isFinite(outcome.maxFavorablePct) &&
      (currentBest === null || outcome.maxFavorablePct > currentBest)
        ? outcome.maxFavorablePct
        : currentBest,
    null
  );
  const worstAdverse = outcomes.reduce<number | null>(
    (currentWorst, outcome) =>
      typeof outcome.maxAdversePct === "number" &&
      Number.isFinite(outcome.maxAdversePct) &&
      (currentWorst === null || outcome.maxAdversePct > currentWorst)
        ? outcome.maxAdversePct
        : currentWorst,
    null
  );
  const conviction =
    signal.opportunityConfidence ?? signal.setupConfidence ?? signal.opportunityScore ?? signal.score;
  const summaryItems: Array<{ tone: ReplaySummaryTone; text: string }> = [];

  summaryItems.push({
    tone:
      signal.setupDirection === "LONG"
        ? "positive"
        : signal.setupDirection === "SHORT"
          ? "caution"
          : "neutral",
    text: signal.setupDirection
      ? `${signal.symbol} was recorded as a ${signal.setupDirection} setup.`
      : `${signal.symbol} was recorded as a ${signal.type} signal.`
  });

  if (typeof conviction === "number" && Number.isFinite(conviction)) {
    summaryItems.push({
      tone: conviction >= 70 ? "positive" : conviction >= 40 ? "neutral" : "caution",
      text: `Recorded conviction was ${Math.round(conviction)}/100 at signal time.`
    });
  }

  if (bestFavorable !== null) {
    summaryItems.push({
      tone: bestFavorable > 0 ? "positive" : "neutral",
      text: `Best follow-through reached ${formatSignedReplayPercent(bestFavorable)} during the replay window.`
    });
  }

  if (worstAdverse !== null) {
    summaryItems.push({
      tone: worstAdverse >= 1 ? "caution" : "neutral",
      text: `Largest pullback reached -${Math.abs(worstAdverse).toFixed(2)}% before the window ended.`
    });
  }

  if (summaryItems.length < 4) {
    summaryItems.push({
      tone: "neutral",
      text:
        replayData.timeline.length > 1
          ? `${replayData.timeline.length - 1} outcome checkpoints were saved for later review.`
          : "Outcome checkpoints are still limited for this replay."
    });
  }

  return {
    title: signal.setupType ? `${signal.setupType} replay summary` : `${signal.symbol} replay summary`,
    subtitle: "Quick read first. Raw replay details stay below.",
    badge: signal.opportunityVerdict ?? signal.setupDirection ?? signal.type,
    badgeClass:
      signal.setupDirection === "LONG"
        ? "border-positive/30 bg-positive/10 text-positive"
        : signal.setupDirection === "SHORT"
          ? "border-negative/30 bg-negative/10 text-negative"
          : "border-white/10 bg-white/5 text-slate-300",
    items: summaryItems.slice(0, 4)
  };
};

const buildDecisionReplaySummary = (replayData: DecisionReplayPayload) => {
  const decision = replayData.chain.tradeDecisionContext?.decision ?? null;
  const lifecycleStatus = replayData.chain.positionLifecycle?.status ?? null;
  const orderCount = replayData.chain.orders.length;
  const lifecycleEventCount = replayData.chain.positionLifecycleEvents.length;
  const missingLinks = replayData.summary.missingLinks;
  const items: Array<{ tone: ReplaySummaryTone; text: string }> = [];

  if (decision) {
    items.push({
      tone: decision === "ENTER" ? "positive" : decision === "WAIT" ? "caution" : "neutral",
      text:
        decision === "ENTER"
          ? "The recorded plan was to enter the trade."
          : decision === "WAIT"
            ? "The recorded plan was to wait for cleaner confirmation."
            : "The recorded plan was to skip the trade."
    });
  }

  if (lifecycleStatus) {
    items.push({
      tone: lifecycleStatus === "CLOSED" ? "positive" : lifecycleStatus === "ERROR" ? "caution" : "neutral",
      text: `The trade lifecycle reached ${lifecycleStatus.toLowerCase()}.`
    });
  }

  items.push({
    tone: orderCount > 0 || lifecycleEventCount > 0 ? "neutral" : "caution",
    text: `${orderCount} order record${orderCount === 1 ? "" : "s"} and ${lifecycleEventCount} lifecycle event${lifecycleEventCount === 1 ? "" : "s"} were captured.`
  });

  items.push({
    tone: replayData.summary.reviewPresent ? "positive" : "caution",
    text: replayData.summary.reviewPresent
      ? "A saved review is attached to this trade chain."
      : "A saved review is still missing from this trade chain."
  });

  if (missingLinks.length > 0) {
    items.push({
      tone: "caution",
      text: `Replay is still missing ${missingLinks.join(", ")}.`
    });
  }

  return {
    title:
      lifecycleStatus === "CLOSED"
        ? "Trade chain replay is complete enough to review."
        : "Trade chain replay shows the recorded execution path.",
    subtitle: "Start with the story, then inspect the event trail underneath.",
    badge: missingLinks.length > 0 ? "Needs Follow-up" : "Chain Connected",
    badgeClass:
      missingLinks.length > 0
        ? "border-caution/30 bg-caution/10 text-caution"
        : "border-positive/30 bg-positive/10 text-positive",
    items: items.slice(0, 5)
  };
};

function SignalReplayContent({
  signalId,
  replayData,
  status,
  error,
  onRequestReplay,
  learningMode
}: Pick<
  ReplayPanelProps,
  "signalId" | "replayData" | "status" | "error" | "onRequestReplay" | "learningMode"
>) {
  if (!signalId) {
    return (
      <div>
        <PanelHeader title="Decision Replay" subtitle="Select a review or signal context to replay" moduleId="replay" />
        <EmptyState
          className="mt-3"
          title="No signal selected"
          description='Open Decision Replay from a review, or enter a signal ID above'
        />
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div>
        <PanelHeader title="Decision Replay" subtitle="Loading replay data..." moduleId="replay" />
        <EmptyState
          className="mt-3"
          title={`Loading replay data for signal ${signalId}...`}
          description="This may take a moment"
        />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div>
        <PanelHeader title="Decision Replay" subtitle="Error loading replay data" moduleId="replay" />
        <EmptyState
          className="mt-3"
          tone="negative"
          title="Failed to load replay data"
          description={error || "Unknown error"}
          action={
            <button
              type="button"
              onClick={() => onRequestReplay(signalId)}
              className="rounded-md border border-negative/30 bg-negative/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-negative transition hover:border-negative/60 hover:bg-negative/20"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  if (!replayData) {
    return (
      <div>
        <PanelHeader title="Decision Replay" subtitle="No replay data available" moduleId="replay" />
        <EmptyState
          className="mt-3"
          title={`No replay data available for signal ${signalId}`}
          description="The signal may not have been recorded yet or data is unavailable"
          action={
            <button
              type="button"
              onClick={() => onRequestReplay(signalId)}
              className="rounded-md border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.1]"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  const {
    signal,
    timeline,
    setupClassification,
    opportunityScore,
    positionSizing,
    doNotTrade,
    alertRanking
  } = replayData;
  const hasTimelineData =
    timeline && timeline.length > 0 && timeline.some((entry) => entry.outcome !== null);
  const summary = buildSignalReplaySummary(replayData);

  return (
    <div>
      <PanelHeader
        title="Decision Replay"
        subtitle={`${signal.symbol} / ${new Date(signal.createdAt).toLocaleString()}`}
        moduleId="replay"
      />

      <LearningModeHelp moduleId="replay" learningMode={learningMode} />

      <div className="mt-3 space-y-3">
        <ReplayMeaningSummary {...summary} />

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Signal Metadata
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500">Type:</span>{" "}
              <span className="text-slate-300">{signal.type}</span>
            </div>
            <div>
              <span className="text-slate-500">Setup:</span>{" "}
              <span className="text-slate-300">{signal.setupType || "N/A"}</span>
            </div>
            <div>
              <span className="text-slate-500">Direction:</span>{" "}
              <span className="text-slate-300">{signal.setupDirection || "N/A"}</span>
            </div>
            <div>
              <span className="text-slate-500">Verdict:</span>{" "}
              <span className="text-slate-300">{signal.opportunityVerdict || "N/A"}</span>
            </div>
            <div>
              <span className="text-slate-500">Price:</span>{" "}
              <span className="text-slate-300">
                {signal.price ? signal.price.toFixed(4) : "N/A"}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Score:</span>{" "}
              <span className="text-slate-300">
                {signal.score ? signal.score.toFixed(1) : "N/A"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Decision Chain Snapshot
          </div>
          <div className="space-y-2 text-xs">
            {setupClassification !== null && setupClassification !== undefined ? (
              <div>
                <span className="text-slate-500">Setup Classification:</span>
                <pre className="mt-1 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-300">
                  {safeJsonStringify(setupClassification)}
                </pre>
              </div>
            ) : null}
            {opportunityScore !== null && opportunityScore !== undefined ? (
              <div>
                <span className="text-slate-500">Opportunity Score:</span>
                <pre className="mt-1 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-300">
                  {safeJsonStringify(opportunityScore)}
                </pre>
              </div>
            ) : null}
            {positionSizing !== null && positionSizing !== undefined ? (
              <div>
                <span className="text-slate-500">Position Sizing:</span>
                <pre className="mt-1 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-300">
                  {safeJsonStringify(positionSizing)}
                </pre>
              </div>
            ) : null}
            {doNotTrade !== null && doNotTrade !== undefined ? (
              <div>
                <span className="text-slate-500">Do Not Trade:</span>
                <pre className="mt-1 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-300">
                  {safeJsonStringify(doNotTrade)}
                </pre>
              </div>
            ) : null}
            {alertRanking !== null && alertRanking !== undefined ? (
              <div>
                <span className="text-slate-500">Alert Ranking:</span>
                <pre className="mt-1 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-300">
                  {safeJsonStringify(alertRanking)}
                </pre>
              </div>
            ) : null}
          </div>
        </div>

        {replayData.features != null ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
              Features Snapshot
            </div>
            <pre className="overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-300">
              {safeJsonStringify(replayData.features)}
            </pre>
          </div>
        ) : null}

        {hasTimelineData ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <ReplayTimelineChart timeline={timeline} />
          </div>
        ) : (
          <EmptyState
            title="No timeline data available"
            description="Outcomes have not been recorded for this signal yet"
          />
        )}
      </div>
    </div>
  );
}

function DecisionReplaySection({
  replayData,
  status,
  error,
  seed,
  onCopyText,
  onRequestDecisionReplay
}: {
  replayData: DecisionReplayPayload | null;
  status: ReplayStatus;
  error: string | null;
  seed: ReplayPanelProps["decisionReplaySeed"];
  onCopyText: ReplayPanelProps["onCopyText"];
  onRequestDecisionReplay: NonNullable<ReplayPanelProps["onRequestDecisionReplay"]>;
}) {
  const [lookupMode, setLookupMode] = useState<DecisionReplayLookupMode>("reviewId");
  const [lookupValue, setLookupValue] = useState("");
  const normalizedLookupValue = lookupValue.trim();

  useEffect(() => {
    if (!seed?.value) {
      return;
    }

    setLookupMode(seed.mode);
    setLookupValue(seed.value);
  }, [seed?.mode, seed?.value]);

  const summaryItems = useMemo(() => {
    const summary = replayData?.summary;

    return [
      { label: "Signal", present: summary?.signalPresent ?? false },
      { label: "Decision", present: summary?.decisionPresent ?? false },
      { label: "Order", present: summary?.orderPresent ?? false },
      { label: "Lifecycle", present: summary?.lifecyclePresent ?? false },
      { label: "Review", present: summary?.reviewPresent ?? false }
    ];
  }, [replayData]);

  const missingLinks = replayData?.summary.missingLinks ?? [];
  const timeline = replayData?.timeline ?? [];
  const replaySummary = replayData ? buildDecisionReplaySummary(replayData) : null;

  const requestReplay = () => {
    if (!normalizedLookupValue) {
      return false;
    }

    return onRequestDecisionReplay(
      lookupMode === "reviewId"
        ? { reviewId: normalizedLookupValue }
        : { positionLifecycleId: normalizedLookupValue }
    );
  };

  return (
    <section className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Decision Replay
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Signal / Decision / Order / Position Events / Review
          </div>
        </div>
        {replayData?.symbol ? (
          <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
            {replayData.symbol}
          </div>
        ) : null}
      </div>

      <form
        className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          requestReplay();
        }}
      >
        <div className="grid grid-cols-2 rounded-md border border-white/10 bg-black/30 p-1">
          {(["reviewId", "positionLifecycleId"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLookupMode(mode)}
              className={`min-h-8 rounded px-2 text-[10px] font-medium transition ${
                lookupMode === mode
                  ? "bg-accent/15 text-accent"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {lookupModeLabels[mode]}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={lookupValue}
          onChange={(event) => setLookupValue(event.target.value)}
          placeholder={lookupModeLabels[lookupMode]}
          className="min-h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-accent/60"
        />
        <button
          type="submit"
          disabled={!normalizedLookupValue || status === "loading"}
          className="min-h-10 rounded-md border border-accent/30 bg-accent/10 px-4 text-xs font-medium uppercase tracking-[0.16em] text-accent transition hover:border-accent/60 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Loading..." : "Load Decision Replay"}
        </button>
      </form>

      {replayData?.reviewId || replayData?.positionLifecycleId || normalizedLookupValue ? (
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em]">
          {replayData?.reviewId ? (
            <DecisionReplayIdPill
              label="reviewId"
              value={replayData.reviewId}
              onCopyText={onCopyText}
            />
          ) : null}
          {replayData?.positionLifecycleId ? (
            <DecisionReplayIdPill
              label="positionLifecycleId"
              value={replayData.positionLifecycleId}
              onCopyText={onCopyText}
            />
          ) : null}
          {!replayData && normalizedLookupValue ? (
            <DecisionReplayIdPill
              label={lookupModeLabels[lookupMode]}
              value={normalizedLookupValue}
              onCopyText={onCopyText}
            />
          ) : null}
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="mt-3 rounded-md border border-accent/20 bg-accent/10 px-3 py-2 text-xs text-accent">
          Loading Decision Replay...
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
          {error || "Decision Replay could not be loaded."}
        </div>
      ) : null}

      {replayData ? (
        <div className="mt-3 space-y-3">
          {replaySummary ? <ReplayMeaningSummary {...replaySummary} /> : null}

          <div className="flex flex-wrap gap-2">
            {summaryItems.map((item) => (
              <span
                key={item.label}
                className={`rounded-md border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${
                  item.present
                    ? "border-positive/30 bg-positive/10 text-positive"
                    : "border-caution/30 bg-caution/10 text-caution"
                }`}
              >
                {item.label} {item.present ? "present" : "missing"}
              </span>
            ))}
          </div>

          {missingLinks.length > 0 ? (
            <div className="rounded-md border border-caution/30 bg-caution/10 px-3 py-2 text-xs text-caution">
              <div className="font-medium uppercase tracking-[0.14em]">Missing links</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {missingLinks.map((link) => (
                  <span
                    key={link}
                    className="rounded border border-caution/30 bg-black/20 px-2 py-0.5"
                  >
                    {link}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {timeline.length > 0 ? (
            <ol className="space-y-2">
              {timeline.map((event) => (
                <li
                  key={event.id}
                  className="grid gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs sm:grid-cols-[150px_120px_minmax(0,1fr)_auto]"
                >
                  <time className="text-slate-500">{formatReplayTimestamp(event.timestamp)}</time>
                  <span
                    className={`font-medium uppercase tracking-[0.12em] ${
                      event.type === "MISSING_LINK" ? "text-caution" : "text-accent"
                    }`}
                  >
                    {decisionReplayTypeLabels[event.type]}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200">{event.title}</div>
                    {event.description ? (
                      <div className="mt-1 break-words text-slate-500">{event.description}</div>
                    ) : null}
                  </div>
                  {onCopyText ? (
                    <button
                      type="button"
                      onClick={() => void onCopyText(event.id)}
                      className="h-7 rounded-md border border-white/10 bg-black/20 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400 transition hover:border-accent/40 hover:text-white"
                    >
                      Copy ID
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No Decision Replay events"
              description="The backend returned a replay payload without timeline events"
            />
          )}
        </div>
      ) : status === "idle" ? (
        <EmptyState
          className="mt-3"
          title="Close a paper trade to generate replay"
          description="Load by reviewId or positionLifecycleId"
        />
      ) : null}
    </section>
  );
}

function DecisionReplayIdPill({
  label,
  value,
  onCopyText
}: {
  label: string;
  value: string;
  onCopyText: ReplayPanelProps["onCopyText"];
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[220px] truncate font-mono text-accent">{value}</span>
      {onCopyText ? (
        <button
          type="button"
          onClick={() => void onCopyText(value)}
          className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[9px] text-slate-400 transition hover:border-accent/40 hover:text-white"
        >
          Copy
        </button>
      ) : null}
    </span>
  );
}

export function ReplayPanel({
  signalId,
  replayData,
  status,
  error,
  onRequestReplay,
  decisionReplayData = null,
  decisionReplayStatus = "idle",
  decisionReplayError = null,
  decisionReplaySeed = null,
  onRequestDecisionReplay,
  onCopyText,
  learningMode
}: ReplayPanelProps) {
  return (
    <div className="space-y-4">
      <SignalReplayContent
        signalId={signalId}
        replayData={replayData}
        status={status}
        error={error}
        onRequestReplay={onRequestReplay}
        learningMode={learningMode}
      />
      {onRequestDecisionReplay ? (
        <DecisionReplaySection
          replayData={decisionReplayData}
          status={decisionReplayStatus}
          error={decisionReplayError}
          seed={decisionReplaySeed}
          onCopyText={onCopyText}
          onRequestDecisionReplay={onRequestDecisionReplay}
        />
      ) : null}
    </div>
  );
}
