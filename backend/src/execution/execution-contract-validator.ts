import type { ExecutionCommand } from "./types";

export type ExecutionContractActor =
  | "execution-facade"
  | "live-executor"
  | "paper-executor"
  | "lifecycle-manager";

export type ExecutionContractViolationCode =
  | "LIVE_EXECUTOR_RECEIVED_PAPER_COMMAND"
  | "PAPER_EXECUTOR_RECEIVED_LIVE_COMMAND"
  | "PAPER_EXECUTOR_EXTERNAL_API_ATTEMPT"
  | "POSITION_LIFECYCLE_WRITE_OUTSIDE_MANAGER"
  | "INVALID_EXECUTION_COMMAND";

export interface ExecutionContractViolation {
  event: "EXECUTION_CONTRACT_VIOLATION";
  code: ExecutionContractViolationCode;
  actor: ExecutionContractActor;
  payload: unknown;
  generatedAt: number;
}

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const toViolation = (
  code: ExecutionContractViolationCode,
  actor: ExecutionContractActor,
  payload: unknown
): ExecutionContractViolation => ({
  event: "EXECUTION_CONTRACT_VIOLATION",
  code,
  actor,
  payload,
  generatedAt: Date.now()
});

export class ExecutionContractViolationError extends Error {
  constructor(readonly violation: ExecutionContractViolation) {
    super(`${violation.event}: ${violation.code}`);
    this.name = "ExecutionContractViolationError";
  }
}

export class ExecutionContractValidator {
  private readonly lifecycleWriterAuthority = Object.freeze({
    scope: "LifecycleManagerPositionLifecycleWriter"
  });

  validateCommand(command: ExecutionCommand, actor: ExecutionContractActor): void {
    if (
      (command.type !== "LIVE" && command.type !== "PAPER") ||
      !normalizeText(command.intentId) ||
      !normalizeText(command.symbol) ||
      !Number.isFinite(command.quantity) ||
      command.quantity < 0 ||
      command.metadata === null ||
      typeof command.metadata !== "object" ||
      Array.isArray(command.metadata)
    ) {
      this.fail("INVALID_EXECUTION_COMMAND", actor, command);
    }
  }

  assertLiveCommand(command: ExecutionCommand, actor: ExecutionContractActor): void {
    this.validateCommand(command, actor);
    if (command.type !== "LIVE") {
      this.fail("LIVE_EXECUTOR_RECEIVED_PAPER_COMMAND", actor, command);
    }
  }

  assertPaperCommand(command: ExecutionCommand, actor: ExecutionContractActor): void {
    this.validateCommand(command, actor);
    if (command.type !== "PAPER") {
      this.fail("PAPER_EXECUTOR_RECEIVED_LIVE_COMMAND", actor, command);
    }
  }

  assertPaperExecutorExternalApiBlocked(payload: unknown): never {
    this.fail("PAPER_EXECUTOR_EXTERNAL_API_ATTEMPT", "paper-executor", payload);
  }

  withLifecycleWriteAuthority<T>(operation: (authority: object) => T): T {
    return operation(this.lifecycleWriterAuthority);
  }

  assertLifecycleWriterAuthority(authority: unknown, payload: unknown): void {
    if (authority !== this.lifecycleWriterAuthority) {
      this.fail("POSITION_LIFECYCLE_WRITE_OUTSIDE_MANAGER", "lifecycle-manager", payload);
    }
  }

  fail(
    code: ExecutionContractViolationCode,
    actor: ExecutionContractActor,
    payload: unknown
  ): never {
    const violation = toViolation(code, actor, payload);
    console.error("EXECUTION_CONTRACT_VIOLATION", violation);
    throw new ExecutionContractViolationError(violation);
  }
}
