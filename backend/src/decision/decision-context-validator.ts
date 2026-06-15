import type { TradeDecisionAction } from "../types/messages";

export interface ValidatedDecisionContextCommand {
  symbol: string;
  intent: TradeDecisionAction;
  preflightId?: string | null;
  notes?: string | null;
}

export interface DecisionContextValidationResult {
  command?: ValidatedDecisionContextCommand;
  validationErrors: string[];
}

const allowedKeys = new Set(["symbol", "intent", "preflightId", "notes"]);
const forbiddenKeys = new Set([
  "id",
  "decisionId",
  "decisionContextId",
  "unifiedSignalId",
  "signal",
  "signalSnapshot",
  "risk",
  "riskSnapshot",
  "riskSnapshotRef",
  "signalConfidence",
  "signalStability",
  "marketRegime",
  "decisionStrength",
  "decisionQualityScore",
  "decision",
  "decisionReason",
  "preflightNonce",
  "orderIntentId",
  "reviewCorrelationId",
  "source",
  "status",
  "createdAt",
  "payload"
]);

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const isTradeDecisionAction = (value: unknown): value is TradeDecisionAction =>
  value === "ENTER" || value === "WAIT" || value === "SKIP";

export class DecisionContextValidator {
  validateIncomingCommand(payload: unknown): DecisionContextValidationResult {
    const validationErrors: string[] = [];

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        validationErrors: ["PAYLOAD_NOT_OBJECT"]
      };
    }

    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record);
    const forbidden = keys.find((key) => forbiddenKeys.has(key));
    if (forbidden) {
      validationErrors.push(`FORBIDDEN_FIELD:${forbidden}`);
    }

    const unexpected = keys.find((key) => !allowedKeys.has(key));
    if (unexpected) {
      validationErrors.push(`UNEXPECTED_FIELD:${unexpected}`);
    }

    const symbol = typeof record.symbol === "string" ? record.symbol.trim().toUpperCase() : "";
    if (!symbol) {
      validationErrors.push("SYMBOL_REQUIRED");
    }

    const intent = record.intent;
    if (!isTradeDecisionAction(intent)) {
      validationErrors.push("INTENT_REQUIRED");
    }

    if (validationErrors.length > 0) {
      return { validationErrors };
    }

    const validIntent = intent as TradeDecisionAction;

    return {
      command: {
        symbol,
        intent: validIntent,
        ...(typeof record.preflightId === "string" || record.preflightId === null
          ? { preflightId: normalizeText(record.preflightId) }
          : {}),
        ...(typeof record.notes === "string" || record.notes === null
          ? { notes: normalizeText(record.notes) }
          : {})
      },
      validationErrors: []
    };
  }
}

export const decisionContextValidator = new DecisionContextValidator();
