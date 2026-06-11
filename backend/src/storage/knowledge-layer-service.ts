import type {
  DecisionChainSnapshot,
  DecisionReviewObject,
  KnowledgeLayerSnapshot
} from "../types/messages";
import { reconstructDecisionChain } from "./decision-chain-repository";
import { decisionReviewRepository } from "./decision-review-repository";

export interface BuildKnowledgeLayerSnapshotInput {
  symbol?: string | null;
  limit?: number | null;
}

const reviewCompletenessFieldsCount = 9;

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
};

const normalizeLimit = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), 1), 500)
    : 100;

const roundPct = (value: number): number => Math.round(value * 100) / 100;

const pct = (count: number, total: number): number =>
  total > 0 ? roundPct((count / total) * 100) : 0;

const hasText = (value: string | null | undefined): boolean => Boolean(normalizeText(value));

const hasItems = (values: string[] | null | undefined): boolean =>
  Array.isArray(values) && values.some((value) => hasText(value));

const computeReviewCompletenessScore = (review: DecisionReviewObject): number => {
  const presentFields = [
    hasText(review.positionLifecycleId),
    hasText(review.orderIntentId),
    hasText(review.decisionContextId),
    hasText(review.unifiedSignalId),
    hasText(review.marketRegime),
    hasText(review.tradeGrade),
    hasText(review.notes),
    hasItems(review.ruleViolations),
    hasItems(review.playbookTags)
  ].filter(Boolean).length;

  return roundPct((presentFields / reviewCompletenessFieldsCount) * 100);
};

const isReplayableChain = (chain: DecisionChainSnapshot): boolean =>
  Boolean(chain.decisionReview) &&
  Boolean(chain.positionLifecycle) &&
  (Boolean(chain.tradeDecisionContext) ||
    chain.orders.length > 0 ||
    chain.positionLifecycleEvents.length > 0);

export const buildKnowledgeLayerSnapshot = (
  input: BuildKnowledgeLayerSnapshotInput = {}
): KnowledgeLayerSnapshot => {
  const symbol = normalizeSymbol(input.symbol);
  const limit = normalizeLimit(input.limit);
  const reviews = symbol
    ? decisionReviewRepository.listDecisionReviewsForSymbol(symbol, limit)
    : decisionReviewRepository.listRecentDecisionReviews(limit);
  const generatedAt = Date.now();
  const totalReviews = reviews.length;
  const missingLinkCounts: Record<string, number> = {};
  const scoreByReviewId: Record<string, number> = {};

  let completeChains = 0;
  let withDecisionContext = 0;
  let withUnifiedSignal = 0;
  let replayable = 0;
  let reviewCompletenessTotal = 0;
  let reviewsWithPlaybookTags = 0;
  let reviewsWithRuleViolations = 0;

  for (const review of reviews) {
    const chain = reconstructDecisionChain({ reviewId: review.id });

    if (chain.missingLinks.length === 0) {
      completeChains += 1;
    }

    for (const missingLink of chain.missingLinks) {
      missingLinkCounts[missingLink] = (missingLinkCounts[missingLink] ?? 0) + 1;
    }

    if (chain.tradeDecisionContext) {
      withDecisionContext += 1;
    }

    if (chain.unifiedSignal) {
      withUnifiedSignal += 1;
    }

    if (isReplayableChain(chain)) {
      replayable += 1;
    }

    const reviewScore = computeReviewCompletenessScore(review);
    scoreByReviewId[review.id] = reviewScore;
    reviewCompletenessTotal += reviewScore;

    if (hasItems(review.playbookTags)) {
      reviewsWithPlaybookTags += 1;
    }

    if (hasItems(review.ruleViolations)) {
      reviewsWithRuleViolations += 1;
    }
  }

  const partialChains = totalReviews - completeChains;
  const withoutDecisionContext = totalReviews - withDecisionContext;
  const withoutUnifiedSignal = totalReviews - withUnifiedSignal;
  const notReplayable = totalReviews - replayable;

  return {
    generatedAt,
    scope: {
      ...(symbol ? { symbol } : {}),
      limit
    },
    chainHealth: {
      totalReviews,
      completeChains,
      partialChains,
      missingLinkCounts,
      completenessPct: pct(completeChains, totalReviews)
    },
    decisionCoverage: {
      withDecisionContext,
      withoutDecisionContext,
      coveragePct: pct(withDecisionContext, totalReviews)
    },
    signalLinkage: {
      withUnifiedSignal,
      withoutUnifiedSignal,
      coveragePct: pct(withUnifiedSignal, totalReviews)
    },
    replayCoverage: {
      replayable,
      notReplayable,
      coveragePct: pct(replayable, totalReviews)
    },
    reviewCompleteness: {
      averageScore: totalReviews > 0 ? roundPct(reviewCompletenessTotal / totalReviews) : 0,
      scoreByReviewId
    },
    playbookReadiness: {
      reviewsWithPlaybookTags,
      reviewsWithRuleViolations,
      tagReadinessPct: pct(reviewsWithPlaybookTags, totalReviews),
      violationReadinessPct: pct(reviewsWithRuleViolations, totalReviews)
    }
  };
};
