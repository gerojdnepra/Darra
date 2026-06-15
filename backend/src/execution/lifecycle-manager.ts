import { decisionReviewRepository } from "../storage/decision-review-repository";
import { orderRepository } from "../storage/order-repository";
import { PositionLifecycleRepository } from "../storage/position-lifecycle-repository";
import { chainIntegrityService } from "../storage/chain-integrity-service";
import { getSqlite } from "../storage/sqlite";
import { ExecutionContractValidator } from "./execution-contract-validator";
import type {
  OrderStatePayload,
  PaperPositionPayload,
  PositionLifecycle,
  PositionLifecycleClosedMessage,
  PositionLifecycleCreatedMessage,
  PositionLifecycleEventMessage,
  PositionLifecycleEventType,
  PositionLifecycleUpdatedMessage
} from "../types/messages";

export type LifecycleManagerMessage =
  | PositionLifecycleCreatedMessage
  | PositionLifecycleUpdatedMessage
  | PositionLifecycleClosedMessage
  | PositionLifecycleEventMessage;

export type LifecycleManagerEmitter = (message: LifecycleManagerMessage) => void;

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeSymbol = (value: string | undefined): string | null => {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
};

export class LifecycleManager {
  private readonly positionLifecycleRepository: PositionLifecycleRepository;

  constructor(
    private readonly emit: LifecycleManagerEmitter,
    private readonly contractValidator: ExecutionContractValidator = new ExecutionContractValidator()
  ) {
    this.positionLifecycleRepository = new PositionLifecycleRepository(
      getSqlite(),
      this.contractValidator
    );
  }

  emitPositionLifecycleEventMessage(input: {
    lifecycleId: string;
    eventType: PositionLifecycleEventType;
    timestamp: number;
    payload?: unknown;
  }): void {
    const message: PositionLifecycleEventMessage = {
      type: "position_lifecycle_event",
      generatedAt: input.timestamp,
      payload: {
        lifecycleId: input.lifecycleId,
        eventType: input.eventType,
        timestamp: input.timestamp,
        ...(input.payload === undefined ? {} : { payload: input.payload })
      }
    };

    this.emit(message);
  }

  appendAndEmitPositionLifecycleEvent(input: {
    lifecycleId: string;
    eventType: PositionLifecycleEventType;
    timestamp: number;
    payload?: unknown;
  }): void {
    const event = this.contractValidator.withLifecycleWriteAuthority((writerAuthority) =>
      this.positionLifecycleRepository.appendLifecycleEvent({
        writerAuthority,
        lifecycleId: input.lifecycleId,
        eventType: input.eventType,
        timestamp: input.timestamp,
        payload: input.payload
      })
    );

    this.emitPositionLifecycleEventMessage({
      lifecycleId: event.lifecycleId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      payload: event.payload
    });
  }

  resolvePaperPositionLifecycle(position: PaperPositionPayload): PositionLifecycle | null {
    const entryOrder = orderRepository.getOrderByOrderId(position.entryOrderId);
    if (!entryOrder?.intentId) {
      return null;
    }

    return this.positionLifecycleRepository.getPositionLifecycleByOrderIntentId(entryOrder.intentId);
  }

  listOpenPositionLifecycles(limit = 50): PositionLifecycle[] {
    return this.positionLifecycleRepository.listOpenPositionLifecycles(limit);
  }

  createOrOpenPositionLifecycle(input: {
    order: OrderStatePayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    if (!input.order.intentId || input.order.reduceOnly) {
      return;
    }

    try {
      const existing = this.positionLifecycleRepository.getPositionLifecycleByOrderIntentId(
        input.order.intentId
      );
      if (existing) {
        return;
      }

      const lifecycle = this.contractValidator.withLifecycleWriteAuthority((writerAuthority) =>
        this.positionLifecycleRepository.createPositionLifecycle({
          writerAuthority,
          symbol: input.order.symbol,
          orderIntentId: input.order.intentId,
          decisionContextId: input.decisionContextId ?? null,
          unifiedSignalId: input.unifiedSignalId ?? null,
          status: "OPEN",
          openedAt: input.order.createdAt,
          createdAt: input.timestamp
        })
      );
      const createdMessage: PositionLifecycleCreatedMessage = {
        type: "position_lifecycle_created",
        generatedAt: input.timestamp,
        payload: lifecycle
      };

      this.emit(createdMessage);
      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "CREATED",
        timestamp: input.timestamp,
        payload: {
          orderIntentId: input.order.intentId,
          decisionContextId: input.decisionContextId ?? null,
          unifiedSignalId: input.unifiedSignalId ?? null,
          entryOrderId: input.order.orderId
        }
      });
      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_OPENED",
        timestamp: input.timestamp,
        payload: {
          entryOrderId: input.order.orderId,
          symbol: input.order.symbol,
          side: input.order.side,
          quantity: input.order.quantity,
          price: input.order.price
        }
      });
    } catch (error) {
      console.warn("Position lifecycle creation failed", error);
    }
  }

  recordLiveOrderLifecycleAck(input: {
    order: OrderStatePayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    if (input.order.reduceOnly) {
      this.recordReduceOnlyLifecycleOrder(input);
      return;
    }

    this.createOrOpenPositionLifecycle(input);
  }

  resolveReduceOnlyLifecycleParentOrderId(input: {
    reduceOnly: boolean;
    decisionContextId?: string | null;
    symbol: string;
  }): string | null {
    if (!input.reduceOnly) {
      return null;
    }

    const decisionContextId = normalizeText(input.decisionContextId);
    if (!decisionContextId) {
      return null;
    }

    try {
      const lifecycle = this.positionLifecycleRepository.getPositionLifecycleByDecisionContextId(
        decisionContextId
      );
      if (
        !lifecycle ||
        normalizeSymbol(lifecycle.symbol) !== normalizeSymbol(input.symbol) ||
        (lifecycle.status !== "OPEN" && lifecycle.status !== "MANAGING") ||
        !lifecycle.orderIntentId
      ) {
        return null;
      }

      const entryOrder = orderRepository.getOrderByIntentId(lifecycle.orderIntentId);
      return entryOrder?.orderId ?? null;
    } catch (error) {
      console.warn("Reduce-only lifecycle parent resolution failed", error);
      return null;
    }
  }

  recordReduceOnlyLifecycleOrder(input: {
    order: OrderStatePayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    const decisionContextId = normalizeText(input.decisionContextId);
    if (!decisionContextId) {
      return;
    }

    try {
      const lifecycle = this.positionLifecycleRepository.getPositionLifecycleByDecisionContextId(
        decisionContextId
      );

      if (
        !lifecycle ||
        normalizeSymbol(lifecycle.symbol) !== normalizeSymbol(input.order.symbol) ||
        (lifecycle.status !== "OPEN" && lifecycle.status !== "MANAGING")
      ) {
        return;
      }

      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_UPDATED",
        timestamp: input.timestamp,
        payload: {
          action: "REDUCE_ONLY_ORDER_ACK",
          reduceOnly: true,
          closeOrderId: input.order.orderId,
          closeIntentId: input.order.intentId,
          closeClientOrderId: input.order.clientOrderId,
          exchangeOrderId: input.order.exchangeOrderId,
          symbol: input.order.symbol,
          side: input.order.side,
          quantity: input.order.quantity,
          decisionContextId,
          unifiedSignalId: input.unifiedSignalId ?? lifecycle.unifiedSignalId ?? null
        }
      });

      const updated = this.contractValidator.withLifecycleWriteAuthority((writerAuthority) =>
        this.positionLifecycleRepository.updatePositionLifecycle({
          writerAuthority,
          id: lifecycle.id,
          status: lifecycle.status === "OPEN" ? "MANAGING" : lifecycle.status,
          updatedAt: input.timestamp
        })
      );

      if (updated) {
        const message: PositionLifecycleUpdatedMessage = {
          type: "position_lifecycle_updated",
          generatedAt: input.timestamp,
          payload: updated
        };
        this.emit(message);
      }
    } catch (error) {
      console.warn("Reduce-only lifecycle event integration failed", error);
    }
  }

  createOrOpenPaperPositionLifecycle(input: {
    filledOrder: OrderStatePayload;
    position: PaperPositionPayload;
    timestamp: number;
    decisionContextId?: string | null;
    unifiedSignalId?: string | null;
  }): void {
    if (!input.filledOrder.intentId) {
      return;
    }

    try {
      const existing = this.positionLifecycleRepository.getPositionLifecycleByOrderIntentId(
        input.filledOrder.intentId
      );
      if (existing) {
        return;
      }

      const lifecycle = this.contractValidator.withLifecycleWriteAuthority((writerAuthority) =>
        this.positionLifecycleRepository.createPositionLifecycle({
          writerAuthority,
          symbol: input.position.symbol,
          orderIntentId: input.filledOrder.intentId,
          decisionContextId: input.decisionContextId ?? null,
          unifiedSignalId: input.unifiedSignalId ?? null,
          status: "OPEN",
          openedAt: input.position.openedAt,
          createdAt: input.timestamp
        })
      );
      const createdMessage: PositionLifecycleCreatedMessage = {
        type: "position_lifecycle_created",
        generatedAt: input.timestamp,
        payload: lifecycle
      };

      this.emit(createdMessage);
      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "CREATED",
        timestamp: input.timestamp,
        payload: {
          orderIntentId: input.filledOrder.intentId,
          decisionContextId: input.decisionContextId ?? null,
          unifiedSignalId: input.unifiedSignalId ?? null,
          paperPositionId: input.position.paperPositionId,
          entryOrderId: input.position.entryOrderId
        }
      });
      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_OPENED",
        timestamp: input.timestamp,
        payload: {
          paperPositionId: input.position.paperPositionId,
          entryOrderId: input.position.entryOrderId,
          side: input.position.side,
          quantity: input.position.quantity,
          entryPrice: input.position.entryPrice,
          stopLossOrderId: input.position.stopLossOrderId,
          takeProfitOrderId: input.position.takeProfitOrderId
        }
      });
    } catch (error) {
      console.warn("Paper position lifecycle open integration failed", error);
    }
  }

  updatePaperPositionLifecycle(position: PaperPositionPayload, timestamp: number): void {
    try {
      const lifecycle = this.resolvePaperPositionLifecycle(position);
      if (!lifecycle) {
        return;
      }

      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_UPDATED",
        timestamp,
        payload: {
          paperPositionId: position.paperPositionId,
          entryOrderId: position.entryOrderId,
          unrealizedPnl: position.unrealizedPnl,
          quantity: position.quantity,
          updatedAt: timestamp
        }
      });

      const updated = this.contractValidator.withLifecycleWriteAuthority((writerAuthority) =>
        this.positionLifecycleRepository.updatePositionLifecycle({
          writerAuthority,
          id: lifecycle.id,
          status: lifecycle.status === "OPEN" ? "MANAGING" : lifecycle.status,
          updatedAt: timestamp
        })
      );
      if (!updated) {
        return;
      }

      const message: PositionLifecycleUpdatedMessage = {
        type: "position_lifecycle_updated",
        generatedAt: timestamp,
        payload: updated
      };
      this.emit(message);
    } catch (error) {
      console.warn("Paper position lifecycle update integration failed", error);
    }
  }

  closePaperPositionLifecycle(position: PaperPositionPayload, timestamp: number): void {
    try {
      const lifecycle = this.resolvePaperPositionLifecycle(position);
      if (!lifecycle) {
        return;
      }

      this.appendAndEmitPositionLifecycleEvent({
        lifecycleId: lifecycle.id,
        eventType: "POSITION_CLOSED",
        timestamp,
        payload: {
          paperPositionId: position.paperPositionId,
          entryOrderId: position.entryOrderId,
          closePrice: position.closePrice,
          closeReason: position.closeReason,
          closedAt: position.closedAt
        }
      });

      if (typeof position.realizedPnl === "number" && Number.isFinite(position.realizedPnl)) {
        this.appendAndEmitPositionLifecycleEvent({
          lifecycleId: lifecycle.id,
          eventType: "PNL_REALIZED",
          timestamp,
          payload: {
            paperPositionId: position.paperPositionId,
            realizedPnl: position.realizedPnl,
            closePrice: position.closePrice,
            closeReason: position.closeReason
          }
        });
      }

      const closed = this.contractValidator.withLifecycleWriteAuthority((writerAuthority) =>
        this.positionLifecycleRepository.closePositionLifecycle({
          writerAuthority,
          id: lifecycle.id,
          closedAt: position.closedAt ?? timestamp
        })
      );
      if (!closed) {
        return;
      }

      const message: PositionLifecycleClosedMessage = {
        type: "position_lifecycle_closed",
        generatedAt: timestamp,
        payload: closed
      };
      this.emit(message);
      this.runChainIntegrityCheck({
        lifecycleId: closed.id,
        source: "lifecycle_close"
      });
      this.createDecisionReviewFromClosedLifecycle(closed, timestamp);
    } catch (error) {
      console.warn("Paper position lifecycle close integration failed", error);
    }
  }

  closeLiveRecoveryLifecycle(input: {
    lifecycle: PositionLifecycle;
    timestamp: number;
    payload: unknown;
  }): PositionLifecycle {
    const closed = this.contractValidator.withLifecycleWriteAuthority((writerAuthority) =>
      this.positionLifecycleRepository.closePositionLifecycle({
        writerAuthority,
        id: input.lifecycle.id,
        closedAt: input.timestamp
      })
    );
    if (!closed) {
      throw new Error("Position lifecycle close returned null.");
    }

    this.appendAndEmitPositionLifecycleEvent({
      lifecycleId: closed.id,
      eventType: "POSITION_CLOSED",
      timestamp: input.timestamp,
      payload: input.payload
    });

    const message: PositionLifecycleClosedMessage = {
      type: "position_lifecycle_closed",
      generatedAt: input.timestamp,
      payload: closed
    };
    this.emit(message);
    this.runChainIntegrityCheck({
      lifecycleId: closed.id,
      source: "lifecycle_close"
    });
    this.createDecisionReviewFromClosedLifecycle(closed, input.timestamp);
    return closed;
  }

  createDecisionReviewFromClosedLifecycle(
    lifecycle: PositionLifecycle,
    timestamp: number
  ): void {
    try {
      const review = decisionReviewRepository.createDecisionReviewFromLifecycle({
        lifecycle,
        createdAt: timestamp
      });
      this.runChainIntegrityCheck({
        lifecycleId: lifecycle.id,
        reviewId: review.id,
        source: "decision_review_create"
      });
    } catch (error) {
      console.warn("DecisionReview creation from closed lifecycle failed", error);
    }
  }

  private runChainIntegrityCheck(input: {
    lifecycleId?: string | null;
    reviewId?: string | null;
    source: string;
  }): void {
    try {
      chainIntegrityService.checkChain({
        source: input.source,
        ...(input.lifecycleId !== undefined ? { positionLifecycleId: input.lifecycleId } : {}),
        ...(input.reviewId !== undefined ? { reviewId: input.reviewId } : {})
      });
    } catch (error) {
      console.warn("Decision chain integrity check failed", error);
    }
  }
}
