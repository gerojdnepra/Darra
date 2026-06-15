import type { OrderStatePayload } from "../types/messages";
import type { ExecutionContractValidator } from "./execution-contract-validator";
import type { ExecutionCommand } from "./types";

export class LiveExecutor {
  constructor(private readonly validator: ExecutionContractValidator) {}

  assertLiveCommand(command: ExecutionCommand): void {
    this.validator.assertLiveCommand(command, "live-executor");
  }

  assertLiveOrderBoundary(order: OrderStatePayload, command?: ExecutionCommand): void {
    if (command) {
      this.assertLiveCommand(command);
    }

    if (order.dryRun) {
      this.validator.fail("LIVE_EXECUTOR_RECEIVED_PAPER_COMMAND", "live-executor", {
        command: command ?? null,
        order
      });
    }
  }
}
