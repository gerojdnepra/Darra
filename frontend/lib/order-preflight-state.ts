import type {
  OrderPreflightInvalidatedMessage,
  OrderPreflightMessage
} from "./types";

export interface OrderEntryPreflightStateSnapshot {
  ticketKey: string | null;
  requestId: string | null;
  response: OrderPreflightMessage["payload"] | null;
  loading: boolean;
  stale: boolean;
  unavailableReason: string | null;
  requestedAt: number | null;
  receivedAt: number | null;
}

export interface ApplyOrderPreflightInvalidationResult {
  matched: boolean;
  nextState: OrderEntryPreflightStateSnapshot | null;
}

export const applyOrderPreflightInvalidation = (
  currentState: OrderEntryPreflightStateSnapshot | null,
  invalidation: OrderPreflightInvalidatedMessage["payload"]
): ApplyOrderPreflightInvalidationResult => {
  const currentPreflightId = currentState?.response?.preflightId ?? null;

  if (!currentState || !currentPreflightId || currentPreflightId !== invalidation.preflightId) {
    return {
      matched: false,
      nextState: currentState
    };
  }

  return {
    matched: true,
    nextState: {
      ...currentState,
      loading: false,
      stale: true,
      unavailableReason: invalidation.reason
    }
  };
};
