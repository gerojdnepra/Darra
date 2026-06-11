import type { DecisionChainSnapshot } from "../types/messages";
import { decisionReviewRepository } from "./decision-review-repository";
import { orderRepository } from "./order-repository";
import { positionLifecycleRepository } from "./position-lifecycle-repository";
import { tradeDecisionRepository } from "./trade-decision-repository";
import { unifiedSignalRepository } from "./unified-signal-repository";

export interface ReconstructDecisionChainInput {
  reviewId?: string | null;
  positionLifecycleId?: string | null;
}

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const addMissing = (missingLinks: string[], link: string): void => {
  if (!missingLinks.includes(link)) {
    missingLinks.push(link);
  }
};

export const reconstructDecisionChain = (
  input: ReconstructDecisionChainInput
): DecisionChainSnapshot => {
  const reviewId = normalizeText(input.reviewId);
  const inputLifecycleId = normalizeText(input.positionLifecycleId);
  const missingLinks: string[] = [];

  if (!reviewId && !inputLifecycleId) {
    addMissing(missingLinks, "reviewId_or_positionLifecycleId");
  }

  let decisionReview = reviewId ? decisionReviewRepository.getDecisionReviewById(reviewId) : null;
  if (reviewId && !decisionReview) {
    addMissing(missingLinks, "decisionReview");
  }

  const lifecycleId =
    normalizeText(decisionReview?.positionLifecycleId) ??
    inputLifecycleId ??
    null;
  const positionLifecycle = lifecycleId
    ? positionLifecycleRepository.getPositionLifecycleById(lifecycleId)
    : null;
  if (lifecycleId && !positionLifecycle) {
    addMissing(missingLinks, "positionLifecycle");
  }
  if (!lifecycleId) {
    addMissing(missingLinks, "positionLifecycleId");
  }

  const positionLifecycleEvents = positionLifecycle
    ? positionLifecycleRepository.listLifecycleEvents(positionLifecycle.id)
    : [];
  if (positionLifecycle && positionLifecycleEvents.length === 0) {
    addMissing(missingLinks, "positionLifecycleEvents");
  }

  if (!decisionReview && lifecycleId) {
    decisionReview = decisionReviewRepository.getDecisionReviewByLifecycleId(lifecycleId);
    if (!decisionReview) {
      addMissing(missingLinks, "decisionReview");
    }
  }

  const decisionContextId =
    normalizeText(decisionReview?.decisionContextId) ??
    normalizeText(positionLifecycle?.decisionContextId);
  const orderIntentId =
    normalizeText(decisionReview?.orderIntentId) ??
    normalizeText(positionLifecycle?.orderIntentId);
  const tradeDecisionContext = decisionContextId
    ? tradeDecisionRepository.getTradeDecisionContextById(decisionContextId)
    : orderIntentId
      ? tradeDecisionRepository.getTradeDecisionContextByOrderIntentId(orderIntentId)
      : null;

  if ((decisionContextId || orderIntentId) && !tradeDecisionContext) {
    addMissing(missingLinks, "tradeDecisionContext");
  }
  if (!decisionContextId && !orderIntentId) {
    addMissing(missingLinks, "tradeDecisionContextLink");
  }

  const resolvedOrderIntentId =
    orderIntentId ??
    normalizeText(tradeDecisionContext?.orderIntentId);
  const orderIntent = resolvedOrderIntentId
    ? orderRepository.getIntentResponse(resolvedOrderIntentId)
    : null;
  if (resolvedOrderIntentId && !orderIntent) {
    addMissing(missingLinks, "orderIntent");
  }
  if (!resolvedOrderIntentId) {
    addMissing(missingLinks, "orderIntentId");
  }

  const orders = resolvedOrderIntentId
    ? orderRepository.listOrdersForIntentChain(resolvedOrderIntentId)
    : [];
  if (resolvedOrderIntentId && orders.length === 0) {
    addMissing(missingLinks, "orders");
  }

  const unifiedSignalId =
    normalizeText(decisionReview?.unifiedSignalId) ??
    normalizeText(tradeDecisionContext?.unifiedSignalId) ??
    normalizeText(positionLifecycle?.unifiedSignalId);
  const unifiedSignal = unifiedSignalId
    ? unifiedSignalRepository.getUnifiedSignalEventById(unifiedSignalId)
    : null;
  if (unifiedSignalId && !unifiedSignal) {
    addMissing(missingLinks, "unifiedSignal");
  }
  if (!unifiedSignalId) {
    addMissing(missingLinks, "unifiedSignalId");
  }

  return {
    ...(reviewId ? { reviewId } : {}),
    ...(lifecycleId ? { positionLifecycleId: lifecycleId } : {}),
    unifiedSignal,
    tradeDecisionContext,
    orderIntent,
    orders,
    positionLifecycle,
    positionLifecycleEvents,
    decisionReview,
    missingLinks,
    reconstructedAt: Date.now()
  };
};
