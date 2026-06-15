import { orderRepository } from "../storage/order-repository";
import type {
  OrderAuditEventMessage,
  OrderStatePayload
} from "../types/messages";

export type ExecutionAuditMessage = OrderAuditEventMessage;
export type ExecutionAuditEmitter = (message: ExecutionAuditMessage) => void;

export class ExecutionAudit {
  constructor(private readonly emit: ExecutionAuditEmitter) {}

  emitAuditEvent(input: {
    order: OrderStatePayload;
    eventType: string;
    message: string;
    payload: unknown;
    timestamp: number;
  }): void {
    try {
      const event = orderRepository.appendAuditEvent({
        order: input.order,
        eventType: input.eventType,
        message: input.message,
        payload: input.payload,
        timestamp: input.timestamp
      });

      this.emit({
        type: "order_audit_event",
        generatedAt: input.timestamp,
        payload: event
      });
    } catch (error) {
      console.warn("Order audit event persistence failed", error);
    }
  }
}
