import { ExecutionContractValidator } from "./execution-contract-validator";
import { ExecutionAudit, type ExecutionAuditEmitter } from "./execution-audit";
import { LifecycleManager, type LifecycleManagerEmitter } from "./lifecycle-manager";
import { LiveExecutor } from "./live-executor";
import { PaperExecutor } from "./paper-executor";
import type { OrderStatePayload } from "../types/messages";
import type { ExecutionCommand } from "./types";

export class ExecutionFacade {
  readonly audit: ExecutionAudit;
  readonly lifecycleManager: LifecycleManager;
  readonly liveExecutor: LiveExecutor;
  readonly paperExecutor: PaperExecutor;
  private readonly validator: ExecutionContractValidator;

  constructor(input: {
    auditEmitter: ExecutionAuditEmitter;
    lifecycleEmitter: LifecycleManagerEmitter;
  }) {
    this.validator = new ExecutionContractValidator();
    this.audit = new ExecutionAudit(input.auditEmitter);
    this.lifecycleManager = new LifecycleManager(input.lifecycleEmitter, this.validator);
    this.liveExecutor = new LiveExecutor(this.validator);
    this.paperExecutor = new PaperExecutor(this.validator);
  }

  validateLiveCommand(command: ExecutionCommand, order?: OrderStatePayload): void {
    this.validator.assertLiveCommand(command, "execution-facade");
    this.liveExecutor.assertLiveOrderBoundary(order ?? this.toOrderBoundary(command, false), command);
  }

  validatePaperCommand(command: ExecutionCommand, order?: OrderStatePayload): void {
    this.validator.assertPaperCommand(command, "execution-facade");
    this.paperExecutor.assertPaperOrderBoundary(order ?? this.toOrderBoundary(command, true), command);
  }

  private toOrderBoundary(command: ExecutionCommand, dryRun: boolean): OrderStatePayload {
    const now = Date.now();
    return {
      orderId: `contract-${command.intentId}`,
      intentId: command.intentId,
      symbol: command.symbol,
      side: "BUY",
      orderType: "MARKET",
      quantity: command.quantity,
      price: null,
      stopPrice: null,
      stopLossPrice: null,
      takeProfitPrice: null,
      status: "NEW",
      clientOrderId: `contract-${command.intentId}`,
      exchangeOrderId: null,
      sourceWindowId: null,
      parentOrderId: null,
      protectiveKind: null,
      dryRun,
      reduceOnly: false,
      executedQty: 0,
      avgPrice: null,
      lastFilledQty: null,
      realizedPnl: null,
      commission: null,
      commissionAsset: null,
      lastExecutionType: null,
      lastTradeTime: null,
      rejectReason: null,
      createdAt: now,
      updatedAt: now,
      lastEventSource: "validation"
    };
  }
}
