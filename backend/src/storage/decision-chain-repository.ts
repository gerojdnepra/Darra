import type { ExecutionCommand, ExecutionResult } from "../execution/types";
import type { DecisionChainSnapshot, OrderAckMessage, OrderRejectedMessage } from "../types/messages";
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

const isOrderResponseWithOrder = (
  response: unknown
): response is OrderAckMessage | OrderRejectedMessage =>
  Boolean(
    response &&
      typeof response === "object" &&
      "type" in response &&
      (((response as { type?: unknown }).type === "order_ack") ||
        (response as { type?: unknown }).type === "order_rejected") &&
      "payload" in response &&
      typeof (response as { payload?: unknown }).payload === "object" &&
      (response as { payload?: { order?: unknown } }).payload?.order
  );

const findAuditIdForExecutionResult = (input: {
  intentId: string;
  responseType: string | null;
  dryRun: boolean | null;
}): string | null => {
  const eventTypes =
    input.responseType === "order_ack"
      ? input.dryRun
        ? ["intent_accepted"]
        : ["LIVE_TESTNET_ORDER_ACK", "intent_accepted"]
      : input.responseType === "order_rejected"
        ? input.dryRun
          ? ["validation_rejected"]
          : ["LIVE_TESTNET_ORDER_REJECTED", "validation_rejected"]
        : [];

  for (const eventType of eventTypes) {
    const auditEvent = orderRepository.findOrderAuditEventByIntentIdAndType(input.intentId, eventType);
    if (auditEvent) {
      return auditEvent.auditId;
    }
  }

  return null;
};

const buildExecutionCommand = (input: {
  intentId: string | null;
  symbol: string | null;
  quantity: number | null;
  dryRun: boolean | null;
  decisionId?: string | null;
  metadata?: Record<string, unknown>;
}): ExecutionCommand | null => {
  const intentId = normalizeText(input.intentId);
  const symbol = normalizeText(input.symbol)?.toUpperCase() ?? null;
  const quantity =
    typeof input.quantity === "number" && Number.isFinite(input.quantity) ? input.quantity : null;

  if (!intentId || !symbol || quantity === null) {
    return null;
  }

  return {
    type: input.dryRun === false ? "LIVE" : "PAPER",
    intentId,
    decisionId: normalizeText(input.decisionId),
    symbol,
    quantity,
    metadata: Object.freeze({
      reconstructed: true,
      ...(input.metadata ?? {})
    })
  };
};

const buildExecutionResult = (input: {
  intentId: string | null;
  lifecycleId: string | null;
  responseType: string | null;
  dryRun: boolean | null;
  orderStatus: string | null;
}): ExecutionResult | null => {
  const intentId = normalizeText(input.intentId);
  if (!intentId) {
    return null;
  }

  let status: ExecutionResult["status"] | null = null;
  if (input.responseType === "order_ack") {
    status = "SUCCESS";
  } else if (input.responseType === "order_rejected") {
    status = "REJECTED";
  } else if (input.responseType === "order_error") {
    status = "FAILED";
  } else if (input.orderStatus === "REJECTED") {
    status = "REJECTED";
  } else if (input.orderStatus) {
    status = "SUCCESS";
  }

  if (!status) {
    return null;
  }

  return {
    executionId: `execution-result:${intentId}`,
    status,
    lifecycleId: normalizeText(input.lifecycleId),
    auditId: findAuditIdForExecutionResult({
      intentId,
      responseType: input.responseType,
      dryRun: input.dryRun
    })
  };
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
    ? orderRepository.getIntentResponse(resolvedOrderIntentId) ??
      orderRepository.getPreSubmitIntentRecord(resolvedOrderIntentId)
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

  const rootOrder = orders.find((order) => normalizeText(order.parentOrderId) === null) ?? orders[0] ?? null;
  const responseWithOrder =
    orderIntent &&
    typeof orderIntent === "object" &&
    "response" in orderIntent &&
    isOrderResponseWithOrder((orderIntent as { response?: unknown }).response)
      ? (orderIntent as { response: OrderAckMessage | OrderRejectedMessage }).response
      : null;
  const executionCommand = buildExecutionCommand({
    intentId: resolvedOrderIntentId,
    symbol:
      normalizeText(rootOrder?.symbol) ??
      normalizeText(responseWithOrder?.payload.order.symbol) ??
      normalizeText(positionLifecycle?.symbol) ??
      normalizeText(tradeDecisionContext?.symbol) ??
      normalizeText(unifiedSignal?.symbol),
    quantity:
      rootOrder?.quantity ??
      responseWithOrder?.payload.order.quantity ??
      null,
    dryRun:
      rootOrder?.dryRun ??
      (orderIntent && typeof orderIntent === "object" && "dryRun" in orderIntent
        ? Boolean((orderIntent as { dryRun?: unknown }).dryRun)
        : null),
    decisionId:
      normalizeText(tradeDecisionContext?.id) ??
      normalizeText(positionLifecycle?.decisionContextId) ??
      normalizeText(decisionReview?.decisionContextId),
    metadata: {
      orderType: rootOrder?.orderType ?? responseWithOrder?.payload.order.orderType ?? null,
      sourceWindowId:
        normalizeText(rootOrder?.sourceWindowId) ??
        normalizeText(responseWithOrder?.payload.order.sourceWindowId),
      reviewId: normalizeText(decisionReview?.id),
      lifecycleId
    }
  });
  const executionResult = buildExecutionResult({
    intentId: resolvedOrderIntentId,
    lifecycleId,
    responseType:
      orderIntent && typeof orderIntent === "object" && "responseType" in orderIntent
        ? normalizeText((orderIntent as { responseType?: string | null }).responseType)
        : null,
    dryRun:
      orderIntent && typeof orderIntent === "object" && "dryRun" in orderIntent
        ? Boolean((orderIntent as { dryRun?: unknown }).dryRun)
        : rootOrder?.dryRun ?? null,
    orderStatus: rootOrder?.status ?? responseWithOrder?.payload.order.status ?? null
  });

  return {
    ...(reviewId ? { reviewId } : {}),
    ...(lifecycleId ? { positionLifecycleId: lifecycleId } : {}),
    unifiedSignal,
    tradeDecisionContext,
    orderIntent,
    executionCommand,
    executionResult,
    orders,
    positionLifecycle,
    positionLifecycleEvents,
    decisionReview,
    missingLinks,
    reconstructedAt: Date.now()
  };
};
