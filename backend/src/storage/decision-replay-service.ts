import type {
  DecisionChainSnapshot,
  DecisionReplayEvent,
  DecisionReplayPayload,
  OrderStatePayload,
  PositionLifecycleEvent
} from "../types/messages";
import { reconstructDecisionChain } from "./decision-chain-repository";

export interface BuildDecisionReplayInput {
  reviewId?: string | null;
  positionLifecycleId?: string | null;
}

const eventPriority: Record<DecisionReplayEvent["type"], number> = {
  SIGNAL: 1,
  DECISION: 2,
  ORDER: 3,
  POSITION_EVENT: 4,
  REVIEW: 5,
  MISSING_LINK: 6
};

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const orderDescription = (order: OrderStatePayload): string =>
  [
    order.side,
    order.orderType,
    order.status,
    `${order.quantity}`,
    order.symbol
  ].join(" ");

const positionEventTitle = (event: PositionLifecycleEvent): string =>
  event.eventType
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const resolveSymbol = (chain: DecisionChainSnapshot): string | undefined =>
  normalizeText(chain.decisionReview?.symbol) ??
  normalizeText(chain.positionLifecycle?.symbol) ??
  normalizeText(chain.tradeDecisionContext?.symbol) ??
  normalizeText(chain.unifiedSignal?.symbol) ??
  normalizeText(chain.orders[0]?.symbol) ??
  undefined;

const buildTimeline = (chain: DecisionChainSnapshot, generatedAt: number): DecisionReplayEvent[] => {
  const events: DecisionReplayEvent[] = [];

  if (chain.unifiedSignal) {
    events.push({
      id: `signal:${chain.unifiedSignal.id}`,
      type: "SIGNAL",
      timestamp: chain.unifiedSignal.createdAt,
      title: chain.unifiedSignal.title,
      ...(chain.unifiedSignal.description ? { description: chain.unifiedSignal.description } : {}),
      payload: chain.unifiedSignal
    });
  }

  if (chain.tradeDecisionContext) {
    events.push({
      id: `decision:${chain.tradeDecisionContext.id}`,
      type: "DECISION",
      timestamp: chain.tradeDecisionContext.createdAt,
      title: `Decision: ${chain.tradeDecisionContext.decision}`,
      ...(chain.tradeDecisionContext.decisionReason
        ? { description: chain.tradeDecisionContext.decisionReason }
        : {}),
      payload: chain.tradeDecisionContext
    });
  }

  for (const order of chain.orders) {
    events.push({
      id: `order:${order.orderId}`,
      type: "ORDER",
      timestamp: order.createdAt,
      title: `Order ${order.status}`,
      description: orderDescription(order),
      payload: order
    });
  }

  for (const event of chain.positionLifecycleEvents) {
    events.push({
      id: `position-event:${event.id}`,
      type: "POSITION_EVENT",
      timestamp: event.timestamp,
      title: positionEventTitle(event),
      payload: event
    });
  }

  if (chain.decisionReview) {
    events.push({
      id: `review:${chain.decisionReview.id}`,
      type: "REVIEW",
      timestamp: chain.decisionReview.createdAt,
      title: "Decision Review Created",
      ...(chain.decisionReview.status
        ? { description: `Review status: ${chain.decisionReview.status}` }
        : {}),
      payload: chain.decisionReview
    });
  }

  for (const missingLink of chain.missingLinks) {
    events.push({
      id: `missing:${missingLink}`,
      type: "MISSING_LINK",
      timestamp: generatedAt,
      title: `Missing link: ${missingLink}`
    });
  }

  return events.sort((left, right) => {
    const timestampDelta = left.timestamp - right.timestamp;
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    const priorityDelta = eventPriority[left.type] - eventPriority[right.type];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.id.localeCompare(right.id);
  });
};

export const buildDecisionReplay = (
  input: BuildDecisionReplayInput
): DecisionReplayPayload => {
  const generatedAt = Date.now();
  const chain = reconstructDecisionChain(input);
  const symbol = resolveSymbol(chain);

  return {
    ...(chain.reviewId ? { reviewId: chain.reviewId } : {}),
    ...(chain.positionLifecycleId ? { positionLifecycleId: chain.positionLifecycleId } : {}),
    ...(symbol ? { symbol } : {}),
    chain,
    timeline: buildTimeline(chain, generatedAt),
    summary: {
      signalPresent: Boolean(chain.unifiedSignal),
      decisionPresent: Boolean(chain.tradeDecisionContext),
      orderPresent: chain.orders.length > 0,
      lifecyclePresent: Boolean(chain.positionLifecycle),
      reviewPresent: Boolean(chain.decisionReview),
      missingLinks: chain.missingLinks
    },
    generatedAt
  };
};
