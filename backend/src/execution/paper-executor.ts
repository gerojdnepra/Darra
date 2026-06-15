import type { OrderStatePayload } from "../types/messages";
import type { ExecutionContractValidator } from "./execution-contract-validator";
import type { ExecutionCommand } from "./types";

export class PaperExecutor {
  constructor(private readonly validator: ExecutionContractValidator) {}

  assertPaperCommand(command: ExecutionCommand): void {
    this.validator.assertPaperCommand(command, "paper-executor");
  }

  assertNoExternalApiAccess(payload: unknown): never {
    return this.validator.assertPaperExecutorExternalApiBlocked(payload);
  }

  assertPaperOrderBoundary(order: OrderStatePayload, command?: ExecutionCommand): void {
    if (command) {
      this.assertPaperCommand(command);
    }

    if (!order.dryRun) {
      this.validator.fail("PAPER_EXECUTOR_RECEIVED_LIVE_COMMAND", "paper-executor", {
        command: command ?? null,
        order
      });
    }
  }
}
